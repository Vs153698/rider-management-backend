// src/sockets/MainSocketManager.js
const jwt = require('jsonwebtoken');
const { User } = require('../models');

// Import all handlers
const ConnectionManager = require('./services/ConnectionManager');
const ChatCacheService = require('./services/ChatCacheService');
const MessageQueueService = require('./services/MessageQueueService');
const ChatListHandler = require('./handlers/ChatListHandler');
const MessageHandler = require('./handlers/MessageHandler');
const PresenceHandler = require('./handlers/PresenceHandler');

class MainSocketManager {
  constructor(io) {
    this.io = io;
    
    // Initialize handlers
    this.chatListHandler = new ChatListHandler(io);
    this.messageHandler = new MessageHandler(io);
    this.presenceHandler = new PresenceHandler(io);
    
    // Performance tracking
    this.connectionCount = 0;
    this.messagesPerSecond = 0;
    this.lastMessageCount = 0;
    this.setupPerformanceTracking();
    
    // Setup middleware and handlers
    this.setupMiddleware();
    this.setupConnectionHandlers();
    
    console.log('🚀 MainSocketManager initialized with all handlers');
  }

  setupMiddleware() {
    // Ultra-fast authentication middleware
    this.io.use(async (socket, next) => {
      const startTime = Date.now();
      
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Try cache first for user data
        let user = await ChatCacheService.getCachedUser(decoded.userId);
        
        if (!user) {
          // Fallback to database with minimal fields
          user = await User.findByPk(decoded.userId, {
            attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
            raw: true
          });
          
          if (!user) {
            return next(new Error('User not found'));
          }
          
          // Cache for future requests
          await ChatCacheService.cacheUser(user.id, user);
        }

        // Attach user info to socket
        socket.userId = user.id;
        socket.userInfo = user;
        
        console.log(`🔐 Auth completed for user ${user.id} in ${Date.now() - startTime}ms`);
        next();
        
      } catch (error) {
        console.error('Authentication error:', error.message);
        next(new Error('Authentication failed'));
      }
    });

