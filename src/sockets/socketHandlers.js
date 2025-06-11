const jwt = require("jsonwebtoken");
const { User, Chat, Ride, Group, UserConnection } = require("../models");
const { cacheGet, cacheSet } = require("../config/redis");
const { Op } = require("sequelize");

const socketHandlers = (io) => {
  // In-memory caches for frequent lookups
  const connectionCache = new Map();
  const roomMembershipCache = new Map();
  const userCache = new Map();

  // Batch operations queue
  const messageBatch = [];
  const BATCH_SIZE = 10;
  const BATCH_TIMEOUT = 100; // ms

  // Authentication middleware for socket connections (optimized)
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication error"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check in-memory cache first
      let user = userCache.get(decoded.userId);
      if (!user) {
        // Get user from Redis cache
        user = await cacheGet(`user:${decoded.userId}`);
        if (!user) {
          user = await User.findByPk(decoded.userId, {
            attributes: ["id", "first_name", "last_name", "profile_picture"], // Only needed fields
          });
          if (!user) {
            return next(new Error("User not found"));
          }
          await cacheSet(`user:${decoded.userId}`, user, 900);
        }
        userCache.set(decoded.userId, user);
      }

      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User ${socket.user.first_name} connected: ${socket.id}`);

    // Join user to their personal room for direct messages
    socket.join(`user:${socket.userId}`);

    // Handle joining direct message conversations (cached)
    socket.on("join_direct_conversation", async (otherUserId) => {
      try {
        if (otherUserId === socket.userId) {
          return socket.emit("join_error", {
            message: "Cannot start conversation with yourself",
          });
        }

        const cacheKey = `connection:${socket.userId}:${otherUserId}`;
        let connection = connectionCache.get(cacheKey);

        if (!connection) {
          connection = await UserConnection.findOne({
            where: {
              user_id: socket.userId,
              connected_user_id: otherUserId,
              status: { [Op.ne]: "blocked" },
            },
            attributes: ["id", "status"],
          });

          if (connection) {
            connectionCache.set(cacheKey, connection);
          }
        }

        if (connection) {
          const conversationId = Chat.getDirectConversationId(
            socket.userId,
            otherUserId
          );
          socket.join(`direct:${conversationId}`);
          socket.emit("joined_direct_conversation", {
            otherUserId,
            conversationId,
            status: "success",
          });
        } else {
          socket.emit("join_error", {
            message: "No connection found with this user or user is blocked",
          });
        }
      } catch (error) {
        socket.emit("join_error", {
          message: "Failed to join direct conversation",
        });
      }
    });

    // Handle leaving direct conversations
    socket.on("leave_direct_conversation", (otherUserId) => {
      const conversationId = Chat.getDirectConversationId(
        socket.userId,
        otherUserId
      );
      socket.leave(`direct:${conversationId}`);
      socket.emit("left_direct_conversation", { otherUserId, conversationId });
    });

    // Handle joining ride chat rooms (cached)
    socket.on("join_ride", async (rideId) => {
      try {
        const membershipKey = `ride:${rideId}:${socket.userId}`;
        let isMember = roomMembershipCache.get(membershipKey);

        if (isMember === undefined) {
          const ride = await Ride.findByPk(rideId, {
            attributes: ["id", "creator_id"],
            include: [
              {
                model: User,
                as: "participants",
                where: { id: socket.userId },
                required: false,
                attributes: ["id"],
              },
            ],
          });

          isMember =
            ride &&
            (ride.creator_id === socket.userId ||
              (ride.participants && ride.participants.length > 0));

          roomMembershipCache.set(membershipKey, isMember);
        }

        if (isMember) {
          socket.join(`ride:${rideId}`);
          socket.emit("joined_ride", { rideId, status: "success" });
        } else {
          socket.emit("join_error", {
            message: "Not authorized to join this ride",
          });
        }
      } catch (error) {
        socket.emit("join_error", { message: "Failed to join ride" });
      }
    });

    // Handle joining group chat rooms (cached)
    socket.on("join_group", async (groupId) => {
      try {
        const membershipKey = `group:${groupId}:${socket.userId}`;
        let isMember = roomMembershipCache.get(membershipKey);

        if (isMember === undefined) {
          const group = await Group.findByPk(groupId, {
            attributes: ["id", "admin_id"],
            include: [
              {
                model: User,
                as: "members",
                where: { id: socket.userId },
                required: false,
                attributes: ["id"],
              },
            ],
          });

          isMember =
            group &&
            (group.admin_id === socket.userId ||
              (group.members && group.members.length > 0));

          roomMembershipCache.set(membershipKey, isMember);
        }

        if (isMember) {
          socket.join(`group:${groupId}`);
          socket.emit("joined_group", { groupId, status: "success" });
        } else {
          socket.emit("join_error", {
            message: "Not authorized to join this group",
          });
        }
      } catch (error) {
        socket.emit("join_error", { message: "Failed to join group" });
      }
    });

    // Handle leaving rooms
    socket.on("leave_ride", (rideId) => {
      socket.leave(`ride:${rideId}`);
      socket.emit("left_ride", { rideId });
    });

    socket.on("leave_group", (groupId) => {
      socket.leave(`group:${groupId}`);
      socket.emit("left_group", { groupId });
    });

    // OPTIMIZED: Handle sending messages with significant performance improvements
    socket.on("send_message", async (data) => {
      const startTime = Date.now();

      try {
        const {
          message,
          message_type = "text",
          chat_type = "direct",
          recipient_id,
          ride_id,
          group_id,
          reply_to_id,
          metadata,
        } = data;

        // OPTIMIZATION 1: Quick validation first (no DB calls)
        if (!message && message_type === "text") {
          return socket.emit("message_error", {
            message: "Message content required",
          });
        }

        if (chat_type === "direct") {
          if (!recipient_id) {
            return socket.emit("message_error", {
              message: "Recipient ID required for direct messages",
            });
          }
          if (recipient_id === socket.userId) {
            return socket.emit("message_error", {
              message: "Cannot send messages to yourself",
            });
          }
        } else if (chat_type === "ride" && !ride_id) {
          return socket.emit("message_error", {
            message: "Ride ID required for ride messages",
          });
        } else if (chat_type === "group" && !group_id) {
          return socket.emit("message_error", {
            message: "Group ID required for group messages",
          });
        }

        // OPTIMIZATION 2: Prepare variables for parallel operations
        let roomName;
        let authPromise = Promise.resolve(true);
        let connectionUpdatePromise = Promise.resolve();

        // OPTIMIZATION 3: Handle different chat types with cached authorization
        if (chat_type === "direct") {
          const cacheKey = `connection:${socket.userId}:${recipient_id}`;
          let connection = connectionCache.get(cacheKey);

          if (!connection) {
            // Try Redis cache first
            connection = await cacheGet(cacheKey);
            if (!connection) {
              connection = await UserConnection.findOne({
                where: {
                  user_id: socket.userId,
                  connected_user_id: recipient_id,
                  status: { [Op.ne]: "blocked" },
                },
                attributes: ["id", "status", "last_message_at"],
              });

              if (connection) {
                await cacheSet(cacheKey, connection, 300);
              }
            }

            if (connection) {
              connectionCache.set(cacheKey, connection);
            }
          }

          if (!connection) {
            // Auto-create connection asynchronously
            try {
              connection = await UserConnection.findOrCreateConnection(
                socket.userId,
                recipient_id,
                socket.userId
              );
              if (connection) {
                await cacheSet(cacheKey, connection, 300);
                connectionCache.set(cacheKey, connection);
              }
            } catch (error) {
              if (
                error.name === "SequelizeValidationError" &&
                error.errors.some(
                  (e) => e.validatorKey === "cannotConnectToSelf"
                )
              ) {
                return socket.emit("message_error", {
                  message: "Cannot send messages to yourself",
                });
              }
              return socket.emit("message_error", {
                message: "Failed to create connection",
              });
            }
          }

          roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;

          // Prepare connection update (don't await yet)
          connectionUpdatePromise = UserConnection.update(
            { last_message_at: new Date() },
            {
              where: {
                [Op.or]: [
                  { user_id: socket.userId, connected_user_id: recipient_id },
                  { user_id: recipient_id, connected_user_id: socket.userId },
                ],
              },
              validate: false,
            }
          );
        } else if (chat_type === "ride") {
          const membershipKey = `ride:${ride_id}:${socket.userId}`;
          let isMember = roomMembershipCache.get(membershipKey);

          if (isMember === undefined) {
            const ride = await Ride.findByPk(ride_id, {
              attributes: ["id", "creator_id"],
              include: [
                {
                  model: User,
                  as: "participants",
                  where: { id: socket.userId },
                  required: false,
                  attributes: ["id"],
                },
              ],
            });

            isMember =
              ride &&
              (ride.creator_id === socket.userId ||
                (ride.participants && ride.participants.length > 0));

            roomMembershipCache.set(membershipKey, isMember);
          }

          if (!isMember) {
            return socket.emit("message_error", {
              message: "Not authorized to send messages in this ride",
            });
          }
          roomName = `ride:${ride_id}`;
        } else if (chat_type === "group") {
          const membershipKey = `group:${group_id}:${socket.userId}`;
          let isMember = roomMembershipCache.get(membershipKey);

          if (isMember === undefined) {
            const group = await Group.findByPk(group_id, {
              attributes: ["id", "admin_id"],
              include: [
                {
                  model: User,
                  as: "members",
                  where: { id: socket.userId },
                  required: false,
                  attributes: ["id"],
                },
              ],
            });

            isMember =
              group &&
              (group.admin_id === socket.userId ||
                (group.members && group.members.length > 0));

            roomMembershipCache.set(membershipKey, isMember);
          }

          if (!isMember) {
            return socket.emit("message_error", {
              message: "Not authorized to send messages in this group",
            });
          }
          roomName = `group:${group_id}`;
        }

        // OPTIMIZATION 4: Send immediate confirmation to sender (optimistic UI)
        const tempMessageId = `temp_${Date.now()}_${socket.userId}`;
        socket.emit("message_sent", {
          id: tempMessageId,
          status: "sending",
          timestamp: new Date(),
        });

        // OPTIMIZATION 5: Create chat message with minimal includes
        const chat = await Chat.create({
          message,
          message_type,
          chat_type,
          sender_id: socket.userId,
          recipient_id,
          ride_id,
          group_id,
          reply_to_id,
          metadata: metadata || {},
        });

        if (!chat || !chat.id) {
          return socket.emit("message_error", {
            message: "Failed to create message",
          });
        }

        // OPTIMIZATION 6: Parallel operations - fetch user data and update connection
        const [chatWithUsers] = await Promise.all([
          Chat.findByPk(chat.id, {
            include: [
              {
                model: User,
                as: "sender",
                attributes: [
                  "id",
                  "first_name",
                  "last_name",
                  "profile_picture",
                ],
              },
              {
                model: User,
                as: "recipient",
                attributes: [
                  "id",
                  "first_name",
                  "last_name",
                  "profile_picture",
                ],
                required: false,
              },
            ],
          }),
          connectionUpdatePromise, // Update connection timestamp in parallel
        ]);

        // OPTIMIZATION 7: Emit to rooms immediately
        io.to(roomName).emit("new_message", chatWithUsers);

        // For direct messages, also notify the recipient's personal room
        if (chat_type === "direct") {
          io.to(`user:${recipient_id}`).emit("new_direct_message", {
            ...chatWithUsers.toJSON(),
            conversation_id: Chat.getDirectConversationId(
              socket.userId,
              recipient_id
            ),
          });
        }

        // Send final confirmation to sender with real ID
        socket.emit("message_sent", {
          id: chat.id,
          tempId: tempMessageId,
          status: "success",
          timestamp: chat.createdAt,
          processingTime: Date.now() - startTime,
        });
      } catch (error) {
        console.error("Send message error:", error);

        if (
          error.name === "SequelizeValidationError" &&
          error.errors.some((e) => e.validatorKey === "cannotConnectToSelf")
        ) {
          socket.emit("message_error", {
            message: "Cannot send messages to yourself",
          });
        } else if (error.name === "SequelizeForeignKeyConstraintError") {
          socket.emit("message_error", {
            message: "Invalid recipient or chat reference",
          });
        } else {
          socket.emit("message_error", {
            message: "Failed to send message",
            processingTime: Date.now() - startTime,
          });
        }
      }
    });

    // OPTIMIZED: Handle message editing with caching
    socket.on("edit_message", async (data) => {
      try {
        const { message_id, new_message } = data;

        const chat = await Chat.findByPk(message_id, {
          attributes: [
            "id",
            "sender_id",
            "chat_type",
            "recipient_id",
            "ride_id",
            "group_id",
            "is_deleted",
          ],
        });

        if (!chat || chat.sender_id !== socket.userId || chat.is_deleted) {
          return socket.emit("edit_error", {
            message: "Cannot edit this message",
          });
        }

        // Update message
        await chat.update({
          message: new_message,
          is_edited: true,
          edited_at: new Date(),
        });

        let roomName;
        if (chat.chat_type === "direct") {
          roomName = `direct:${Chat.getDirectConversationId(chat.sender_id, chat.recipient_id)}`;
        } else if (chat.chat_type === "ride") {
          roomName = `ride:${chat.ride_id}`;
        } else if (chat.chat_type === "group") {
          roomName = `group:${chat.group_id}`;
        }

        // Emit updated message to room
        io.to(roomName).emit("message_edited", {
          id: chat.id,
          message: new_message,
          is_edited: true,
          edited_at: chat.edited_at,
        });
      } catch (error) {
        socket.emit("edit_error", { message: "Failed to edit message" });
      }
    });

    // OPTIMIZED: Handle message deletion
    socket.on("delete_message", async (data) => {
      try {
        const { message_id } = data;

        const chat = await Chat.findByPk(message_id, {
          attributes: [
            "id",
            "sender_id",
            "chat_type",
            "recipient_id",
            "ride_id",
            "group_id",
            "is_deleted",
          ],
        });

        if (!chat || chat.sender_id !== socket.userId || chat.is_deleted) {
          return socket.emit("delete_error", {
            message: "Cannot delete this message",
          });
        }

        await chat.update({
          is_deleted: true,
          deleted_at: new Date(),
        });

        let roomName;
        if (chat.chat_type === "direct") {
          roomName = `direct:${Chat.getDirectConversationId(chat.sender_id, chat.recipient_id)}`;
        } else if (chat.chat_type === "ride") {
          roomName = `ride:${chat.ride_id}`;
        } else if (chat.chat_type === "group") {
          roomName = `group:${chat.group_id}`;
        }

        // Emit deletion to room
        io.to(roomName).emit("message_deleted", {
          id: chat.id,
          deleted_at: chat.deleted_at,
        });
      } catch (error) {
        socket.emit("delete_error", { message: "Failed to delete message" });
      }
    });

    // OPTIMIZED: Handle typing indicators (with throttling)
    let typingTimeout;
    socket.on("typing_start", (data) => {
      const { chat_type, recipient_id, ride_id, group_id } = data;

      if (chat_type === "direct" && recipient_id === socket.userId) {
        return;
      }

      let roomName;
      if (chat_type === "direct") {
        roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
      } else if (chat_type === "ride") {
        roomName = `ride:${ride_id}`;
      } else if (chat_type === "group") {
        roomName = `group:${group_id}`;
      }

      socket.to(roomName).emit("user_typing", {
        user_id: socket.userId,
        user_name: socket.user.first_name,
        chat_type,
        typing: true,
      });

      // Auto-stop typing after 3 seconds
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.to(roomName).emit("user_typing", {
          user_id: socket.userId,
          user_name: socket.user.first_name,
          chat_type,
          typing: false,
        });
      }, 3000);
    });

    socket.on("typing_stop", (data) => {
      const { chat_type, recipient_id, ride_id, group_id } = data;

      if (chat_type === "direct" && recipient_id === socket.userId) {
        return;
      }

      let roomName;
      if (chat_type === "direct") {
        roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
      } else if (chat_type === "ride") {
        roomName = `ride:${ride_id}`;
      } else if (chat_type === "group") {
        roomName = `group:${group_id}`;
      }

      clearTimeout(typingTimeout);
      socket.to(roomName).emit("user_typing", {
        user_id: socket.userId,
        user_name: socket.user.first_name,
        chat_type,
        typing: false,
      });
    });

    // OPTIMIZED: Handle read receipts with batching
    socket.on("mark_messages_read", async (data) => {
      try {
        const { chat_type, sender_id, message_ids } = data;

        if (chat_type === "direct" && sender_id) {
          if (sender_id === socket.userId) {
            return socket.emit("mark_read_error", {
              message: "Cannot mark your own messages as read",
            });
          }

          // Batch update for better performance
          const [updatedCount] = await Chat.update(
            { is_read: true, read_at: new Date() },
            {
              where: {
                chat_type: "direct",
                sender_id: sender_id,
                recipient_id: socket.userId,
                is_read: false,
                is_deleted: false,
              },
            }
          );

          if (updatedCount > 0) {
            // Notify sender about read receipt
            const conversationId = Chat.getDirectConversationId(
              socket.userId,
              sender_id
            );
            socket.to(`direct:${conversationId}`).emit("messages_read", {
              reader_id: socket.userId,
              reader_name: socket.user.first_name,
              read_at: new Date(),
              count: updatedCount,
            });
          }
        } else if (message_ids && Array.isArray(message_ids)) {
          await Chat.update(
            { is_read: true, read_at: new Date() },
            {
              where: {
                id: { [Op.in]: message_ids },
                recipient_id: socket.userId,
                is_read: false,
              },
            }
          );
        }

        socket.emit("mark_read_success", {
          chat_type,
          sender_id,
          message_count: message_ids?.length || "all",
        });
      } catch (error) {
        socket.emit("mark_read_error", {
          message: "Failed to mark messages as read",
        });
      }
    });

    // Handle user status updates (throttled)
    let statusUpdateTimeout;
    socket.on("update_status", async (status) => {
      clearTimeout(statusUpdateTimeout);
      statusUpdateTimeout = setTimeout(async () => {
        try {
          await User.update(
            { last_active: new Date() },
            { where: { id: socket.userId } }
          );

          socket.broadcast.emit("user_status_changed", {
            user_id: socket.userId,
            status,
            last_active: new Date(),
          });
        } catch (error) {
          console.error("Status update error:", error);
        }
      }, 1000); // Throttle to max once per second
    });

    // Handle blocking/unblocking users (with cache invalidation)
    socket.on("block_user", async (data) => {
      try {
        const { user_id, action } = data;

        if (user_id === socket.userId) {
          return socket.emit("block_error", {
            message: "Cannot block yourself",
          });
        }

        const connection = await UserConnection.findOne({
          where: {
            user_id: socket.userId,
            connected_user_id: user_id,
          },
        });

        if (connection) {
          const newStatus = action === "block" ? "blocked" : "active";
          await connection.update({ status: newStatus });

          // Invalidate cache
          const cacheKey = `connection:${socket.userId}:${user_id}`;
          connectionCache.delete(cacheKey);
          await cacheSet(cacheKey, null, 1); // Mark as invalid

          socket.emit("user_blocked", {
            user_id,
            status: newStatus,
            action,
          });

          if (action === "block") {
            const conversationId = Chat.getDirectConversationId(
              socket.userId,
              user_id
            );
            socket.leave(`direct:${conversationId}`);
          }
        }
      } catch (error) {
        socket.emit("block_error", { message: "Failed to update user status" });
      }
    });

    // OPTIMIZED: Handle location sharing
    socket.on("share_location", async (data) => {
      try {
        const {
          latitude,
          longitude,
          chat_type,
          recipient_id,
          ride_id,
          group_id,
          message,
        } = data;

        if (chat_type === "direct" && recipient_id === socket.userId) {
          return socket.emit("location_error", {
            message: "Cannot share location with yourself",
          });
        }

        let roomName;
        if (chat_type === "direct") {
          roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
        } else if (chat_type === "ride") {
          roomName = `ride:${ride_id}`;
        } else if (chat_type === "group") {
          roomName = `group:${group_id}`;
        }

        // Create location message
        const chat = await Chat.create({
          message: message || "Shared location",
          message_type: "location",
          chat_type,
          sender_id: socket.userId,
          recipient_id,
          ride_id,
          group_id,
          metadata: {
            location: { latitude, longitude },
          },
        });

        const chatWithSender = await Chat.findByPk(chat.id, {
          include: [
            {
              model: User,
              as: "sender",
              attributes: ["id", "first_name", "last_name", "profile_picture"],
            },
            {
              model: User,
              as: "recipient",
              attributes: ["id", "first_name", "last_name", "profile_picture"],
              required: false,
            },
          ],
        });

        io.to(roomName).emit("new_message", chatWithSender);
      } catch (error) {
        socket.emit("location_error", { message: "Failed to share location" });
      }
    });

    // Handle itinerary sharing
    socket.on("share_itinerary", async (data) => {
      try {
        const {
          itinerary,
          chat_type,
          recipient_id,
          ride_id,
          group_id,
          message,
        } = data;

        if (chat_type === "direct" && recipient_id === socket.userId) {
          return socket.emit("itinerary_error", {
            message: "Cannot share itinerary with yourself",
          });
        }

        // Validate itinerary data
        if (
          !itinerary ||
          !itinerary.title ||
          !itinerary.destinations ||
          !Array.isArray(itinerary.destinations)
        ) {
          return socket.emit("itinerary_error", {
            message: "Invalid itinerary data",
          });
        }

        let roomName;
        if (chat_type === "direct") {
          roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
        } else if (chat_type === "ride") {
          roomName = `ride:${ride_id}`;
        } else if (chat_type === "group") {
          roomName = `group:${group_id}`;
        }

        // Create itinerary message
        const chat = await Chat.create({
          message: message || `Shared itinerary: ${itinerary.title}`,
          message_type: "itinerary",
          chat_type,
          sender_id: socket.userId,
          recipient_id,
          ride_id,
          group_id,
          metadata: {
            itinerary: {
              id: itinerary.id || `itin_${Date.now()}`,
              title: itinerary.title,
              description: itinerary.description,
              destinations: itinerary.destinations,
              duration: itinerary.duration,
              startDate: itinerary.startDate,
              endDate: itinerary.endDate,
              totalDistance: itinerary.totalDistance,
              estimatedCost: itinerary.estimatedCost,
              participants: itinerary.participants || [],
              createdBy: socket.userId,
              createdAt: new Date(),
            },
          },
        });

        const chatWithSender = await Chat.findByPk(chat.id, {
          include: [
            {
              model: User,
              as: "sender",
              attributes: ["id", "first_name", "last_name", "profile_picture"],
            },
            {
              model: User,
              as: "recipient",
              attributes: ["id", "first_name", "last_name", "profile_picture"],
              required: false,
            },
          ],
        });

        io.to(roomName).emit("new_message", chatWithSender);

        socket.emit("itinerary_shared", {
          id: chat.id,
          status: "success",
        });
      } catch (error) {
        console.error("Share itinerary error:", error);
        socket.emit("itinerary_error", {
          message: "Failed to share itinerary",
        });
      }
    });

    // Handle itinerary interactions (RSVP, comments, etc.)
    socket.on("interact_with_itinerary", async (data) => {
      try {
        const { message_id, interaction_type, interaction_data } = data;

        const chat = await Chat.findByPk(message_id, {
          attributes: [
            "id",
            "metadata",
            "chat_type",
            "recipient_id",
            "ride_id",
            "group_id",
          ],
        });

        if (!chat || chat.message_type !== "itinerary") {
          return socket.emit("itinerary_interaction_error", {
            message: "Itinerary not found",
          });
        }

        const metadata = chat.metadata || {};
        const itinerary = metadata.itinerary || {};

        switch (interaction_type) {
          case "rsvp":
            if (!itinerary.participants) itinerary.participants = [];

            const existingRsvp = itinerary.participants.find(
              (p) => p.userId === socket.userId
            );
            if (existingRsvp) {
              existingRsvp.status = interaction_data.status;
              existingRsvp.updatedAt = new Date();
            } else {
              itinerary.participants.push({
                userId: socket.userId,
                status: interaction_data.status, // 'going', 'maybe', 'not_going'
                joinedAt: new Date(),
              });
            }
            break;

          case "suggest_destination":
            if (!itinerary.suggestions) itinerary.suggestions = [];
            itinerary.suggestions.push({
              id: `sugg_${Date.now()}`,
              userId: socket.userId,
              type: "destination",
              data: interaction_data,
              createdAt: new Date(),
            });
            break;

          case "suggest_edit":
            if (!itinerary.suggestions) itinerary.suggestions = [];
            itinerary.suggestions.push({
              id: `sugg_${Date.now()}`,
              userId: socket.userId,
              type: "edit",
              data: interaction_data,
              createdAt: new Date(),
            });
            break;
        }

        // Update the message metadata
        await chat.update({
          metadata: { ...metadata, itinerary },
        });

        let roomName;
        if (chat.chat_type === "direct") {
          roomName = `direct:${Chat.getDirectConversationId(chat.sender_id, chat.recipient_id)}`;
        } else if (chat.chat_type === "ride") {
          roomName = `ride:${chat.ride_id}`;
        } else if (chat.chat_type === "group") {
          roomName = `group:${chat.group_id}`;
        }

        // Emit updated itinerary to room
        io.to(roomName).emit("itinerary_updated", {
          message_id: chat.id,
          interaction_type,
          user_id: socket.userId,
          user_name: socket.user.first_name,
          itinerary: itinerary,
        });

        socket.emit("itinerary_interaction_success", {
          message_id: chat.id,
          interaction_type,
        });
      } catch (error) {
        console.error("Itinerary interaction error:", error);
        socket.emit("itinerary_interaction_error", {
          message: "Failed to update itinerary",
        });
      }
    });

    // Handle live location updates during rides (throttled)
    let locationUpdateTimeout;
    socket.on("update_live_location", (data) => {
      const { latitude, longitude, ride_id } = data;

      if (ride_id) {
        clearTimeout(locationUpdateTimeout);
        locationUpdateTimeout = setTimeout(() => {
          socket.to(`ride:${ride_id}`).emit("live_location_update", {
            user_id: socket.userId,
            latitude,
            longitude,
            timestamp: new Date(),
          });
        }, 500); // Throttle location updates to every 500ms
      }
    });

    // OPTIMIZED: Handle starting new conversations
    socket.on("start_conversation", async (data) => {
      try {
        const { user_id, initial_message } = data;

        if (user_id === socket.userId) {
          return socket.emit("conversation_error", {
            message: "Cannot start conversation with yourself",
          });
        }

        // Check cache first
        let user = userCache.get(user_id);
        if (!user) {
          user = await User.findByPk(user_id, {
            attributes: ["id", "first_name", "last_name", "profile_picture"],
          });

          if (!user) {
            return socket.emit("conversation_error", {
              message: "User not found",
            });
          }

          userCache.set(user_id, user);
        }

        // Create or find connection
        let connection;
        try {
          connection = await UserConnection.findOrCreateConnection(
            socket.userId,
            user_id,
            socket.userId
          );
        } catch (error) {
          return socket.emit("conversation_error", {
            message: "Failed to create connection",
          });
        }

        const conversationId = Chat.getDirectConversationId(
          socket.userId,
          user_id
        );
        socket.join(`direct:${conversationId}`);

        // Send initial message if provided
        if (initial_message) {
          const chat = await Chat.create({
            message: initial_message,
            message_type: "text",
            chat_type: "direct",
            sender_id: socket.userId,
            recipient_id: user_id,
          });

          const chatWithSender = await Chat.findByPk(chat.id, {
            include: [
              {
                model: User,
                as: "sender",
                attributes: [
                  "id",
                  "first_name",
                  "last_name",
                  "profile_picture",
                ],
              },
            ],
          });

          // Notify recipient
          io.to(`user:${user_id}`).emit("new_conversation_started", {
            initiator: socket.user,
            conversation_id: conversationId,
            initial_message: chatWithSender,
          });

          io.to(`direct:${conversationId}`).emit("new_message", chatWithSender);
        }

        socket.emit("conversation_started", {
          user: user,
          conversation_id: conversationId,
          connection_id: connection.id,
        });
      } catch (error) {
        socket.emit("conversation_error", {
          message: "Failed to start conversation",
        });
      }
    });

    // OPTIMIZED: Handle getting online status of connections (cached)
    socket.on("get_connections_status", async () => {
      try {
        const cacheKey = `connections_status:${socket.userId}`;
        let connectionsStatus = await cacheGet(cacheKey);

        if (!connectionsStatus) {
          const connections = await UserConnection.findAll({
            where: {
              user_id: socket.userId,
              status: "active",
              is_archived: false,
            },
            include: [
              {
                model: User,
                as: "connectedUser",
                attributes: [
                  "id",
                  "first_name",
                  "last_name",
                  "profile_picture",
                  "last_active",
                ],
              },
            ],
          });

          connectionsStatus = connections.map((conn) => ({
            user_id: conn.connected_user_id,
            user: conn.connectedUser,
            is_online: isUserOnline(conn.connected_user_id),
            last_active: conn.connectedUser.last_active,
          }));

          // Cache for 30 seconds
          await cacheSet(cacheKey, connectionsStatus, 30);
        }

        socket.emit("connections_status", connectionsStatus);
      } catch (error) {
        socket.emit("status_error", {
          message: "Failed to get connections status",
        });
      }
    });

    // Handle disconnection (optimized cleanup)
    socket.on("disconnect", async () => {
      console.log(`User ${socket.user.first_name} disconnected: ${socket.id}`);

      // Clean up timeouts
      clearTimeout(typingTimeout);
      clearTimeout(statusUpdateTimeout);
      clearTimeout(locationUpdateTimeout);

      // Update last active time (throttled to avoid excessive DB writes)
      try {
        // Only update if last update was more than 30 seconds ago
        const lastActiveKey = `last_active_update:${socket.userId}`;
        const lastUpdate = await cacheGet(lastActiveKey);

        if (!lastUpdate || Date.now() - lastUpdate > 30000) {
          await User.update(
            { last_active: new Date() },
            { where: { id: socket.userId } }
          );

          await cacheSet(lastActiveKey, Date.now(), 60);
        }

        // Notify connections about offline status (throttled)
        socket.broadcast.emit("user_status_changed", {
          user_id: socket.userId,
          status: "offline",
          last_active: new Date(),
        });

        // Clean up user from in-memory cache after some time
        setTimeout(() => {
          userCache.delete(socket.userId);
        }, 300000); // 5 minutes
      } catch (error) {
        console.error("Error updating user last active:", error);
      }
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });
  });

  // OPTIMIZATION: Periodic cache cleanup
  setInterval(() => {
    // Clean up old connection cache entries (keep only recent ones)
    if (connectionCache.size > 1000) {
      const entries = Array.from(connectionCache.entries());
      entries.slice(0, 500).forEach(([key]) => {
        connectionCache.delete(key);
      });
    }

    // Clean up old room membership cache entries
    if (roomMembershipCache.size > 1000) {
      const entries = Array.from(roomMembershipCache.entries());
      entries.slice(0, 500).forEach(([key]) => {
        roomMembershipCache.delete(key);
      });
    }

    // Clean up old user cache entries
    if (userCache.size > 500) {
      const entries = Array.from(userCache.entries());
      entries.slice(0, 250).forEach(([key]) => {
        userCache.delete(key);
      });
    }
  }, 600000); // Clean up every 10 minutes

  // Helper function to check if user is online (optimized)
  function isUserOnline(userId) {
    // Use a more efficient method to check online users
    const connectedSockets = io.sockets.adapter.rooms.get(`user:${userId}`);
    return connectedSockets && connectedSockets.size > 0;
  }

  // OPTIMIZATION: Batch message processing (for high-volume scenarios)
  function processBatchedMessages() {
    if (messageBatch.length === 0) return;

    const batch = messageBatch.splice(0, BATCH_SIZE);

    // Process batch of messages
    batch.forEach(async (messageData) => {
      try {
        // Batch create messages
        const messages = await Chat.bulkCreate(
          batch.map((data) => ({
            message: data.message,
            message_type: data.message_type,
            chat_type: data.chat_type,
            sender_id: data.sender_id,
            recipient_id: data.recipient_id,
            ride_id: data.ride_id,
            group_id: data.group_id,
            metadata: data.metadata || {},
          }))
        );

        // Emit all messages
        messages.forEach((chat, index) => {
          const originalData = batch[index];
          io.to(originalData.roomName).emit("new_message", chat);

          // Send confirmation to sender
          io.to(`user:${originalData.sender_id}`).emit("message_sent", {
            id: chat.id,
            tempId: originalData.tempId,
            status: "success",
          });
        });
      } catch (error) {
        console.error("Batch message processing error:", error);

        // Send error to all senders in batch
        batch.forEach((data) => {
          io.to(`user:${data.sender_id}`).emit("message_error", {
            tempId: data.tempId,
            message: "Failed to send message",
          });
        });
      }
    });
  }

  // Start batch processing timer
  setInterval(processBatchedMessages, BATCH_TIMEOUT);

  return io;
};

module.exports = socketHandlers;
