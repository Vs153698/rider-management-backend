const jwt = require('jsonwebtoken');
const { User, Chat, Ride, Group } = require('../models');
const { cacheGet, cacheSet } = require('../config/redis');

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

    // Join user to their personal room
    socket.join(`user:${socket.userId}`);

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

    // Handle sending messages
    socket.on('send_message', async (data) => {
      try {
        const { message, message_type = 'text', ride_id, group_id, reply_to_id, metadata } = data;

        // Validate message data
        if (!message && message_type === 'text') {
          return socket.emit('message_error', { message: 'Message content required' });
        }

        if (!ride_id && !group_id) {
          return socket.emit('message_error', { message: 'Ride ID or Group ID required' });
        }

        // Check permissions
        let roomName;
        if (ride_id) {
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
        }

        if (group_id) {
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
          sender_id: socket.userId,
          ride_id,
          group_id,
          reply_to_id,
          metadata: metadata || {}
        });

        // Include sender information
        const chatWithSender = await Chat.findByPk(chat.id, {
          include: [{
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }]
        });

        // Emit to room
        io.to(roomName).emit('new_message', chatWithSender);

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

        const roomName = chat.ride_id ? `ride:${chat.ride_id}` : `group:${chat.group_id}`;
        
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

        const roomName = chat.ride_id ? `ride:${chat.ride_id}` : `group:${chat.group_id}`;
        
        // Emit deletion to room
        io.to(roomName).emit('message_deleted', {
          id: chat.id,
          deleted_at: chat.deleted_at
        });

      } catch (error) {
        socket.emit('delete_error', { message: 'Failed to delete message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      const { ride_id, group_id } = data;
      const roomName = ride_id ? `ride:${ride_id}` : `group:${group_id}`;
      
      socket.to(roomName).emit('user_typing', {
        user_id: socket.userId,
        user_name: socket.user.first_name,
        typing: true
      });
    });

    socket.on('typing_stop', (data) => {
      const { ride_id, group_id } = data;
      const roomName = ride_id ? `ride:${ride_id}` : `group:${group_id}`;
      
      socket.to(roomName).emit('user_typing', {
        user_id: socket.userId,
        user_name: socket.user.first_name,
        typing: false
      });
    });

    // Handle location sharing
    socket.on('share_location', async (data) => {
      try {
        const { latitude, longitude, ride_id, group_id, message } = data;

        const roomName = ride_id ? `ride:${ride_id}` : `group:${group_id}`;

        // Create location message
        const chat = await Chat.create({
          message: message || 'Shared location',
          message_type: 'location',
          sender_id: socket.userId,
          ride_id,
          group_id,
          metadata: {
            location: { latitude, longitude }
          }
        });

        const chatWithSender = await Chat.findByPk(chat.id, {
          include: [{
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }]
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

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User ${socket.user.first_name} disconnected: ${socket.id}`);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  return io;
};

module.exports = socketHandlers;