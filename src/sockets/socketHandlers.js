const jwt = require('jsonwebtoken');
const { User, Chat, Ride, Group, UserConnection } = require('../models');
const { cacheGet, cacheSet } = require('../config/redis');
const { Op } = require('sequelize');

const socketHandlers = (io) => {
  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from cache or database
      let user = await cacheGet(`user:${decoded.userId}`);
      if (!user) {
        user = await User.findByPk(decoded.userId);
        if (!user) {
          return next(new Error('User not found'));
        }
        await cacheSet(`user:${decoded.userId}`, user, 900);
      }

      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.first_name} connected: ${socket.id}`);

    // Join user to their personal room for direct messages
    socket.join(`user:${socket.userId}`);

    // Handle joining direct message conversations
    socket.on('join_direct_conversation', async (otherUserId) => {
      try {
        // Check if connection exists
        const connection = await UserConnection.findOne({
          where: {
            user_id: socket.userId,
            connected_user_id: otherUserId,
            status: { [Op.ne]: 'blocked' }
          }
        });

        if (connection) {
          const conversationId = Chat.getDirectConversationId(socket.userId, otherUserId);
          socket.join(`direct:${conversationId}`);
          socket.emit('joined_direct_conversation', { 
            otherUserId, 
            conversationId,
            status: 'success' 
          });
        } else {
          socket.emit('join_error', { message: 'No connection found with this user or user is blocked' });
        }
      } catch (error) {
        socket.emit('join_error', { message: 'Failed to join direct conversation' });
      }
    });

    // Handle leaving direct conversations
    socket.on('leave_direct_conversation', (otherUserId) => {
      const conversationId = Chat.getDirectConversationId(socket.userId, otherUserId);
      socket.leave(`direct:${conversationId}`);
      socket.emit('left_direct_conversation', { otherUserId, conversationId });
    });

    // Handle joining ride chat rooms
    socket.on('join_ride', async (rideId) => {
      try {
        const ride = await Ride.findByPk(rideId, {
          include: [{
            model: User,
            as: 'participants',
            where: { id: socket.userId },
            required: false
          }]
        });

        if (ride && (ride.creator_id === socket.userId || 
                    (ride.participants && ride.participants.length > 0))) {
          socket.join(`ride:${rideId}`);
          socket.emit('joined_ride', { rideId, status: 'success' });
        } else {
          socket.emit('join_error', { message: 'Not authorized to join this ride' });
        }
      } catch (error) {
        socket.emit('join_error', { message: 'Failed to join ride' });
      }
    });

    // Handle joining group chat rooms
    socket.on('join_group', async (groupId) => {
      try {
        const group = await Group.findByPk(groupId, {
          include: [{
            model: User,
            as: 'members',
            where: { id: socket.userId },
            required: false
          }]
        });

        if (group && (group.admin_id === socket.userId || 
                     (group.members && group.members.length > 0))) {
          socket.join(`group:${groupId}`);
          socket.emit('joined_group', { groupId, status: 'success' });
        } else {
          socket.emit('join_error', { message: 'Not authorized to join this group' });
        }
      } catch (error) {
        socket.emit('join_error', { message: 'Failed to join group' });
      }
    });

    // Handle leaving rooms
    socket.on('leave_ride', (rideId) => {
      socket.leave(`ride:${rideId}`);
      socket.emit('left_ride', { rideId });
    });

    socket.on('leave_group', (groupId) => {
      socket.leave(`group:${groupId}`);
      socket.emit('left_group', { groupId });
    });

    // Handle sending messages (enhanced for all chat types)
    socket.on('send_message', async (data) => {
      try {
        const { 
          message, 
          message_type = 'text', 
          chat_type = 'direct',
          recipient_id,
          ride_id, 
          group_id, 
          reply_to_id, 
          metadata 
        } = data;

        // Validate message data
        if (!message && message_type === 'text') {
          return socket.emit('message_error', { message: 'Message content required' });
        }

        // Validate chat context
        if (chat_type === 'direct' && !recipient_id) {
          return socket.emit('message_error', { message: 'Recipient ID required for direct messages' });
        }
        if (chat_type === 'ride' && !ride_id) {
          return socket.emit('message_error', { message: 'Ride ID required for ride messages' });
        }
        if (chat_type === 'group' && !group_id) {
          return socket.emit('message_error', { message: 'Group ID required for group messages' });
        }

        let roomName;
        let targetUsers = [];

        // Handle different chat types
        if (chat_type === 'direct') {
          // Check if recipient exists and connection is valid
          const recipient = await User.findByPk(recipient_id);
          if (!recipient) {
            return socket.emit('message_error', { message: 'Recipient not found' });
          }

          // Check connection status
          const connection = await UserConnection.findOne({
            where: {
              user_id: socket.userId,
              connected_user_id: recipient_id,
              status: { [Op.ne]: 'blocked' }
            }
          });

          if (!connection) {
            // Create connection if it doesn't exist (like Snapchat)
            await UserConnection.findOrCreateConnection(socket.userId, recipient_id, socket.userId);
          }

          roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
          targetUsers = [recipient_id];

        } else if (chat_type === 'ride') {
          const ride = await Ride.findByPk(ride_id, {
            include: [{
              model: User,
              as: 'participants',
              where: { id: socket.userId },
              required: false
            }]
          });

          if (!ride || (ride.creator_id !== socket.userId && 
                       (!ride.participants || ride.participants.length === 0))) {
            return socket.emit('message_error', { message: 'Not authorized to send messages in this ride' });
          }
          roomName = `ride:${ride_id}`;

        } else if (chat_type === 'group') {
          const group = await Group.findByPk(group_id, {
            include: [{
              model: User,
              as: 'members',
              where: { id: socket.userId },
              required: false
            }]
          });

          if (!group || (group.admin_id !== socket.userId && 
                        (!group.members || group.members.length === 0))) {
            return socket.emit('message_error', { message: 'Not authorized to send messages in this group' });
          }
          roomName = `group:${group_id}`;
        }

        // Create chat message
        const chat = await Chat.create({
          message,
          message_type,
          chat_type,
          sender_id: socket.userId,
          recipient_id,
          ride_id,
          group_id,
          reply_to_id,
          metadata: metadata || {}
        });

        // Update connection last message time for direct messages
        if (chat_type === 'direct') {
          await UserConnection.update(
            { last_message_at: new Date() },
            {
              where: {
                [Op.or]: [
                  { user_id: socket.userId, connected_user_id: recipient_id },
                  { user_id: recipient_id, connected_user_id: socket.userId }
                ]
              }
            }
          );
        }

        // Include sender and recipient information
        const chatWithUsers = await Chat.findByPk(chat.id, {
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['id', 'first_name', 'last_name', 'profile_picture']
            },
            {
              model: User,
              as: 'recipient',
              attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
              required: false
            }
          ]
        });

        // Emit to appropriate room
        io.to(roomName).emit('new_message', chatWithUsers);

        // For direct messages, also notify the recipient's personal room
        if (chat_type === 'direct') {
          io.to(`user:${recipient_id}`).emit('new_direct_message', {
            ...chatWithUsers.toJSON(),
            conversation_id: Chat.getDirectConversationId(socket.userId, recipient_id)
          });
        }

        // Send confirmation to sender
        socket.emit('message_sent', { id: chat.id, status: 'success' });

      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('message_error', { message: 'Failed to send message' });
      }
    });

    // Handle message editing
    socket.on('edit_message', async (data) => {
      try {
        const { message_id, new_message } = data;

        const chat = await Chat.findByPk(message_id);
        
        if (!chat || chat.sender_id !== socket.userId || chat.is_deleted) {
          return socket.emit('edit_error', { message: 'Cannot edit this message' });
        }

        await chat.update({
          message: new_message,
          is_edited: true,
          edited_at: new Date()
        });

        let roomName;
        if (chat.chat_type === 'direct') {
          roomName = `direct:${Chat.getDirectConversationId(chat.sender_id, chat.recipient_id)}`;
        } else if (chat.chat_type === 'ride') {
          roomName = `ride:${chat.ride_id}`;
        } else if (chat.chat_type === 'group') {
          roomName = `group:${chat.group_id}`;
        }
        
        // Emit updated message to room
        io.to(roomName).emit('message_edited', {
          id: chat.id,
          message: new_message,
          is_edited: true,
          edited_at: chat.edited_at
        });

      } catch (error) {
        socket.emit('edit_error', { message: 'Failed to edit message' });
      }
    });

    // Handle message deletion
    socket.on('delete_message', async (data) => {
      try {
        const { message_id } = data;

        const chat = await Chat.findByPk(message_id);
        
        if (!chat || chat.sender_id !== socket.userId || chat.is_deleted) {
          return socket.emit('delete_error', { message: 'Cannot delete this message' });
        }

        chat.softDelete();
        await chat.save();

        let roomName;
        if (chat.chat_type === 'direct') {
          roomName = `direct:${Chat.getDirectConversationId(chat.sender_id, chat.recipient_id)}`;
        } else if (chat.chat_type === 'ride') {
          roomName = `ride:${chat.ride_id}`;
        } else if (chat.chat_type === 'group') {
          roomName = `group:${chat.group_id}`;
        }
        
        // Emit deletion to room
        io.to(roomName).emit('message_deleted', {
          id: chat.id,
          deleted_at: chat.deleted_at
        });

      } catch (error) {
        socket.emit('delete_error', { message: 'Failed to delete message' });
      }
    });

    // Handle typing indicators (enhanced for all chat types)
    socket.on('typing_start', (data) => {
      const { chat_type, recipient_id, ride_id, group_id } = data;
      
      let roomName;
      if (chat_type === 'direct') {
        roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
      } else if (chat_type === 'ride') {
        roomName = `ride:${ride_id}`;
      } else if (chat_type === 'group') {
        roomName = `group:${group_id}`;
      }
      
      socket.to(roomName).emit('user_typing', {
        user_id: socket.userId,
        user_name: socket.user.first_name,
        chat_type,
        typing: true
      });
    });

    socket.on('typing_stop', (data) => {
      const { chat_type, recipient_id, ride_id, group_id } = data;
      
      let roomName;
      if (chat_type === 'direct') {
        roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
      } else if (chat_type === 'ride') {
        roomName = `ride:${ride_id}`;
      } else if (chat_type === 'group') {
        roomName = `group:${group_id}`;
      }
      
      socket.to(roomName).emit('user_typing', {
        user_id: socket.userId,
        user_name: socket.user.first_name,
        chat_type,
        typing: false
      });
    });

    // Handle read receipts for direct messages
    socket.on('mark_messages_read', async (data) => {
      try {
        const { chat_type, sender_id, message_ids } = data;

        if (chat_type === 'direct' && sender_id) {
          // Mark all unread messages from sender as read
          await Chat.update(
            { is_read: true, read_at: new Date() },
            {
              where: {
                chat_type: 'direct',
                sender_id: sender_id,
                recipient_id: socket.userId,
                is_read: false,
                is_deleted: false
              }
            }
          );

          // Notify sender about read receipt
          const conversationId = Chat.getDirectConversationId(socket.userId, sender_id);
          socket.to(`direct:${conversationId}`).emit('messages_read', {
            reader_id: socket.userId,
            reader_name: socket.user.first_name,
            read_at: new Date()
          });

        } else if (message_ids && Array.isArray(message_ids)) {
          // Mark specific messages as read
          await Chat.update(
            { is_read: true, read_at: new Date() },
            {
              where: {
                id: { [Op.in]: message_ids },
                recipient_id: socket.userId,
                is_read: false
              }
            }
          );
        }

        socket.emit('mark_read_success', { 
          chat_type, 
          sender_id, 
          message_count: message_ids?.length || 'all' 
        });

      } catch (error) {
        socket.emit('mark_read_error', { message: 'Failed to mark messages as read' });
      }
    });

    // Handle user status updates (online/offline)
    socket.on('update_status', async (status) => {
      try {
        await User.update(
          { last_active: new Date() },
          { where: { id: socket.userId } }
        );

        // Notify all connected users about status change
        socket.broadcast.emit('user_status_changed', {
          user_id: socket.userId,
          status,
          last_active: new Date()
        });

      } catch (error) {
        console.error('Status update error:', error);
      }
    });

    // Handle blocking/unblocking users
    socket.on('block_user', async (data) => {
      try {
        const { user_id, action } = data; // action: 'block' or 'unblock'

        const connection = await UserConnection.findOne({
          where: {
            user_id: socket.userId,
            connected_user_id: user_id
          }
        });

        if (connection) {
          const newStatus = action === 'block' ? 'blocked' : 'active';
          await connection.update({ status: newStatus });

          socket.emit('user_blocked', {
            user_id,
            status: newStatus,
            action
          });

          // If blocking, leave any direct conversation rooms
          if (action === 'block') {
            const conversationId = Chat.getDirectConversationId(socket.userId, user_id);
            socket.leave(`direct:${conversationId}`);
          }
        }

      } catch (error) {
        socket.emit('block_error', { message: 'Failed to update user status' });
      }
    });

    // Handle location sharing (enhanced for all chat types)
    socket.on('share_location', async (data) => {
      try {
        const { 
          latitude, 
          longitude, 
          chat_type, 
          recipient_id, 
          ride_id, 
          group_id, 
          message 
        } = data;

        let roomName;
        if (chat_type === 'direct') {
          roomName = `direct:${Chat.getDirectConversationId(socket.userId, recipient_id)}`;
        } else if (chat_type === 'ride') {
          roomName = `ride:${ride_id}`;
        } else if (chat_type === 'group') {
          roomName = `group:${group_id}`;
        }

        // Create location message
        const chat = await Chat.create({
          message: message || 'Shared location',
          message_type: 'location',
          chat_type,
          sender_id: socket.userId,
          recipient_id,
          ride_id,
          group_id,
          metadata: {
            location: { latitude, longitude }
          }
        });

        const chatWithSender = await Chat.findByPk(chat.id, {
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['id', 'first_name', 'last_name', 'profile_picture']
            },
            {
              model: User,
              as: 'recipient',
              attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
              required: false
            }
          ]
        });

        io.to(roomName).emit('new_message', chatWithSender);

      } catch (error) {
        socket.emit('location_error', { message: 'Failed to share location' });
      }
    });

    // Handle live location updates during rides
    socket.on('update_live_location', (data) => {
      const { latitude, longitude, ride_id } = data;
      
      if (ride_id) {
        socket.to(`ride:${ride_id}`).emit('live_location_update', {
          user_id: socket.userId,
          latitude,
          longitude,
          timestamp: new Date()
        });
      }
    });

    // Handle starting new conversations (like adding friends on Snapchat)
    socket.on('start_conversation', async (data) => {
      try {
        const { user_id, initial_message } = data;

        if (user_id === socket.userId) {
          return socket.emit('conversation_error', { message: 'Cannot start conversation with yourself' });
        }

        // Check if user exists
        const user = await User.findByPk(user_id, {
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        });

        if (!user) {
          return socket.emit('conversation_error', { message: 'User not found' });
        }

        // Create or find connection
        const connection = await UserConnection.findOrCreateConnection(socket.userId, user_id, socket.userId);

        // Join conversation room
        const conversationId = Chat.getDirectConversationId(socket.userId, user_id);
        socket.join(`direct:${conversationId}`);

        // Send initial message if provided
        if (initial_message) {
          const chat = await Chat.create({
            message: initial_message,
            message_type: 'text',
            chat_type: 'direct',
            sender_id: socket.userId,
            recipient_id: user_id
          });

          const chatWithSender = await Chat.findByPk(chat.id, {
            include: [{
              model: User,
              as: 'sender',
              attributes: ['id', 'first_name', 'last_name', 'profile_picture']
            }]
          });

          // Notify recipient
          io.to(`user:${user_id}`).emit('new_conversation_started', {
            initiator: socket.user,
            conversation_id: conversationId,
            initial_message: chatWithSender
          });

          io.to(`direct:${conversationId}`).emit('new_message', chatWithSender);
        }

        socket.emit('conversation_started', {
          user: user,
          conversation_id: conversationId,
          connection_id: connection.id
        });

      } catch (error) {
        socket.emit('conversation_error', { message: 'Failed to start conversation' });
      }
    });

    // Handle getting online status of connections
    socket.on('get_connections_status', async () => {
      try {
        const connections = await UserConnection.findAll({
          where: {
            user_id: socket.userId,
            status: 'active',
            is_archived: false
          },
          include: [{
            model: User,
            as: 'connectedUser',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active']
          }]
        });

        const connectionsStatus = connections.map(conn => ({
          user_id: conn.connected_user_id,
          user: conn.connectedUser,
          is_online: isUserOnline(conn.connected_user_id), // You'd implement this function
          last_active: conn.connectedUser.last_active
        }));

        socket.emit('connections_status', connectionsStatus);

      } catch (error) {
        socket.emit('status_error', { message: 'Failed to get connections status' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`User ${socket.user.first_name} disconnected: ${socket.id}`);
      
      // Update last active time
      try {
        await User.update(
          { last_active: new Date() },
          { where: { id: socket.userId } }
        );

        // Notify connections about offline status
        socket.broadcast.emit('user_status_changed', {
          user_id: socket.userId,
          status: 'offline',
          last_active: new Date()
        });

      } catch (error) {
        console.error('Error updating user last active:', error);
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  // Helper function to check if user is online (you'd implement this based on your needs)
  function isUserOnline(userId) {
    // Check if user has any active socket connections
    const userSockets = Array.from(io.sockets.sockets.values())
      .filter(socket => socket.userId === userId);
    return userSockets.length > 0;
  }

  return io;
};

module.exports = socketHandlers;