    // Connection timeout settings
    this.io.engine.pingTimeout = 60000;
    this.io.engine.pingInterval = 25000;
  }

  setupConnectionHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  async handleConnection(socket) {
    const startTime = Date.now();
    
    try {
      const { userId, userInfo } = socket;
      
      // Add to connection manager
      ConnectionManager.addConnection(userId, socket.id, userInfo);
      
      // Handle user online status
      await this.presenceHandler.handleUserOnline(socket);
      
      this.connectionCount++;
      
      console.log(`✅ User ${userInfo.first_name} (${userId}) connected [${socket.id}] in ${Date.now() - startTime}ms - Total: ${this.connectionCount}`);
      
      // Setup all event handlers
      this.setupChatListHandlers(socket);
      this.setupMessageHandlers(socket);
      this.setupPresenceHandlers(socket);
      this.setupRoomHandlers(socket);
      this.setupUtilityHandlers(socket);
      
      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });
      
      // Send connection success
      socket.emit('connected', {
        userId: userId,
        timestamp: Date.now(),
        connectionTime: Date.now() - startTime
      });
      
    } catch (error) {
      console.error('Connection handling error:', error);
      socket.emit('connection_error', { message: 'Connection failed' });
      socket.disconnect();
    }
  }

  setupChatListHandlers(socket) {
    // Ultra-fast chat list operations
    socket.on('sync_chat_list', () => {
      this.chatListHandler.handleSyncChatList(socket);
    });
    
    socket.on('get_chat_stats', async () => {
      const stats = await this.chatListHandler.getChatListStats(socket.userId);
      socket.emit('chat_stats', stats);
    });
    
    socket.on('refresh_chat_list', () => {
      this.chatListHandler.forceRefreshChatList(socket.userId);
    });
  }

  setupMessageHandlers(socket) {
    // High-performance messaging
    socket.on('send_message', (data) => {
      this.messageHandler.handleSendMessage(socket, data);
    });
    
    socket.on('get_messages', (data) => {
      this.messageHandler.handleGetMessages(socket, data);
    });
    
    socket.on('edit_message', (data) => {
      this.messageHandler.handleEditMessage(socket, data);
    });
    
    socket.on('delete_message', (data) => {
      this.messageHandler.handleDeleteMessage(socket, data);
    });
    
    socket.on('mark_messages_read', (data) => {
      this.messageHandler.handleMarkMessagesRead(socket, data);
    });
  }

  setupPresenceHandlers(socket) {
    // Real-time presence and typing
    socket.on('typing_start', (data) => {
      this.presenceHandler.handleTypingStart(socket, data);
    });
    
    socket.on('typing_stop', (data) => {
      this.presenceHandler.handleTypingStop(socket, data);
    });
    
    socket.on('update_status', (data) => {
      this.presenceHandler.handleStatusUpdate(socket, data);
    });
    
    socket.on('get_contacts_presence', () => {
      this.presenceHandler.handleGetContactsPresence(socket);
    });
    
    // Live location for rides
    socket.on('update_live_location', (data) => {
      this.presenceHandler.handleLiveLocationUpdate(socket, data);
    });
    
    socket.on('get_ride_live_locations', (data) => {
      this.presenceHandler.handleGetRideLiveLocations(socket, data);
    });
  }

  setupRoomHandlers(socket) {
    // Optimized room joining/leaving
    socket.on('join_direct_conversation', async (data) => {
      await this.handleJoinDirectConversation(socket, data);
    });
    
    socket.on('leave_direct_conversation', (data) => {
      this.handleLeaveDirectConversation(socket, data);
    });
    
    socket.on('join_ride', async (data) => {
      await this.handleJoinRide(socket, data);
    });
    
    socket.on('leave_ride', (data) => {
      this.handleLeaveRide(socket, data);
    });
    
    socket.on('join_group', async (data) => {
      await this.handleJoinGroup(socket, data);
    });
    
    socket.on('leave_group', (data) => {
      this.handleLeaveGroup(socket, data);
    });
  }

  setupUtilityHandlers(socket) {
    // Status and utility endpoints
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });
    
    socket.on('get_performance_stats', () => {
      socket.emit('performance_stats', this.getPerformanceStats());
    });
    
    socket.on('heartbeat', () => {
      // Update user activity
      this.presenceHandler.updateLastActive(socket.userId);
    });
  }

  // =================== ROOM MANAGEMENT ===================

  async handleJoinDirectConversation(socket, data) {
    const { otherUserId } = data;
    
    if (!otherUserId || otherUserId === socket.userId) {
      return socket.emit('join_error', { message: 'Invalid user ID' });
    }

    try {
      // Check authorization (cached)
      const canJoin = await ConnectionManager.canJoinDirectRoom(socket.id, otherUserId);
      
      if (canJoin === false) {
        return socket.emit('join_error', { message: 'Cannot join conversation' });
      }

      // Generate room key
      const roomKey = ConnectionManager.generateDirectRoomKey(socket.userId, otherUserId);
      
      // Join room
      socket.join(roomKey);
      ConnectionManager.joinRoom(socket.id, roomKey, 'direct');
      
      socket.emit('joined_direct_conversation', {
        otherUserId,
        conversationId: roomKey,
        status: 'success'
      });
      
    } catch (error) {
      console.error('Join direct conversation error:', error);
      socket.emit('join_error', { message: 'Failed to join conversation' });
    }
  }

  handleLeaveDirectConversation(socket, data) {
    const { otherUserId } = data;
    
    if (!otherUserId) return;
    
    const roomKey = ConnectionManager.generateDirectRoomKey(socket.userId, otherUserId);
    socket.leave(roomKey);
    ConnectionManager.leaveRoom(socket.id, roomKey);
    
    socket.emit('left_direct_conversation', {
      otherUserId,
      conversationId: roomKey
    });
  }

  async handleJoinRide(socket, data) {
    const { rideId } = data;
    
    if (!rideId) {
      return socket.emit('join_error', { message: 'Ride ID required' });
    }

    try {
      // Check authorization (cached first)
      const canJoin = await ConnectionManager.canJoinRideRoom(socket.id, rideId);
      
      if (canJoin === false) {
        return socket.emit('join_error', { message: 'Not authorized to join this ride' });
      }

      if (canJoin === null) {
        // Need DB verification
        const ride = await require('../models').Ride.findByPk(rideId, {
          attributes: ['id', 'creator_id'],
          include: [{
            model: require('../models').User,
            as: 'participants',
            where: { id: socket.userId },
            required: false,
            attributes: ['id']
          }]
        });

        const isMember = ride && (
          ride.creator_id === socket.userId ||
          (ride.participants && ride.participants.length > 0)
        );

        if (!isMember) {
          return socket.emit('join_error', { message: 'Not authorized to join this ride' });
        }

        // Cache the result
        ChatCacheService.setRoomMembership(`ride:${rideId}`, socket.userId, true, 
          ride.creator_id === socket.userId ? 'creator' : 'participant');
      }

      // Generate room key and join
      const roomKey = ConnectionManager.generateRideRoomKey(rideId);
      socket.join(roomKey);
      ConnectionManager.joinRoom(socket.id, roomKey, 'ride');
      
      socket.emit('joined_ride', {
        rideId,
        roomKey,
        status: 'success'
      });
      
    } catch (error) {
      console.error('Join ride error:', error);
      socket.emit('join_error', { message: 'Failed to join ride' });
    }
  }

  handleLeaveRide(socket, data) {
    const { rideId } = data;
    
    if (!rideId) return;
    
    const roomKey = ConnectionManager.generateRideRoomKey(rideId);
    socket.leave(roomKey);
    ConnectionManager.leaveRoom(socket.id, roomKey);
    
    socket.emit('left_ride', { rideId });
  }

  async handleJoinGroup(socket, data) {
    const { groupId } = data;
    
    if (!groupId) {
      return socket.emit('join_error', { message: 'Group ID required' });
    }

    try {
      // Check authorization (cached first)
      const canJoin = await ConnectionManager.canJoinGroupRoom(socket.id, groupId);
      
      if (canJoin === false) {
        return socket.emit('join_error', { message: 'Not authorized to join this group' });
      }

      if (canJoin === null) {
        // Need DB verification
        const group = await require('../models').Group.findByPk(groupId, {
          attributes: ['id', 'admin_id'],
          include: [{
            model: require('../models').User,
            as: 'members',
            where: { id: socket.userId },
            required: false,
            attributes: ['id']
          }]
        });

        const isMember = group && (
          group.admin_id === socket.userId ||
          (group.members && group.members.length > 0)
        );

        if (!isMember) {
          return socket.emit('join_error', { message: 'Not authorized to join this group' });
        }

        // Cache the result
        ChatCacheService.setRoomMembership(`group:${groupId}`, socket.userId, true,
          group.admin_id === socket.userId ? 'admin' : 'member');
      }

      // Generate room key and join
      const roomKey = ConnectionManager.generateGroupRoomKey(groupId);
      socket.join(roomKey);
      ConnectionManager.joinRoom(socket.id, roomKey, 'group');
      
      socket.emit('joined_group', {
        groupId,
        roomKey,
        status: 'success'
      });
      
    } catch (error) {
      console.error('Join group error:', error);
      socket.emit('join_error', { message: 'Failed to join group' });
    }
  }

  handleLeaveGroup(socket, data) {
    const { groupId } = data;
    
    if (!groupId) return;
    
    const roomKey = ConnectionManager.generateGroupRoomKey(groupId);
    socket.leave(roomKey);
    ConnectionManager.leaveRoom(socket.id, roomKey);
    
    socket.emit('left_group', { groupId });
  }

  // =================== DISCONNECTION HANDLING ===================

  async handleDisconnection(socket) {
    const startTime = Date.now();
    
    try {
      const userInfo = ConnectionManager.getSocketUser(socket.id);
      
      if (userInfo) {
        const { userId } = userInfo;
        
        // Handle user offline status
        await this.presenceHandler.handleUserOffline(socket);
        
        // Remove from connection manager
        ConnectionManager.removeConnection(socket.id);
        
        this.connectionCount--;
        
        console.log(`❌ User ${userId} disconnected [${socket.id}] in ${Date.now() - startTime}ms - Total: ${this.connectionCount}`);
      }
      
    } catch (error) {
      console.error('Disconnection handling error:', error);
    }
  }

  // =================== PERFORMANCE TRACKING ===================

  setupPerformanceTracking() {
    // Track messages per second
    setInterval(() => {
      const currentMessageCount = MessageQueueService.messagesProcessed || 0;
      this.messagesPerSecond = currentMessageCount - this.lastMessageCount;
      this.lastMessageCount = currentMessageCount;
    }, 1000);

    // Log performance stats every 30 seconds
    setInterval(() => {
      const stats = this.getPerformanceStats();
      console.log(`📊 Performance: ${stats.connections} connections, ${stats.messagesPerSecond} msg/s, ${stats.cacheHitRate} cache hit rate`);
    }, 30000);
  }

  getPerformanceStats() {
    return {
      // Connection stats
      connections: this.connectionCount,
      totalUsers: ConnectionManager.getConnectionStats().uniqueUsers,
      
      // Message stats
      messagesPerSecond: this.messagesPerSecond,
      totalMessagesProcessed: MessageQueueService.messagesProcessed || 0,
      
      // Cache stats
      cacheHitRate: ChatCacheService.getStats().hitRate,
      
      // Handler stats
      chatListHandler: this.chatListHandler.getPerformanceStats?.() || {},
      messageHandler: this.messageHandler.getPerformanceStats?.() || {},
      presenceHandler: this.presenceHandler.getPerformanceStats?.() || {},
      
      // System stats
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }

  // =================== ADMIN METHODS ===================

  async handleAdminBroadcast(message, targetType = 'all', targetIds = []) {
    try {
      const broadcastData = {
        type: 'admin_broadcast',
        message,
        timestamp: Date.now()
      };

      if (targetType === 'all') {
        this.io.emit('admin_message', broadcastData);
      } else if (targetType === 'users' && targetIds.length > 0) {
        targetIds.forEach(userId => {
          const userSockets = ConnectionManager.getUserSockets(userId);
          userSockets.forEach(socketId => {
            this.io.to(socketId).emit('admin_message', broadcastData);
          });
        });
      }

      console.log(`📢 Admin broadcast sent to ${targetType}: ${message}`);
      
    } catch (error) {
      console.error('Admin broadcast error:', error);
    }
  }

  async handleSystemMaintenance(maintenanceData) {
    try {
      // Notify all connected users
      this.io.emit('system_maintenance', {
        ...maintenanceData,
        timestamp: Date.now()
      });

      // If immediate shutdown required
      if (maintenanceData.immediate) {
        setTimeout(() => {
          this.gracefulShutdown();
        }, 5000); // 5 second grace period
      }

    } catch (error) {
      console.error('System maintenance error:', error);
    }
  }

  // =================== HEALTH CHECKS ===================

  getHealthStatus() {
    const stats = this.getPerformanceStats();
    
    return {
      status: 'healthy',
      checks: {
        connections: {
          status: stats.connections > 0 ? 'up' : 'down',
          value: stats.connections
        },
        messageProcessing: {
          status: MessageQueueService.isHealthy?.() ? 'up' : 'down',
          messagesPerSecond: stats.messagesPerSecond
        },
        cache: {
          status: stats.cacheHitRate !== '0%' ? 'up' : 'down',
          hitRate: stats.cacheHitRate
        },
        memory: {
          status: stats.memoryUsage.heapUsed < 1000000000 ? 'up' : 'warning', // 1GB threshold
          heapUsed: `${Math.round(stats.memoryUsage.heapUsed / 1024 / 1024)}MB`
        }
      },
      timestamp: Date.now()
    };
  }

  // =================== GRACEFUL SHUTDOWN ===================

  async gracefulShutdown() {
    console.log('🔄 Starting graceful shutdown...');
    
    try {
      // Stop accepting new connections
      this.io.engine.close();
      
      // Notify all connected clients
      this.io.emit('server_shutting_down', {
        message: 'Server is shutting down for maintenance',
        timestamp: Date.now()
      });
      
      // Give clients time to disconnect gracefully
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Force disconnect remaining clients
      this.io.disconnectSockets(true);
      
      // Cleanup handlers
      this.presenceHandler.cleanup();
      
      // Shutdown services
      await MessageQueueService.shutdown();
      await ChatCacheService.shutdown();
      ConnectionManager.shutdown();
      
      console.log('✅ Graceful shutdown completed');
      
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
    }
  }

  // =================== ERROR HANDLING ===================

  handleSocketError(socket, error) {
    console.error(`Socket error for user ${socket.userId}:`, error);
    
    // Emit error to client
    socket.emit('socket_error', {
      message: 'A socket error occurred',
      timestamp: Date.now()
    });
    
    // Log for monitoring
    this.logError('socket_error', error, { 
      userId: socket.userId, 
      socketId: socket.id 
    });
  }

  logError(type, error, context = {}) {
    const errorLog = {
      type,
      message: error.message,
      stack: error.stack,
      context,
      timestamp: Date.now()
    };
    
    // In production, send to error tracking service
    console.error('🚨 Error logged:', errorLog);
  }

  // =================== MONITORING HOOKS ===================

  onConnectionEstablished(callback) {
    this.on('connection_established', callback);
  }

  onMessageProcessed(callback) {
    MessageQueueService.on('message:processed', callback);
  }

  onPerformanceAlert(callback) {
    this.on('performance_alert', callback);
  }
}

// Export factory function
module.exports = (io) => {
  return new MainSocketManager(io);
};