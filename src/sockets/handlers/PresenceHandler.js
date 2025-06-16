// src/handlers/PresenceHandler.js
const ChatCacheService = require('../services/ChatCacheService');
const ConnectionManager = require('../services/ConnectionManager');
const { User } = require('../../models');

class PresenceHandler {
  constructor(io) {
    this.io = io;
    
    // Typing management
    this.typingTimeouts = new Map(); // socketId -> timeout
    this.userTypingStatus = new Map(); // userId -> { rooms: Set, lastUpdate: timestamp }
    
    // Presence management
    this.presenceTimeouts = new Map(); // userId -> timeout
    this.lastActiveUpdates = new Map(); // userId -> timestamp
    
    // Performance settings
    this.typingTimeout = 3000; // 3 seconds
    this.presenceUpdateInterval = 30000; // 30 seconds
    this.presenceBatchSize = 50;
    
    this.setupPeriodicTasks();
  }

  setupPeriodicTasks() {
    // Batch presence updates every 30 seconds
    setInterval(() => {
      this.batchUpdatePresence();
    }, this.presenceUpdateInterval);
    
    // Cleanup expired typing indicators every 5 seconds
    setInterval(() => {
      this.cleanupExpiredTyping();
    }, 5000);
  }

  // =================== TYPING INDICATORS ===================

  handleTypingStart(socket, data) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;
    const { chat_type, recipient_id, ride_id, group_id } = data;

    // Prevent self-typing
    if (chat_type === 'direct' && recipient_id === userId) return;

    try {
      // Generate room key
      const roomKey = this.generateRoomKey(chat_type, userId, { recipient_id, ride_id, group_id });
      if (!roomKey) return;

      // Clear existing timeout for this socket
      const existingTimeout = this.typingTimeouts.get(socket.id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Update typing status
      this.updateTypingStatus(userId, roomKey, true);

      // Broadcast typing start
      this.broadcastTypingIndicator(roomKey, userId, userInfo, true);

      // Set auto-stop timeout
      const timeout = setTimeout(() => {
        this.handleTypingStop(socket, data);
      }, this.typingTimeout);

      this.typingTimeouts.set(socket.id, timeout);

    } catch (error) {
      console.error('Typing start error:', error);
    }
  }

  handleTypingStop(socket, data) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;
    const { chat_type, recipient_id, ride_id, group_id } = data;

    // Prevent self-typing
    if (chat_type === 'direct' && recipient_id === userId) return;

