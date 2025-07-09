// src/sockets/socketManager.js - High-performance socket manager for lakhs of users
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const { Chat, User, UserConnection, Group, Ride } = require('../models');
const { Op } = require('sequelize');

class HighPerformanceSocketManager {
  constructor(io) {
    this.io = io;
    this.connections = new Map(); // userId -> Set of socketIds
    this.socketUsers = new Map(); // socketId -> userId
    this.roomMembers = new Map(); // roomId -> Set of userIds
    this.typingUsers = new Map(); // roomId -> Set of userIds
    this.presenceCache = new Map(); // userId -> presence data
    
    // Performance metrics
    this.metrics = {
      messagesPerSecond: 0,
      connectionsCount: 0,
      roomsCount: 0,
      messagesSent: 0,
      startTime: Date.now()
    };
    
    // Initialize Redis for scaling
    this.initializeRedis();
    
    // Setup message queues for high throughput
    this.messageQueue = [];
    this.processingQueue = false;
    
    // Setup presence heartbeat
    this.setupPresenceSystem();
    
    // Initialize socket handlers
    this.initializeSocketHandlers();
    
    // Setup performance monitoring
    this.setupMetrics();
    
    console.log('🚀 High-Performance Socket Manager initialized');
  }
  
  initializeRedis() {
    try {
      this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
      
      this.redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
      
      // Setup Redis pub/sub for multi-server scaling
      this.redisSub.subscribe('chat_message', 'friend_request', 'presence_update', 'chat_list_update');
      
      this.redisSub.on('message', (channel, message) => {
        this.handleRedisMessage(channel, JSON.parse(message));
      });
      
      console.log('✅ Redis initialized for horizontal scaling');
    } catch (error) {
      console.warn('⚠️ Redis not available, running in single-server mode');
      this.redis = null;
    }
  }
  
  initializeSocketHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }
  
async handleConnection(socket) {
  console.log(`🔌 New connection: ${socket.id}`);
  
  // Set connection timeout
  const connectionTimeout = setTimeout(() => {
    console.log(`⏰ Connection timeout for ${socket.id}`);
    socket.emit('auth_error', { message: 'Authentication timeout' });
    socket.disconnect();
  }, 30000); // 30 seconds timeout
  
  // Authentication middleware
  socket.on('authenticate', async (data) => {
    try {
      clearTimeout(connectionTimeout);
      
      const { userId, token } = data;
      
      console.log(`🔐 Authentication attempt for user ${userId}`);
      
      if (!userId || !token) {
        console.error('❌ Missing authentication data');
        socket.emit('auth_error', { message: 'Missing authentication data' });
        return socket.disconnect();
      }
      
      // Verify user authentication
      const user = await this.authenticateUser(userId, token);
      if (!user) {
        console.error('❌ Authentication failed for user', userId);
        socket.emit('auth_error', { message: 'Authentication failed' });
        return socket.disconnect();
      }
      
      // Store user connection
      socket.userId = userId;
      this.socketUsers.set(socket.id, userId);
      
      if (!this.connections.has(userId)) {
        this.connections.set(userId, new Set());
      }
      this.connections.get(userId).add(socket.id);
      
      // Update metrics
      this.metrics.connectionsCount = this.connections.size;
      
      // Join user to their personal room
      socket.join(`user_${userId}`);
      
      // Load user's rooms (chats, groups, rides)
      await this.loadUserRooms(socket, userId);
      
      // Update presence
      await this.updatePresence(userId, 'online');
      
      // Send authentication success
      socket.emit('authenticated', { 
        status: 'success',
        userId,
        connectionTime: new Date(),
        socketId: socket.id
      });
      
      console.log(`✅ User ${userId} authenticated successfully with socket ${socket.id}`);
      
      // Send initial data after authentication
      setTimeout(() => {
        this.sendInitialData(socket, userId);
      }, 500);
      
    } catch (error) {
      console.error('❌ Authentication error:', error);
      socket.emit('auth_error', { 
        message: 'Authentication failed',
        details: error.message 
      });
      socket.disconnect();
    }
  });
  
  // Set up other handlers...
  this.setupUserHandlers(socket);
  
  // Handle disconnect
  socket.on('disconnect', () => {
    clearTimeout(connectionTimeout);
    this.handleDisconnect(socket);
  });
}
async handleRedisMessage(channel, data) {
  try {
    console.log(`📡 Redis message received on channel: ${channel}`);
    
    switch (channel) {
      case 'chat_message':
        await this.handleRedisMessageBroadcast(data);
        break;
        
      case 'friend_request':
        await this.handleRedisFriendRequest(data);
        break;
        
      case 'presence_update':
        await this.handleRedisPresenceUpdate(data);
        break;
        
      case 'chat_list_update':
        await this.handleRedisChatListUpdate(data);
        break;
        
      case 'user_connection':
        await this.handleRedisUserConnection(data);
        break;
        
      case 'room_update':
        await this.handleRedisRoomUpdate(data);
        break;
        
      case 'notification':
        await this.handleRedisNotification(data);
        break;
        
      default:
        console.warn(`⚠️ Unknown Redis channel: ${channel}`);
    }
    
  } catch (error) {
    console.error(`❌ Redis message handler error for channel ${channel}:`, error);
    this.logError('redis_message_handler', error, { channel, data });
  }
}

// Handle chat message broadcasts from other servers
async handleRedisMessageBroadcast(data) {
  try {
    const { message, chat_type, recipient_id, ride_id, group_id, server_id } = data;
    
    // Prevent infinite loops by checking if message originated from this server
    if (server_id === process.env.SERVER_ID) {
      return;
    }
    
    console.log(`💬 Broadcasting message from Redis: ${message.id}`);
    
    // Broadcast to local connections only
    await this.broadcastMessage(message, chat_type, recipient_id, ride_id, group_id);
    
    // Update chat lists for local users
    await this.updateChatLists(message, chat_type, recipient_id, ride_id, group_id);
    
  } catch (error) {
    console.error('❌ Redis message broadcast error:', error);
  }
}

