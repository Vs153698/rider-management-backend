// src/services/ChatCacheService.js
const Redis = require('ioredis');
const { LRUCache } = require('lru-cache'); // Fixed import

class ChatCacheService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    // Multi-level caching for maximum performance
    this.l1Cache = new LRUCache({ 
      max: 2000, 
      ttl: 30000, // 30 seconds
      updateAgeOnGet: true 
    });
    
    this.l2Cache = new LRUCache({ 
      max: 10000, 
      ttl: 300000, // 5 minutes
      updateAgeOnGet: true 
    });
    
    // Specialized caches
    this.chatListCache = new LRUCache({ max: 5000, ttl: 60000 }); // 1 minute
    this.messageCache = new LRUCache({ max: 20000, ttl: 600000 }); // 10 minutes
    this.userCache = new LRUCache({ max: 10000, ttl: 300000 }); // 5 minutes
    
    // Connection and room caches
    this.connectionCache = new Map();
    this.roomMembershipCache = new Map();
    this.onlineUsers = new Set();
    this.typingUsers = new Map(); // room -> Set of typing users
    
    // Performance metrics
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    this.setupCleanupTimers();
  }

  // =================== CHAT LIST CACHING ===================
  
  async getChatList(userId) {
    const cacheKey = `chatlist:${userId}`;
    
    // L1 Cache (fastest)
    let chatList = this.chatListCache.get(cacheKey);
    if (chatList) {
      this.cacheHits++;
      return this.enrichChatList(chatList);
    }
    
    // Redis Cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      chatList = JSON.parse(cached);
      this.chatListCache.set(cacheKey, chatList);
      this.cacheHits++;
      return this.enrichChatList(chatList);
    }
    
    this.cacheMisses++;
    return null;
  }

  async setChatList(userId, chatList) {
    const cacheKey = `chatlist:${userId}`;
    
    // Store in all cache levels
    this.chatListCache.set(cacheKey, chatList);
    
    // Redis with TTL
    await this.redis.setex(cacheKey, 3600, JSON.stringify(chatList));
    
    // Broadcast update to user's connected devices
    await this.redis.publish('chatlist:updated', JSON.stringify({
      userId,
      chatList: this.enrichChatList(chatList)
    }));
  }

  async updateChatInList(userId, chatUpdate) {
    const chatList = await this.getChatList(userId);
    if (!chatList) return null;

    const { chatId, userId: chatUserId, type } = chatUpdate;
    
    // Find chat in list
    let chatIndex = -1;
    if (type === 'direct') {
      chatIndex = chatList.findIndex(chat => 
        chat.type === 'direct' && chat.userId === chatUserId
      );
    } else {
      chatIndex = chatList.findIndex(chat => 
        chat.type === type && chat.id === chatId
      );
    }

    if (chatIndex !== -1) {
      // Update existing chat
      chatList[chatIndex] = { 
        ...chatList[chatIndex], 
        ...chatUpdate,
        lastActivity: chatUpdate.lastActivity || new Date().toISOString()
      };
    } else {
      // Add new chat
      chatList.unshift({
        ...chatUpdate,
        lastActivity: chatUpdate.lastActivity || new Date().toISOString()
      });
    }

    // Sort by last activity
    chatList.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    
    // Keep only recent chats (limit to 100)
    if (chatList.length > 100) {
      chatList.splice(100);
    }
    
    await this.setChatList(userId, chatList);
    return chatList[chatIndex >= 0 ? chatIndex : 0];
  }

  enrichChatList(chatList) {
    return chatList.map(chat => ({
      ...chat,
      isOnline: chat.type === 'direct' ? this.isUserOnline(chat.userId) : undefined,
      typingUsers: this.getTypingUsers(this.getRoomKey(chat))
    }));
  }

  // =================== MESSAGE CACHING ===================
  
  async getCachedMessages(conversationKey, page = 1, limit = 50) {
    const cacheKey = `messages:${conversationKey}:${page}:${limit}`;
    
    // Memory cache first
    let messages = this.messageCache.get(cacheKey);
    if (messages) {
      this.cacheHits++;
      return messages;
    }
    
    // Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      messages = JSON.parse(cached);
      this.messageCache.set(cacheKey, messages);
      this.cacheHits++;
      return messages;
    }
    
    this.cacheMisses++;
    return null;
  }

  async cacheMessages(conversationKey, messages, page = 1, limit = 50) {
    const cacheKey = `messages:${conversationKey}:${page}:${limit}`;
    
    // Cache in memory
    this.messageCache.set(cacheKey, messages);
    
    // Cache in Redis
    await this.redis.setex(cacheKey, 1800, JSON.stringify(messages)); // 30min TTL
  }

  async getRecentMessages(conversationKey, limit = 20) {
    const cacheKey = `recent:${conversationKey}`;
    
    // Try Redis list first (fastest for recent messages)
    const messages = await this.redis.lrange(cacheKey, 0, limit - 1);
    
    if (messages.length > 0) {
      return messages.map(msg => JSON.parse(msg));
    }
    
    return [];
  }

  async addMessageToConversation(conversationKey, message) {
    const cacheKey = `recent:${conversationKey}`;
    
    // Add to front of list
    await this.redis.lpush(cacheKey, JSON.stringify(message));
    
    // Keep only recent messages
    await this.redis.ltrim(cacheKey, 0, 99);
    
    // Set TTL
    await this.redis.expire(cacheKey, 3600);
    
    // Invalidate paginated caches
    await this.invalidateMessageCache(conversationKey);
  }

  // =================== USER & CONNECTION CACHING ===================
  
  async cacheUser(userId, userData) {
    this.userCache.set(userId, userData);
    await this.redis.setex(`user:${userId}`, 1800, JSON.stringify(userData));
  }

  async getCachedUser(userId) {
    // Memory first
    let user = this.userCache.get(userId);
    if (user) {
      this.cacheHits++;
      return user;
    }
    
    // Redis fallback
    const cached = await this.redis.get(`user:${userId}`);
    if (cached) {
      user = JSON.parse(cached);
      this.userCache.set(userId, user);
      this.cacheHits++;
      return user;
    }
    
    this.cacheMisses++;
    return null;
  }

  async cacheUserConnections(userId, connections) {
    const cacheKey = `connections:${userId}`;
    
    this.connectionCache.set(userId, connections);
    await this.redis.setex(cacheKey, 1800, JSON.stringify(connections));
  }

  async getUserConnections(userId) {
    // Memory first
    let connections = this.connectionCache.get(userId);
    if (connections) return connections;
    
    // Redis fallback
    const cached = await this.redis.get(`connections:${userId}`);
    if (cached) {
      connections = JSON.parse(cached);
      this.connectionCache.set(userId, connections);
      return connections;
    }
    
    return null;
  }

  // =================== ROOM MEMBERSHIP CACHING ===================
  
  setRoomMembership(roomKey, userId, isMember, role = 'member') {
    const key = `${roomKey}:${userId}`;
    this.roomMembershipCache.set(key, { isMember, role, timestamp: Date.now() });
  }

  getRoomMembership(roomKey, userId) {
    const key = `${roomKey}:${userId}`;
    const membership = this.roomMembershipCache.get(key);
    
    // Auto-expire after 10 minutes
    if (membership && Date.now() - membership.timestamp > 600000) {
      this.roomMembershipCache.delete(key);
      return null;
    }
    
    return membership;
  }

  // =================== ONLINE USERS & PRESENCE ===================
  
  setUserOnline(userId, socketId) {
    this.onlineUsers.add(userId);
    
    // Broadcast presence update
    this.redis.publish('user:online', JSON.stringify({
      userId,
      socketId,
      timestamp: Date.now()
    }));
  }

  setUserOffline(userId, socketId) {
    this.onlineUsers.delete(userId);
    
    // Broadcast presence update
    this.redis.publish('user:offline', JSON.stringify({
      userId,
      socketId,
      timestamp: Date.now()
    }));
  }

  isUserOnline(userId) {
    return this.onlineUsers.has(userId);
  }

  getOnlineUsers() {
    return Array.from(this.onlineUsers);
  }

  // =================== TYPING INDICATORS ===================
  
  setUserTyping(roomKey, userId, userName, isTyping = true) {
    if (!this.typingUsers.has(roomKey)) {
      this.typingUsers.set(roomKey, new Map());
    }
    
    const roomTyping = this.typingUsers.get(roomKey);
    
    if (isTyping) {
      roomTyping.set(userId, {
        userId,
        userName,
        timestamp: Date.now()
      });
      
      // Auto-remove after 3 seconds
      setTimeout(() => {
        roomTyping.delete(userId);
      }, 3000);
    } else {
      roomTyping.delete(userId);
    }
    
    // Broadcast typing update
    this.redis.publish('typing:update', JSON.stringify({
      roomKey,
      typingUsers: Array.from(roomTyping.values())
    }));
  }

  getTypingUsers(roomKey) {
    const roomTyping = this.typingUsers.get(roomKey);
    if (!roomTyping) return [];
    
    // Filter out expired typing indicators
    const now = Date.now();
    const activeTyping = [];
    
    for (const [userId, data] of roomTyping.entries()) {
      if (now - data.timestamp < 3000) {
        activeTyping.push(data);
      } else {
        roomTyping.delete(userId);
      }
    }
    
    return activeTyping;
  }

  // =================== UTILITY METHODS ===================
  
  getRoomKey(chat) {
    if (chat.type === 'direct') {
      return `direct:${chat.userId}`;
    } else if (chat.type === 'ride') {
      return `ride:${chat.id}`;
    } else if (chat.type === 'group') {
      return `group:${chat.id}`;
    }
    return null;
  }

  async invalidateUserCache(userId) {
    // Clear all cache levels
    this.chatListCache.delete(`chatlist:${userId}`);
    this.userCache.delete(userId);
    this.connectionCache.delete(userId);
    
    // Clear Redis
    await Promise.all([
      this.redis.del(`chatlist:${userId}`),
      this.redis.del(`user:${userId}`),
      this.redis.del(`connections:${userId}`)
    ]);
  }

  async invalidateMessageCache(conversationKey) {
    // Clear paginated message caches
    const pattern = `messages:${conversationKey}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    
    // Clear memory cache
    this.messageCache.clear();
  }

  // =================== PERFORMANCE & MAINTENANCE ===================
  
  setupCleanupTimers() {
    // Cleanup expired room memberships every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, membership] of this.roomMembershipCache.entries()) {
        if (now - membership.timestamp > 600000) { // 10 minutes
          this.roomMembershipCache.delete(key);
        }
      }
    }, 300000);
    
    // Cleanup expired typing indicators every minute
    setInterval(() => {
      const now = Date.now();
      for (const [roomKey, roomTyping] of this.typingUsers.entries()) {
        for (const [userId, data] of roomTyping.entries()) {
          if (now - data.timestamp > 3000) {
            roomTyping.delete(userId);
          }
        }
        
        if (roomTyping.size === 0) {
          this.typingUsers.delete(roomKey);
        }
      }
    }, 60000);
  }

  getStats() {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? (this.cacheHits / totalRequests * 100).toFixed(2) : 0;
    
    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: `${hitRate}%`,
      onlineUsers: this.onlineUsers.size,
      cachedConnections: this.connectionCache.size,
      roomMemberships: this.roomMembershipCache.size,
      typingRooms: this.typingUsers.size,
      l1CacheSize: this.l1Cache.size,
      l2CacheSize: this.l2Cache.size,
      chatListCacheSize: this.chatListCache.size,
      messageCacheSize: this.messageCache.size,
      userCacheSize: this.userCache.size
    };
  }

  async shutdown() {
    await this.redis.quit();
  }
}

module.exports = new ChatCacheService();