    try {
      // Generate room key
      const roomKey = this.generateRoomKey(chat_type, userId, { recipient_id, ride_id, group_id });
      if (!roomKey) return;

      // Clear timeout
      const existingTimeout = this.typingTimeouts.get(socket.id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.typingTimeouts.delete(socket.id);
      }

      // Update typing status
      this.updateTypingStatus(userId, roomKey, false);

      // Broadcast typing stop
      this.broadcastTypingIndicator(roomKey, userId, userInfo, false);

    } catch (error) {
      console.error('Typing stop error:', error);
    }
  }

  updateTypingStatus(userId, roomKey, isTyping) {
    if (!this.userTypingStatus.has(userId)) {
      this.userTypingStatus.set(userId, { 
        rooms: new Set(), 
        lastUpdate: Date.now() 
      });
    }

    const userStatus = this.userTypingStatus.get(userId);
    
    if (isTyping) {
      userStatus.rooms.add(roomKey);
    } else {
      userStatus.rooms.delete(roomKey);
    }
    
    userStatus.lastUpdate = Date.now();

    // Update cache service
    ChatCacheService.setUserTyping(roomKey, userId, this.getUserName(userId), isTyping);
  }

  broadcastTypingIndicator(roomKey, userId, userInfo, isTyping) {
    const typingData = {
      user_id: userId,
      user_name: `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim(),
      typing: isTyping,
      timestamp: Date.now()
    };

    // Broadcast to room (excluding sender)
    this.io.to(roomKey).emit('user_typing', typingData);

    // Also broadcast to direct user rooms for better real-time experience
    if (roomKey.startsWith('direct:')) {
      const userIds = this.extractUserIdsFromDirectRoom(roomKey);
      userIds.forEach(targetUserId => {
        if (targetUserId !== userId) {
          const userRoomKey = ConnectionManager.generateUserRoomKey(targetUserId);
          this.io.to(userRoomKey).emit('user_typing', typingData);
        }
      });
    }
  }

  cleanupExpiredTyping() {
    const now = Date.now();
    const expiredUsers = [];

    for (const [userId, status] of this.userTypingStatus.entries()) {
      if (now - status.lastUpdate > this.typingTimeout) {
        expiredUsers.push(userId);
      }
    }

    // Clean up expired typing indicators
    expiredUsers.forEach(userId => {
      const status = this.userTypingStatus.get(userId);
      if (status) {
        status.rooms.forEach(roomKey => {
          ChatCacheService.setUserTyping(roomKey, userId, null, false);
          
          // Broadcast stop typing
          this.io.to(roomKey).emit('user_typing', {
            user_id: userId,
            typing: false,
            timestamp: now
          });
        });
        
        this.userTypingStatus.delete(userId);
      }
    });
  }

  // =================== PRESENCE MANAGEMENT ===================

  async handleUserOnline(socket) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;

    try {
      // Set user online in cache
      ChatCacheService.setUserOnline(userId, socket.id);

      // Join user's personal room
      socket.join(ConnectionManager.generateUserRoomKey(userId));

      // Broadcast online status to contacts
      await this.broadcastPresenceUpdate(userId, 'online');

      // Update last active timestamp
      this.updateLastActive(userId);

      console.log(`👤 User ${userId} is now online`);

    } catch (error) {
      console.error('User online error:', error);
    }
  }

  async handleUserOffline(socket) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;

    try {
      // Only mark offline if this was the last socket
      const userSockets = ConnectionManager.getUserSockets(userId);
      
      if (userSockets.size <= 1) { // This socket is about to be removed
        // Set user offline in cache
        ChatCacheService.setUserOffline(userId, socket.id);

        // Broadcast offline status to contacts
        await this.broadcastPresenceUpdate(userId, 'offline');

        // Update last active timestamp
        await this.updateLastActiveInDB(userId);

        console.log(`👤 User ${userId} is now offline`);
      }

      // Clean up typing indicators for this socket
      this.cleanupSocketTyping(socket.id);

    } catch (error) {
      console.error('User offline error:', error);
    }
  }

  async broadcastPresenceUpdate(userId, status) {
    try {
      // Get user's contacts who should receive presence updates
      const contacts = await this.getUserContacts(userId);

      // Prepare presence data
      const presenceData = {
        user_id: userId,
        status: status,
        last_active: new Date().toISOString(),
        timestamp: Date.now()
      };

      // Broadcast to each contact's sockets
      contacts.forEach(contactId => {
        const contactSockets = ConnectionManager.getUserSockets(contactId);
        contactSockets.forEach(socketId => {
          this.io.to(socketId).emit('user_presence_changed', presenceData);
        });
      });

    } catch (error) {
      console.error('Presence broadcast error:', error);
    }
  }

  updateLastActive(userId) {
    // Throttle database updates
    const now = Date.now();
    const lastUpdate = this.lastActiveUpdates.get(userId);
    
    if (!lastUpdate || now - lastUpdate > this.presenceUpdateInterval) {
      this.lastActiveUpdates.set(userId, now);
      
      // Schedule database update
      this.schedulePresenceUpdate(userId);
    }
  }

  schedulePresenceUpdate(userId) {
    // Clear existing timeout
    const existingTimeout = this.presenceTimeouts.get(userId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(async () => {
      await this.updateLastActiveInDB(userId);
      this.presenceTimeouts.delete(userId);
    }, 5000); // 5 second delay

    this.presenceTimeouts.set(userId, timeout);
  }

  async updateLastActiveInDB(userId) {
    try {
      await User.update(
        { last_active: new Date() },
        { 
          where: { id: userId },
          validate: false // Skip validation for better performance
        }
      );
    } catch (error) {
      console.error('Last active update error:', error);
    }
  }

  batchUpdatePresence() {
    const now = Date.now();
    const usersToUpdate = [];

    // Collect users that need presence updates
    for (const [userId, timestamp] of this.lastActiveUpdates.entries()) {
      if (now - timestamp < this.presenceUpdateInterval + 5000) { // 5 second buffer
        usersToUpdate.push(userId);
      }
    }

    if (usersToUpdate.length === 0) return;

    // Batch update in chunks
    const chunks = this.chunkArray(usersToUpdate, this.presenceBatchSize);
    
    chunks.forEach(async (chunk) => {
      try {
        await User.update(
          { last_active: new Date() },
          { 
            where: { id: chunk },
            validate: false
          }
        );
        
        // Remove from pending updates
        chunk.forEach(userId => {
          this.lastActiveUpdates.delete(userId);
        });
        
      } catch (error) {
        console.error('Batch presence update error:', error);
      }
    });

    console.log(`📊 Batch updated presence for ${usersToUpdate.length} users`);
  }

  // =================== STATUS UPDATES ===================

  async handleStatusUpdate(socket, statusData) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;

    try {
      // Update user's status
      await User.update(
        { 
          status_message: statusData.message,
          status_emoji: statusData.emoji,
          status_expires_at: statusData.expiresAt
        },
        { where: { id: userId } }
      );

      // Broadcast status update
      const contacts = await this.getUserContacts(userId);
      
      const statusUpdateData = {
        user_id: userId,
        status_message: statusData.message,
        status_emoji: statusData.emoji,
        status_expires_at: statusData.expiresAt,
        timestamp: Date.now()
      };

      contacts.forEach(contactId => {
        const contactSockets = ConnectionManager.getUserSockets(contactId);
        contactSockets.forEach(socketId => {
          this.io.to(socketId).emit('user_status_updated', statusUpdateData);
        });
      });

      socket.emit('status_update_success', statusUpdateData);

    } catch (error) {
      console.error('Status update error:', error);
      socket.emit('status_update_error', { message: 'Failed to update status' });
    }
  }

  // =================== BULK PRESENCE QUERIES ===================

  async handleGetContactsPresence(socket) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;

    try {
      const contacts = await this.getUserContacts(userId);
      const presenceData = [];

      for (const contactId of contacts) {
        const isOnline = ChatCacheService.isUserOnline(contactId);
        const cachedUser = await ChatCacheService.getCachedUser(contactId);
        
        presenceData.push({
          user_id: contactId,
          is_online: isOnline,
          last_active: cachedUser?.last_active || null,
          status_message: cachedUser?.status_message || null,
          status_emoji: cachedUser?.status_emoji || null
        });
      }

      socket.emit('contacts_presence', presenceData);

    } catch (error) {
      console.error('Get contacts presence error:', error);
      socket.emit('presence_error', { message: 'Failed to get contacts presence' });
    }
  }

  // =================== UTILITY METHODS ===================

  generateRoomKey(chat_type, userId, params) {
    if (chat_type === 'direct') {
      return ConnectionManager.generateDirectRoomKey(userId, params.recipient_id);
    } else if (chat_type === 'ride') {
      return ConnectionManager.generateRideRoomKey(params.ride_id);
    } else if (chat_type === 'group') {
      return ConnectionManager.generateGroupRoomKey(params.group_id);
    }
    return null;
  }

  extractUserIdsFromDirectRoom(roomKey) {
    const match = roomKey.match(/direct:(\d+):(\d+)/);
    return match ? [parseInt(match[1]), parseInt(match[2])] : [];
  }

  getUserName(userId) {
    const userInfo = ConnectionManager.getSocketUser(userId);
    return userInfo ? `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim() : 'Unknown';
  }

  async getUserContacts(userId) {
    try {
      // Try cache first
      const connections = await ChatCacheService.getUserConnections(userId);
      if (connections) {
        return connections
          .filter(conn => conn.status === 'accepted')
          .map(conn => conn.connected_user_id);
      }

      // Fallback to database
      const userConnections = await require('../../models').UserConnection.findAll({
        where: {
          user_id: userId,
          status: 'accepted'
        },
        attributes: ['connected_user_id']
      });

      return userConnections.map(conn => conn.connected_user_id);

    } catch (error) {
      console.error('Get user contacts error:', error);
      return [];
    }
  }

  cleanupSocketTyping(socketId) {
    // Clear timeout
    const timeout = this.typingTimeouts.get(socketId);
    if (timeout) {
      clearTimeout(timeout);
      this.typingTimeouts.delete(socketId);
    }

    // Find and cleanup user typing status
    const userInfo = ConnectionManager.getSocketUser(socketId);
    if (userInfo) {
      const userStatus = this.userTypingStatus.get(userInfo.userId);
      if (userStatus) {
        userStatus.rooms.forEach(roomKey => {
          ChatCacheService.setUserTyping(roomKey, userInfo.userId, null, false);
        });
        
        if (userStatus.rooms.size === 0) {
          this.userTypingStatus.delete(userInfo.userId);
        }
      }
    }
  }

  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // =================== LIVE LOCATION UPDATES ===================

  handleLiveLocationUpdate(socket, data) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;
    const { latitude, longitude, ride_id, accuracy, timestamp } = data;

    try {
      // Validate location data
      if (!latitude || !longitude || !ride_id) {
        return socket.emit('location_error', { message: 'Invalid location data' });
      }

      // Check if user is part of the ride
      const membership = ChatCacheService.getRoomMembership(`ride:${ride_id}`, userId);
      if (membership === false) {
        return socket.emit('location_error', { message: 'Not authorized for this ride' });
      }

      // Prepare location update
      const locationUpdate = {
        user_id: userId,
        user_name: `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim(),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        accuracy: accuracy || null,
        timestamp: timestamp || Date.now()
      };

      // Broadcast to ride participants
      const rideRoomKey = ConnectionManager.generateRideRoomKey(ride_id);
      socket.to(rideRoomKey).emit('live_location_update', locationUpdate);

      // Cache location for brief period (for late joiners)
      ChatCacheService.redis.setex(
        `location:${ride_id}:${userId}`, 
        300, // 5 minutes
        JSON.stringify(locationUpdate)
      );

    } catch (error) {
      console.error('Live location update error:', error);
      socket.emit('location_error', { message: 'Failed to update location' });
    }
  }

  async handleGetRideLiveLocations(socket, data) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;
    const { ride_id } = data;

    try {
      // Check authorization
      const membership = ChatCacheService.getRoomMembership(`ride:${ride_id}`, userId);
      if (membership === false) {
        return socket.emit('location_error', { message: 'Not authorized for this ride' });
      }

      // Get all cached locations for this ride
      const locationKeys = await ChatCacheService.redis.keys(`location:${ride_id}:*`);
      const locations = [];

      for (const key of locationKeys) {
        const locationData = await ChatCacheService.redis.get(key);
        if (locationData) {
          locations.push(JSON.parse(locationData));
        }
      }

      socket.emit('ride_live_locations', {
        ride_id,
        locations,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Get ride live locations error:', error);
      socket.emit('location_error', { message: 'Failed to get live locations' });
    }
  }

  // =================== PERFORMANCE MONITORING ===================

  getPerformanceStats() {
    return {
      typingIndicators: {
        activeUsers: this.userTypingStatus.size,
        activeTimeouts: this.typingTimeouts.size
      },
      presence: {
        pendingUpdates: this.lastActiveUpdates.size,
        activeTimeouts: this.presenceTimeouts.size,
        onlineUsers: ChatCacheService.getOnlineUsers().length
      },
      performance: {
        typingTimeout: this.typingTimeout,
        presenceUpdateInterval: this.presenceUpdateInterval,
        presenceBatchSize: this.presenceBatchSize
      }
    };
  }

  // =================== CLEANUP ===================

  cleanup() {
    // Clear all timeouts
    this.typingTimeouts.forEach(timeout => clearTimeout(timeout));
    this.presenceTimeouts.forEach(timeout => clearTimeout(timeout));
    
    // Clear maps
    this.typingTimeouts.clear();
    this.userTypingStatus.clear();
    this.presenceTimeouts.clear();
    this.lastActiveUpdates.clear();
    
    console.log('✅ Presence handler cleanup complete');
  }
}

module.exports = PresenceHandler;