// Handle friend request notifications from other servers
async handleRedisFriendRequest(data) {
  try {
    const { type, sender_id, recipient_id, connection_id, server_id } = data;
    
    // Skip if from same server
    if (server_id === process.env.SERVER_ID) {
      return;
    }
    
    console.log(`🤝 Friend request from Redis: ${type} - ${sender_id} -> ${recipient_id}`);
    
    switch (type) {
      case 'sent':
        // Get sender info and notify recipient
        const sender = await User.findByPk(sender_id, {
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        });
        
        if (sender) {
          this.io.to(`user_${recipient_id}`).emit('friend_request_received', {
            type: 'friend_request_received',
            request: {
              id: connection_id,
              sender,
              created_at: new Date()
            }
          });
        }
        break;
        
      case 'accepted':
        // Notify sender that request was accepted
        const recipient = await User.findByPk(recipient_id, {
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        });
        
        if (recipient) {
          this.io.to(`user_${sender_id}`).emit('friend_request_accepted', {
            type: 'friend_request_accepted',
            friend: recipient,
            connection_id,
            accepted_at: new Date()
          });
        }
        break;
        
      case 'rejected':
        // Notify sender that request was rejected
        this.io.to(`user_${sender_id}`).emit('friend_request_rejected', {
          rejected_by: recipient_id,
          connection_id,
          timestamp: new Date()
        });
        break;
    }
    
  } catch (error) {
    console.error('❌ Redis friend request error:', error);
  }
}

// Handle presence updates from other servers
async handleRedisPresenceUpdate(data) {
  try {
    const { userId, status, last_seen, metadata, server_id } = data;
    
    // Skip if from same server
    if (server_id === process.env.SERVER_ID) {
      return;
    }
    
    console.log(`👤 Presence update from Redis: User ${userId} -> ${status}`);
    
    // Update local presence cache
    this.presenceCache.set(userId, {
      userId,
      status,
      last_seen,
      metadata
    });
    
    // Broadcast to friends who are connected to this server
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: userId },
          { connected_user_id: userId }
        ],
        status: 'accepted'
      }
    });
    
    const friendIds = friendConnections.map(conn => 
      conn.user_id === userId ? conn.connected_user_id : conn.user_id
    );
    
    // Only emit to friends who are connected to this server
    friendIds.forEach(friendId => {
      if (this.connections.has(friendId)) {
        this.io.to(`user_${friendId}`).emit('presence_update', {
          userId,
          status,
          last_seen,
          metadata
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Redis presence update error:', error);
  }
}

// Handle chat list updates from other servers
async handleRedisChatListUpdate(data) {
  try {
    const { user_ids, update_data, server_id } = data;
    
    // Skip if from same server
    if (server_id === process.env.SERVER_ID) {
      return;
    }
    
    console.log(`📋 Chat list update from Redis for ${user_ids.length} users`);
    
    // Send updates to users connected to this server
    user_ids.forEach(userId => {
      if (this.connections.has(userId)) {
        this.io.to(`user_${userId}`).emit('chat_list_update', update_data);
      }
    });
    
  } catch (error) {
    console.error('❌ Redis chat list update error:', error);
  }
}

// Handle user connection events from other servers
async handleRedisUserConnection(data) {
  try {
    const { type, userId, server_id } = data;
    
    // Skip if from same server
    if (server_id === process.env.SERVER_ID) {
      return;
    }
    
    console.log(`🔗 User connection from Redis: ${type} - User ${userId}`);
    
    switch (type) {
      case 'connected':
        // Update presence for user connected on another server
        await this.updatePresence(userId, 'online');
        break;
        
      case 'disconnected':
        // Check if user has any connections on this server
        if (!this.connections.has(userId)) {
          await this.updatePresence(userId, 'offline');
        }
        break;
    }
    
  } catch (error) {
    console.error('❌ Redis user connection error:', error);
  }
}

// Handle room updates from other servers
async handleRedisRoomUpdate(data) {
  try {
    const { type, room_id, room_type, user_id, server_id } = data;
    
    // Skip if from same server
    if (server_id === process.env.SERVER_ID) {
      return;
    }
    
    console.log(`🏠 Room update from Redis: ${type} - ${room_type}_${room_id}`);
    
    const roomName = `${room_type}_${room_id}`;
    
    switch (type) {
      case 'user_joined':
        // Add user to room members if they're connected to this server
        if (this.connections.has(user_id)) {
          this.addToRoom(roomName, user_id);
        }
        
        // Notify room members
        this.io.to(roomName).emit('user_joined_room', {
          room_id,
          room_type,
          user_id,
          timestamp: new Date()
        });
        break;
        
      case 'user_left':
        // Remove user from room members
        this.removeFromRoom(roomName, user_id);
        
        // Notify room members
        this.io.to(roomName).emit('user_left_room', {
          room_id,
          room_type,
          user_id,
          timestamp: new Date()
        });
        break;
        
      case 'room_created':
        // Handle new room creation
        this.io.to(roomName).emit('room_created', {
          room_id,
          room_type,
          timestamp: new Date()
        });
        break;
        
      case 'room_deleted':
        // Handle room deletion
        this.io.to(roomName).emit('room_deleted', {
          room_id,
          room_type,
          timestamp: new Date()
        });
        
        // Clean up room members
        this.roomMembers.delete(roomName);
        break;
    }
    
  } catch (error) {
    console.error('❌ Redis room update error:', error);
  }
}

// Handle general notifications from other servers
async handleRedisNotification(data) {
  try {
    const { type, user_id, notification_data, server_id } = data;
    
    // Skip if from same server
    if (server_id === process.env.SERVER_ID) {
      return;
    }
    
    console.log(`🔔 Notification from Redis: ${type} for user ${user_id}`);
    
    // Send notification to user if connected to this server
    if (this.connections.has(user_id)) {
      this.io.to(`user_${user_id}`).emit('notification', {
        type,
        data: notification_data,
        timestamp: new Date()
      });
    }
    
  } catch (error) {
    console.error('❌ Redis notification error:', error);
  }
}

// Helper method to publish messages to Redis with server ID
async publishToRedis(channel, data) {
  if (this.redis) {
    try {
      const messageData = {
        ...data,
        server_id: process.env.SERVER_ID || 'default',
        timestamp: new Date()
      };
      
      await this.redis.publish(channel, JSON.stringify(messageData));
      console.log(`📡 Published to Redis channel: ${channel}`);
    } catch (error) {
      console.error(`❌ Redis publish error for channel ${channel}:`, error);
    }
  }
}

// Enhanced method to handle multi-server message broadcasting
async broadcastMessageWithRedis(message, chat_type, recipient_id, ride_id, group_id) {
  // Local broadcast
  await this.broadcastMessage(message, chat_type, recipient_id, ride_id, group_id);
  
  // Redis broadcast for other servers
  await this.publishToRedis('chat_message', {
    message,
    chat_type,
    recipient_id,
    ride_id,
    group_id
  });
}

// Enhanced method to handle multi-server presence updates
async updatePresenceWithRedis(userId, status, metadata = {}) {
  // Local update
  await this.updatePresence(userId, status, metadata);
  
  // Redis broadcast for other servers
  await this.publishToRedis('presence_update', {
    userId,
    status,
    last_seen: new Date(),
    metadata
  });
}

// Enhanced method to handle multi-server chat list updates
async updateChatListsWithRedis(message, chat_type, recipient_id, ride_id, group_id) {
  // Local update
  await this.updateChatLists(message, chat_type, recipient_id, ride_id, group_id);
  
  // Determine affected users for Redis broadcast
  let affectedUsers = [];
  
  switch (chat_type) {
    case 'direct':
      affectedUsers = [message.sender_id, recipient_id];
      break;
    case 'ride':
      // Get all ride participants
      const ride = await Ride.findByPk(ride_id, {
        include: [{ model: User, as: 'participants', attributes: ['id'] }]
      });
      if (ride) {
        affectedUsers = [ride.creator_id, ...ride.participants.map(p => p.id)];
      }
      break;
    case 'group':
      // Get all group members
      const group = await Group.findByPk(group_id, {
        include: [{ model: User, as: 'members', attributes: ['id'] }]
      });
      if (group) {
        affectedUsers = [group.admin_id, ...group.members.map(m => m.id)];
      }
      break;
  }
  
  // Redis broadcast for other servers
  await this.publishToRedis('chat_list_update', {
    user_ids: affectedUsers,
    update_data: {
      type: 'chat_list_update',
      last_message: message,
      chat_type,
      chat_id: recipient_id || ride_id || group_id,
      timestamp: new Date()
    }
  });
}

async sendInitialData(socket, userId) {
  try {
    console.log(`📤 Sending initial data to user ${userId}`);
    
    // 1. Send online friends count
    const onlineFriendsCount = await this.getOnlineFriendsCount(userId);
    
    // 2. Send total unread messages count
    const totalUnread = await this.getTotalUnreadCount(userId);
    
    // 3. Send pending friend requests count
    const pendingRequests = await UserConnection.count({
      where: {
        connected_user_id: userId,
        status: 'pending'
      }
    });
    
    // 4. Get user's chat list data - THIS IS THE KEY ADDITION
    const chatListData = await this.buildCompleteChatList(userId);
    
    // 5. Send all initial data at once
    const initialData = {
      online_friends_count: onlineFriendsCount,
      total_unread: totalUnread,
      pending_requests: pendingRequests,
      chat_list: chatListData, // THIS WAS MISSING
      server_time: new Date(),
      user_id: userId,
      sync_timestamp: Date.now()
    };
    
    console.log(`📊 Initial data for user ${userId}:`, {
      chats: chatListData.length,
      unread: totalUnread,
      friends: onlineFriendsCount,
      pending: pendingRequests
    });
    
    // Send initial data
    socket.emit('initial_data', initialData);
    
    // ALSO trigger chat_list_synced event for compatibility
    socket.emit('chat_list_synced', {
      chat_list: chatListData,
      total_count: chatListData.length,
      timestamp: new Date(),
      sync_id: Date.now(),
      user_id: userId,
      source: 'initial_data'
    });
    
  } catch (error) {
    console.error('❌ Send initial data error:', error);
    socket.emit('initial_data_error', { 
      error: 'Failed to load initial data',
      details: error.message,
      timestamp: new Date()
    });
  }
}

// Add this new method to build complete chat list
async buildCompleteChatList(userId) {
  try {
    console.log(`📋 Building complete chat list for user ${userId}`);
    
    // Get direct message conversations
    const directChats = await this.getUserDirectChats(userId);
    console.log(`📱 Found ${directChats.length} direct chats`);
    
    // Get user's group chats  
    const groupChats = await this.getUserGroupChats(userId);
    console.log(`👥 Found ${groupChats.length} group chats`);
    
    // Get user's ride chats
    const rideChats = await this.getUserRideChats(userId);
    console.log(`🚗 Found ${rideChats.length} ride chats`);
    
    // Combine all chats
    const allChats = [...directChats, ...groupChats, ...rideChats];
    
    // Sort by last activity
    allChats.sort((a, b) => {
      const timeA = a.lastMessage?.createdAt || a.updated_at || a.lastActivity;
      const timeB = b.lastMessage?.createdAt || b.updated_at || b.lastActivity;
      return new Date(timeB) - new Date(timeA);
    });
    
    console.log(`✅ Built complete chat list: ${allChats.length} chats`);
    return allChats;
    
  } catch (error) {
    console.error('❌ Error building chat list:', error);
    return [];
  }
}

  async handleSendMessage(socket, data) {
    try {
      const { 
        message, 
        chat_type, 
        recipient_id, 
        ride_id, 
        group_id, 
        message_type = 'text',
        metadata = {},
        reply_to_id 
      } = data;
      
      const userId = socket.userId;
      if (!userId) return;
      
      // Validate message
      if (!message && message_type === 'text') {
        return socket.emit('message_error', { error: 'Message content required' });
      }
      
      // Check permissions based on chat type
      const canSend = await this.validateMessagePermissions(userId, chat_type, recipient_id, ride_id, group_id);
      if (!canSend.allowed) {
        return socket.emit('message_error', { error: canSend.reason });
      }
      
      // Create message in database
      const chatMessage = await Chat.create({
        message: message?.trim(),
        message_type,
        chat_type,
        sender_id: userId,
        recipient_id,
        ride_id,
        group_id,
        reply_to_id,
        metadata
      });
      
      // Load message with user data
      const fullMessage = await Chat.findByPk(chatMessage.id, {
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
          },
          {
            model: Chat,
            as: 'replyTo',
            required: false,
            include: [{
              model: User,
              as: 'sender',
              attributes: ['id', 'first_name', 'last_name']
            }]
          }
        ]
      });
      
      // Emit to appropriate rooms
      await this.broadcastMessage(fullMessage, chat_type, recipient_id, ride_id, group_id);
      
      // Update chat list for all participants
      await this.updateChatLists(fullMessage, chat_type, recipient_id, ride_id, group_id);
      
      // Update metrics
      this.metrics.messagesSent++;
      
      // Publish to Redis for multi-server support
      if (this.redis) {
        await this.redis.publish('chat_message', JSON.stringify({
          message: fullMessage,
          chat_type,
          recipient_id,
          ride_id,
          group_id
        }));
      }
      
      socket.emit('message_sent', { 
        success: true, 
        message: fullMessage,
        timestamp: new Date()
      });
      
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  }
  
  async broadcastMessage(message, chat_type, recipient_id, ride_id, group_id) {
    const messageData = {
      type: 'new_message',
      message,
      timestamp: new Date()
    };
    
    switch (chat_type) {
      case 'direct':
        // Send to both sender and recipient
        this.io.to(`user_${message.sender_id}`).emit('message_received', messageData);
        if (recipient_id) {
          this.io.to(`user_${recipient_id}`).emit('message_received', messageData);
        }
        break;
        
      case 'ride':
        if (ride_id) {
          this.io.to(`ride_${ride_id}`).emit('message_received', messageData);
        }
        break;
        
      case 'group':
        if (group_id) {
          this.io.to(`group_${group_id}`).emit('message_received', messageData);
        }
        break;
    }
  }
  
  async handleSendFriendRequest(socket, data) {
    try {
      const { user_id } = data;
      const senderId = socket.userId;
      
      if (!senderId || !user_id) return;
      
      if (senderId === user_id) {
        return socket.emit('friend_request_error', { error: 'Cannot send request to yourself' });
      }
      
      // Check if target user exists
      const targetUser = await User.findByPk(user_id, {
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      });
      
      if (!targetUser) {
        return socket.emit('friend_request_error', { error: 'User not found' });
      }
      
      // Create friend request
      const connection = await UserConnection.findOrCreateConnection(senderId, user_id, senderId);
      
      if (connection.status !== 'pending' || connection.initiated_by !== senderId) {
        let errorMsg = 'Request already exists';
        switch (connection.status) {
          case 'accepted':
            errorMsg = 'Already friends';
            break;
          case 'blocked':
            errorMsg = 'Cannot send request';
            break;
          case 'pending':
            errorMsg = 'Request already sent';
            break;
        }
        return socket.emit('friend_request_error', { error: errorMsg });
      }
      
      // Get sender info
      const sender = await User.findByPk(senderId, {
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      });
      
      const requestData = {
        type: 'friend_request_received',
        request: {
          id: connection.id,
          sender,
          created_at: connection.created_at
        }
      };
      
      // Send to target user
      this.io.to(`user_${user_id}`).emit('friend_request_received', requestData);
      
      // Confirm to sender
      socket.emit('friend_request_sent', {
        success: true,
        user: targetUser,
        connection_id: connection.id
      });
      
      // Publish to Redis
      if (this.redis) {
        await this.redis.publish('friend_request', JSON.stringify({
          type: 'sent',
          sender_id: senderId,
          recipient_id: user_id,
          connection_id: connection.id
        }));
      }
      
    } catch (error) {
      console.error('Friend request error:', error);
      socket.emit('friend_request_error', { error: 'Failed to send friend request' });
    }
  }
  // Add these missing methods to your HighPerformanceSocketManager class

// Add this method to handle presence updates
async handleUpdatePresence(socket, data) {
  try {
    const { status, metadata = {} } = data;
    const userId = socket.userId;
    
    if (!userId) {
      return socket.emit('presence_error', { error: 'User not authenticated' });
    }
    
    // Validate status
    const validStatuses = ['online', 'offline', 'away', 'busy'];
    if (!validStatuses.includes(status)) {
      return socket.emit('presence_error', { error: 'Invalid status' });
    }
    
    console.log(`👤 User ${userId} presence update: ${status}`);
    
    // Update presence
    await this.updatePresence(userId, status, metadata);
    
    // Confirm to user
    socket.emit('presence_updated', {
      status,
      timestamp: new Date(),
      user_id: userId
    });
    
  } catch (error) {
    console.error('Update presence error:', error);
    socket.emit('presence_error', { error: 'Failed to update presence' });
  }
}

// Add this method to handle getting online friends
async handleGetOnlineFriends(socket) {
  try {
    const userId = socket.userId;
    if (!userId) return;
    console.log(`👥 User ${userId} fetching online friends`);
    
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: userId },
          { connected_user_id: userId }
        ],
        status: 'accepted'
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        },
        {
          model: User,
          as: 'connectedUser',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        }
      ]
    });
    console.log(`👥 User ${userId} fetching online friends`,friendConnections);
    
    const onlineFriends = [];
    
    for (const connection of friendConnections) {
      const friend = connection.user.id === userId ? connection.connectedUser : connection.user;
      const friendPresence = this.presenceCache.get(friend.id);
      
      if (friendPresence && friendPresence.status === 'online') {
        onlineFriends.push({
          ...friend.toJSON(),
          presence: friendPresence
        });
      }
    }
    
    socket.emit('online_friends', {
      friends: onlineFriends,
      count: onlineFriends.length,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Get online friends error:', error);
    socket.emit('online_friends_error', { error: 'Failed to get online friends' });
  }
}

// Add this method to handle join room
async handleJoinRoom(socket, data) {
  try {
    const { room_id, room_type } = data;
    const userId = socket.userId;
    
    if (!userId || !room_id || !room_type) {
      return socket.emit('join_room_error', { error: 'Missing required parameters' });
    }
    
    // Validate room access based on type
    let hasAccess = false;
    
    switch (room_type) {
      case 'group':
        const group = await Group.findByPk(room_id, {
          include: [{
            model: User,
            as: 'members',
            where: { id: userId },
            required: false
          }]
        });
        hasAccess = group && (group.admin_id === userId || group.members?.some(m => m.id === userId));
        break;
        
      case 'ride':
        const ride = await Ride.findByPk(room_id, {
          include: [{
            model: User,
            as: 'participants',
            where: { id: userId },
            required: false
          }]
        });
        hasAccess = ride && (ride.creator_id === userId || ride.participants?.some(p => p.id === userId));
        break;
        
      case 'direct':
        // For direct messages, room_id should be the other user's ID
        const areFriends = await UserConnection.areFriends(userId, room_id);
        hasAccess = areFriends;
        break;
        
      default:
        return socket.emit('join_room_error', { error: 'Invalid room type' });
    }
    
    if (!hasAccess) {
      return socket.emit('join_room_error', { error: 'Access denied to room' });
    }
    
    // Join the room
    const roomName = `${room_type}_${room_id}`;
    socket.join(roomName);
    this.addToRoom(roomName, userId);
    
    console.log(`📁 User ${userId} joined room: ${roomName}`);
    
    socket.emit('room_joined', {
      room_id,
      room_type,
      room_name: roomName,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Join room error:', error);
    socket.emit('join_room_error', { error: 'Failed to join room' });
  }
}

// Add this method to handle leave room
async handleLeaveRoom(socket, data) {
  try {
    const { room_id, room_type } = data;
    const userId = socket.userId;
    
    if (!userId || !room_id || !room_type) {
      return socket.emit('leave_room_error', { error: 'Missing required parameters' });
    }
    
    const roomName = `${room_type}_${room_id}`;
    
    // Leave the room
    socket.leave(roomName);
    this.removeFromRoom(roomName, userId);
    
    console.log(`📁 User ${userId} left room: ${roomName}`);
    
    socket.emit('room_left', {
      room_id,
      room_type,
      room_name: roomName,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Leave room error:', error);
    socket.emit('leave_room_error', { error: 'Failed to leave room' });
  }
}

// Add this method to handle mark read
async handleMarkRead(socket, data) {
  try {
    const { chat_type, sender_id, recipient_id, ride_id, group_id, message_id } = data;
    const userId = socket.userId;
    
    if (!userId) return;
    
    console.log(`📖 User ${userId} marking messages as read:`, data);
    
    // Build where clause for messages to mark as read
    let whereClause = {
      is_read: false,
      is_deleted: false
    };
    
    switch (chat_type) {
      case 'direct':
        if (sender_id) {
          whereClause.sender_id = sender_id;
          whereClause.recipient_id = userId;
        } else if (recipient_id) {
          whereClause.sender_id = recipient_id;
          whereClause.recipient_id = userId;
        }
        break;
        
      case 'ride':
        if (ride_id) {
          whereClause.ride_id = ride_id;
          whereClause.chat_type = 'ride';
          whereClause.sender_id = { [Op.ne]: userId }; // Don't mark own messages as read
        }
        break;
        
      case 'group':
        if (group_id) {
          whereClause.group_id = group_id;
          whereClause.chat_type = 'group';
          whereClause.sender_id = { [Op.ne]: userId }; // Don't mark own messages as read
        }
        break;
        
      default:
        return socket.emit('mark_read_error', { error: 'Invalid chat type' });
    }
    
    // If specific message_id is provided, only mark that message
    if (message_id) {
      whereClause.id = message_id;
    }
    
    // Update messages to read
    const [updatedCount] = await Chat.update(
      { 
        is_read: true,
        read_at: new Date()
      },
      { where: whereClause }
    );
    
    console.log(`📖 Marked ${updatedCount} messages as read for user ${userId}`);
    
    // Emit read receipt to sender(s)
    if (chat_type === 'direct' && (sender_id || recipient_id)) {
      const otherUserId = sender_id || recipient_id;
      this.io.to(`user_${otherUserId}`).emit('messages_read', {
        reader_id: userId,
        chat_type: 'direct',
        read_at: new Date(),
        message_count: updatedCount
      });
    } else if (chat_type === 'ride' && ride_id) {
      socket.to(`ride_${ride_id}`).emit('messages_read', {
        reader_id: userId,
        chat_type: 'ride',
        ride_id,
        read_at: new Date(),
        message_count: updatedCount
      });
    } else if (chat_type === 'group' && group_id) {
      socket.to(`group_${group_id}`).emit('messages_read', {
        reader_id: userId,
        chat_type: 'group',
        group_id,
        read_at: new Date(),
        message_count: updatedCount
      });
    }
    
    socket.emit('mark_read_success', {
      chat_type,
      message_count: updatedCount,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Mark read error:', error);
    socket.emit('mark_read_error', { error: 'Failed to mark messages as read' });
  }
}

// Add this method to handle rejection of friend requests
async handleRejectFriendRequest(socket, data) {
  try {
    const { user_id } = data;
    const recipientId = socket.userId;
    
    if (!recipientId || !user_id) {
      return socket.emit('friend_request_error', { error: 'Missing required parameters' });
    }
    
    // Find the pending request
    const connection = await UserConnection.findOne({
      where: {
        [Op.or]: [
          { user_id: user_id, connected_user_id: recipientId, status: 'pending' },
          { user_id: recipientId, connected_user_id: user_id, status: 'pending' }
        ]
      }
    });
    
    if (!connection) {
      return socket.emit('friend_request_error', { error: 'No pending request found' });
    }
    
    // Make sure the current user is the recipient, not the sender
    if (connection.initiated_by === recipientId) {
      return socket.emit('friend_request_error', { error: 'Cannot reject your own request' });
    }
    
    // Delete the request
    await connection.destroy();
    
    // Notify the sender
    this.io.to(`user_${user_id}`).emit('friend_request_rejected', {
      rejected_by: recipientId,
      timestamp: new Date()
    });
    
    socket.emit('friend_request_rejected', {
      user_id,
      success: true,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Reject friend request error:', error);
    socket.emit('friend_request_error', { error: 'Failed to reject friend request' });
  }
}

// Update the handleConnection method to fix the missing handlers
async handleConnection(socket) {
  console.log(`🔌 New connection: ${socket.id}`);
  
  // Authentication middleware
  socket.on('authenticate', async (data) => {
    try {
      const { userId, token } = data;
      
      // Verify token here (implement your auth logic)
      const user = await this.authenticateUser(userId, token);
      if (!user) {
        socket.emit('auth_error', { message: 'Authentication failed' });
        return socket.disconnect();
      }
      
      // Store user connection
      socket.userId = userId;
      this.socketUsers.set(socket.id, userId);
      
      if (!this.connections.has(userId)) {
        this.connections.set(userId, new Set());
      }
      this.connections.get(userId).add(socket.id);
      
      // Update metrics
      this.metrics.connectionsCount = this.connections.size;
      
      // Join user to their personal room
      socket.join(`user_${userId}`);
      
      // Load user's rooms (chats, groups, rides)
      await this.loadUserRooms(socket, userId);
      
      // Update presence
      await this.updatePresence(userId, 'online');
      
      // Send initial data
      await this.sendInitialData(socket, userId);
      
      socket.emit('authenticated', { 
        status: 'success',
        userId,
        connectionTime: new Date()
      });
      
      console.log(`✅ User ${userId} authenticated with socket ${socket.id}`);
      
    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('auth_error', { message: 'Authentication failed' });
      socket.disconnect();
    }
  });
  
  // Chat message handlers
  socket.on('send_message', (data) => this.handleSendMessage(socket, data));
  socket.on('typing_start', (data) => this.handleTypingStart(socket, data));
  socket.on('typing_stop', (data) => this.handleTypingStop(socket, data));
  socket.on('mark_read', (data) => this.handleMarkRead(socket, data));
  
  // Friend request handlers
  socket.on('send_friend_request', (data) => this.handleSendFriendRequest(socket, data));
  socket.on('accept_friend_request', (data) => this.handleAcceptFriendRequest(socket, data));
  socket.on('reject_friend_request', (data) => this.handleRejectFriendRequest(socket, data));
  
  // Group/Ride handlers
  socket.on('join_room', (data) => this.handleJoinRoom(socket, data));
  socket.on('leave_room', (data) => this.handleLeaveRoom(socket, data));
  
  // Presence handlers - FIXED
  socket.on('update_presence', (data) => this.handleUpdatePresence(socket, data));
  socket.on('get_online_friends', () => this.handleGetOnlineFriends(socket));
  
  // Poll handlers (for metadata-based features)
  socket.on('create_poll', (data) => this.handleCreatePoll(socket, data));
  socket.on('vote_poll', (data) => this.handleVotePoll(socket, data));
  
  // Disconnect handler
  socket.on('disconnect', () => this.handleDisconnect(socket));
}

// Add this method to clean up stale connections
cleanupStaleConnections() {
  const now = Date.now();
  
  for (const [userId, sockets] of this.connections.entries()) {
    const activeSockets = new Set();
    
    for (const socketId of sockets) {
      if (this.socketUsers.has(socketId)) {
        activeSockets.add(socketId);
      }
    }
    
    if (activeSockets.size === 0) {
      this.connections.delete(userId);
    } else {
      this.connections.set(userId, activeSockets);
    }
  }
  
  // Clean up socket users map
  for (const [socketId, userId] of this.socketUsers.entries()) {
    if (!this.connections.has(userId) || !this.connections.get(userId).has(socketId)) {
      this.socketUsers.delete(socketId);
    }
  }
  
  console.log(`🧹 Cleaned up stale connections. Active: ${this.connections.size}`);
}

// Add this method to clean up stale presence
cleanupStalePresence() {
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes
  
  for (const [userId, presence] of this.presenceCache.entries()) {
    if (now - new Date(presence.last_seen).getTime() > staleThreshold) {
      this.presenceCache.delete(userId);
    }
  }
  
  console.log(`🧹 Cleaned up stale presence data. Active: ${this.presenceCache.size}`);
}

// Add this method to log errors
logError(type, error, metadata = {}) {
  console.error(`❌ Socket Manager Error [${type}]:`, error);
  
  // In production, you might want to send this to a logging service
  if (process.env.NODE_ENV === 'production') {
    // Send to logging service like Sentry, LogRocket, etc.
    // Example: Sentry.captureException(error, { tags: { type }, extra: metadata });
  }
}
  
  async handleAcceptFriendRequest(socket, data) {
    try {
      const { user_id } = data;
      const recipientId = socket.userId;
      
      // Find pending request
      const connection = await UserConnection.findOne({
        where: {
          [Op.or]: [
            { user_id: user_id, connected_user_id: recipientId, status: 'pending' },
            { user_id: recipientId, connected_user_id: user_id, status: 'pending' }
          ]
        },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          },
          {
            model: User,
            as: 'connectedUser',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }
        ]
      });
      
      if (!connection || connection.initiated_by === recipientId) {
        return socket.emit('friend_request_error', { error: 'No pending request found' });
      }
      
      // Accept the request
      await connection.update({
        status: 'accepted',
        accepted_at: new Date()
      });
      
      const sender = connection.user.id === recipientId ? connection.connectedUser : connection.user;
      const recipient = connection.user.id === recipientId ? connection.user : connection.connectedUser;
      
      // Notify both users
      const friendshipData = {
        type: 'friend_request_accepted',
        friend: recipient,
        connection_id: connection.id,
        accepted_at: connection.accepted_at
      };
      
      this.io.to(`user_${user_id}`).emit('friend_request_accepted', {
        ...friendshipData,
        friend: recipient
      });
      
      socket.emit('friend_request_accepted', {
        ...friendshipData,
        friend: sender
      });
      
      // Update chat lists for both users
      await this.updateFriendsChatList(user_id, recipientId);
      
    } catch (error) {
      console.error('Accept friend request error:', error);
      socket.emit('friend_request_error', { error: 'Failed to accept friend request' });
    }
  }
  
  async handleTypingStart(socket, data) {
    const { chat_type, recipient_id, ride_id, group_id } = data;
    const userId = socket.userId;
    
    if (!userId) return;
    
    let roomId;
    switch (chat_type) {
      case 'direct':
        roomId = `typing_${Math.min(userId, recipient_id)}_${Math.max(userId, recipient_id)}`;
        this.io.to(`user_${recipient_id}`).emit('typing_start', {
          user_id: userId,
          chat_type,
          recipient_id
        });
        break;
      case 'ride':
        roomId = `typing_ride_${ride_id}`;
        socket.to(`ride_${ride_id}`).emit('typing_start', {
          user_id: userId,
          chat_type,
          ride_id
        });
        break;
      case 'group':
        roomId = `typing_group_${group_id}`;
        socket.to(`group_${group_id}`).emit('typing_start', {
          user_id: userId,
          chat_type,
          group_id
        });
        break;
    }
    
    // Track typing users
    if (!this.typingUsers.has(roomId)) {
      this.typingUsers.set(roomId, new Set());
    }
    this.typingUsers.get(roomId).add(userId);
    
    // Auto-stop typing after 3 seconds
    setTimeout(() => {
      this.handleTypingStop(socket, data);
    }, 3000);
  }
  
  async handleTypingStop(socket, data) {
    const { chat_type, recipient_id, ride_id, group_id } = data;
    const userId = socket.userId;
    
    if (!userId) return;
    
    let roomId;
    switch (chat_type) {
      case 'direct':
        roomId = `typing_${Math.min(userId, recipient_id)}_${Math.max(userId, recipient_id)}`;
        this.io.to(`user_${recipient_id}`).emit('typing_stop', {
          user_id: userId,
          chat_type,
          recipient_id
        });
        break;
      case 'ride':
        roomId = `typing_ride_${ride_id}`;
        socket.to(`ride_${ride_id}`).emit('typing_stop', {
          user_id: userId,
          chat_type,
          ride_id
        });
        break;
      case 'group':
        roomId = `typing_group_${group_id}`;
        socket.to(`group_${group_id}`).emit('typing_stop', {
          user_id: userId,
          chat_type,
          group_id
        });
        break;
    }
    
    // Remove from typing users
    if (this.typingUsers.has(roomId)) {
      this.typingUsers.get(roomId).delete(userId);
      if (this.typingUsers.get(roomId).size === 0) {
        this.typingUsers.delete(roomId);
      }
    }
  }
  
  async loadUserRooms(socket, userId) {
    try {
      // Join friend rooms
      const friendConnections = await UserConnection.findAll({
        where: {
          [Op.or]: [
            { user_id: userId },
            { connected_user_id: userId }
          ],
          status: 'accepted'
        }
      });
      
      // Join group rooms
      const userGroups = await Group.findAll({
        include: [{
          model: User,
          as: 'members',
          where: { id: userId },
          through: { attributes: [] }
        }]
      });
      
      for (const group of userGroups) {
        socket.join(`group_${group.id}`);
        this.addToRoom(`group_${group.id}`, userId);
      }
      
      // Join ride rooms
      const userRides = await Ride.findAll({
        include: [{
          model: User,
          as: 'participants',
          where: { id: userId },
          through: { attributes: [] }
        }]
      });
      
      for (const ride of userRides) {
        socket.join(`ride_${ride.id}`);
        this.addToRoom(`ride_${ride.id}`, userId);
      }
      
      console.log(`📁 User ${userId} joined ${userGroups.length} groups and ${userRides.length} rides`);
      
    } catch (error) {
      console.error('Error loading user rooms:', error);
    }
  }
  
  async updateChatLists(message, chat_type, recipient_id, ride_id, group_id) {
    const updateData = {
      type: 'chat_list_update',
      last_message: message,
      chat_type,
      timestamp: new Date()
    };
    
    switch (chat_type) {
      case 'direct':
        this.io.to(`user_${message.sender_id}`).emit('chat_list_update', {
          ...updateData,
          chat_id: recipient_id,
          chat_type: 'direct'
        });
        this.io.to(`user_${recipient_id}`).emit('chat_list_update', {
          ...updateData,
          chat_id: message.sender_id,
          chat_type: 'direct'
        });
        break;
      case 'ride':
        this.io.to(`ride_${ride_id}`).emit('chat_list_update', {
          ...updateData,
          chat_id: ride_id,
          chat_type: 'ride'
        });
        break;
      case 'group':
        this.io.to(`group_${group_id}`).emit('chat_list_update', {
          ...updateData,
          chat_id: group_id,
          chat_type: 'group'
        });
        break;
    }
  }
  
  async validateMessagePermissions(userId, chat_type, recipient_id, ride_id, group_id) {
    try {
      switch (chat_type) {
        case 'direct':
          if (!recipient_id) return { allowed: false, reason: 'Recipient required' };
          if (recipient_id === userId) return { allowed: false, reason: 'Cannot message yourself' };
          
          const areFriends = await UserConnection.areFriends(userId, recipient_id);
          if (!areFriends) return { allowed: false, reason: 'Must be friends to message' };
          
          const isBlocked = await UserConnection.isBlocked(userId, recipient_id);
          if (isBlocked) return { allowed: false, reason: 'User is blocked' };
          
          return { allowed: true };
          
        case 'ride':
          if (!ride_id) return { allowed: false, reason: 'Ride ID required' };
          
          const ride = await Ride.findByPk(ride_id, {
            include: [{
              model: User,
              as: 'participants',
              where: { id: userId },
              required: false
            }]
          });
          
          if (!ride) return { allowed: false, reason: 'Ride not found' };
          
          const isRideParticipant = ride.participants?.some(p => p.id === userId) || ride.creator_id === userId;
          if (!isRideParticipant) return { allowed: false, reason: 'Not a ride participant' };
          
          return { allowed: true };
          
        case 'group':
          if (!group_id) return { allowed: false, reason: 'Group ID required' };
          
          const group = await Group.findByPk(group_id, {
            include: [{
              model: User,
              as: 'members',
              where: { id: userId },
              required: false
            }]
          });
          
          if (!group) return { allowed: false, reason: 'Group not found' };
          
          const isGroupMember = group.members?.some(m => m.id === userId) || group.admin_id === userId;
          if (!isGroupMember) return { allowed: false, reason: 'Not a group member' };
          
          return { allowed: true };
          
        default:
          return { allowed: false, reason: 'Invalid chat type' };
      }
    } catch (error) {
      console.error('Permission validation error:', error);
      return { allowed: false, reason: 'Permission check failed' };
    }
  }
  
  async updatePresence(userId, status, metadata = {}) {
    const presenceData = {
      userId,
      status, // online, away, busy, offline
      last_seen: new Date(),
      metadata
    };
    
    this.presenceCache.set(userId, presenceData);
    
    // Update in database
    await User.update(
      { 
        last_active: new Date(),
        is_online: status === 'online'
      },
      { where: { id: userId } }
    );
    
    // Broadcast to friends
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: userId },
          { connected_user_id: userId }
        ],
        status: 'accepted'
      }
    });
    
    const friendIds = friendConnections.map(conn => 
      conn.user_id === userId ? conn.connected_user_id : conn.user_id
    );
    
    friendIds.forEach(friendId => {
      this.io.to(`user_${friendId}`).emit('presence_update', presenceData);
    });
    
    // Publish to Redis
    if (this.redis) {
      await this.redis.publish('presence_update', JSON.stringify(presenceData));
    }
  }
  
  setupPresenceSystem() {
    // Heartbeat every 30 seconds
    setInterval(() => {
      this.io.emit('presence_ping');
    }, 30000);
    
    // Clean up stale presence data every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [userId, presence] of this.presenceCache.entries()) {
        if (now - new Date(presence.last_seen).getTime() > 5 * 60 * 1000) {
          this.updatePresence(userId, 'offline');
        }
      }
    }, 5 * 60 * 1000);
  }
  
  async handleDisconnect(socket) {
    const userId = socket.userId;
    
    if (userId) {
      // Remove from connections
      if (this.connections.has(userId)) {
        this.connections.get(userId).delete(socket.id);
        if (this.connections.get(userId).size === 0) {
          this.connections.delete(userId);
          // User is completely offline
          await this.updatePresence(userId, 'offline');
        }
      }
      
      // Remove from socket users
      this.socketUsers.delete(socket.id);
      
      // Update metrics
      this.metrics.connectionsCount = this.connections.size;
      
      console.log(`🔌 User ${userId} disconnected (socket: ${socket.id})`);
    }
  }
  
  setupMetrics() {
    // Calculate messages per second
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.metrics.startTime) / 1000;
      this.metrics.messagesPerSecond = Math.round(this.metrics.messagesSent / elapsed * 100) / 100;
    }, 5000);
  }
  
  // Utility methods
  addToRoom(roomId, userId) {
    if (!this.roomMembers.has(roomId)) {
      this.roomMembers.set(roomId, new Set());
    }
    this.roomMembers.get(roomId).add(userId);
  }
  
  removeFromRoom(roomId, userId) {
    if (this.roomMembers.has(roomId)) {
      this.roomMembers.get(roomId).delete(userId);
      if (this.roomMembers.get(roomId).size === 0) {
        this.roomMembers.delete(roomId);
      }
    }
  }
  
async authenticateUser(userId, token) {
  try {
    console.log(`🔐 Authenticating user ${userId}...`);
    
    // Verify JWT token first
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if the userId in token matches the provided userId
    if (decoded.userId !== userId) {
      console.warn(`❌ Token userId mismatch. Token: ${decoded.userId}, Provided: ${userId}`);
      return null;
    }
    
    // Fetch user from database
    const user = await User.findByPk(userId, {
      attributes: ['id', 'first_name', 'last_name', 'is_active', 'last_active']
    });
    
    if (!user) {
      console.warn(`❌ User ${userId} not found in database`);
      return null;
    }
    
    // Check if user account is active
    if (!user.is_active) {
      console.warn(`❌ User ${userId} account is deactivated`);
      return null;
    }
    
    // Update last active timestamp
    await User.update(
      { last_active: new Date() },
      { where: { id: userId } }
    );
    
    console.log(`✅ Authentication successful for user ${userId}`);
    return user;
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      console.warn(`❌ Invalid token for user ${userId}:`, error.message);
    } else if (error.name === 'TokenExpiredError') {
      console.warn(`❌ Expired token for user ${userId}`);
    } else {
      console.error('❌ Authentication error:', error);
    }
    return null;
  }
}
  
  getHealthStatus() {
    return {
      connections: this.metrics.connectionsCount,
      rooms: this.roomMembers.size,
      messagesPerSecond: this.metrics.messagesPerSecond,
      totalMessagesSent: this.metrics.messagesSent,
      uptime: Math.round((Date.now() - this.metrics.startTime) / 1000),
      memory: process.memoryUsage()
    };
  }
  
  getPerformanceStats() {
    return {
      ...this.getHealthStatus(),
      typingUsers: this.typingUsers.size,
      presenceCache: this.presenceCache.size,
      redisConnected: !!this.redis,
      averageRoomSize: this.roomMembers.size > 0 ? 
        Array.from(this.roomMembers.values()).reduce((sum, room) => sum + room.size, 0) / this.roomMembers.size : 0
    };
  }
  
  async gracefulShutdown() {
    console.log('🔄 Starting socket manager shutdown...');
    
    // Notify all connected clients
    this.io.emit('server_shutdown', { 
      message: 'Server is restarting, please reconnect in a moment' 
    });
    
    // Close Redis connections
    if (this.redis) {
      await this.redis.quit();
      await this.redisSub.quit();
    }
    
    // Disconnect all sockets
    this.io.disconnectSockets();
    
    console.log('✅ Socket manager shutdown complete');
  }
}

module.exports = HighPerformanceSocketManager;