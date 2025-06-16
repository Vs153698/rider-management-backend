// src/services/ConnectionManager.js
const ChatCacheService = require('./ChatCacheService');

class ConnectionManager {
  constructor() {
    // Core connection mappings
    this.userSockets = new Map(); // userId -> Set of socketIds
    this.socketUsers = new Map(); // socketId -> userId  
    this.socketRooms = new Map(); // socketId -> Set of rooms
    this.userRooms = new Map(); // userId -> Set of rooms
    
    // Performance tracking
    this.connectionCount = 0;
    this.roomCount = 0;
    
    // Room type mappings for fast lookups
    this.directRooms = new Map(); // "userId1:userId2" -> room key
    this.rideRooms = new Map(); // rideId -> room key
    this.groupRooms = new Map(); // groupId -> room key
  }

  // =================== CONNECTION MANAGEMENT ===================
  
  addConnection(userId, socketId, userInfo = {}) {
    // Track user -> sockets mapping
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socketId);
    
    // Track socket -> user mapping
    this.socketUsers.set(socketId, {
      userId,
      connectedAt: Date.now(),
      ...userInfo
    });
    
    // Initialize socket rooms
    this.socketRooms.set(socketId, new Set());
    
    // Update online status
    ChatCacheService.setUserOnline(userId, socketId);
    
    this.connectionCount++;
    console.log(`✅ User ${userId} connected [${socketId}] - Total: ${this.connectionCount}`);
    
    return true;
  }

  removeConnection(socketId) {
    const userInfo = this.socketUsers.get(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    // Remove from user sockets
    const userSocketSet = this.userSockets.get(userId);
    if (userSocketSet) {
      userSocketSet.delete(socketId);
      
      // If no more sockets for this user
      if (userSocketSet.size === 0) {
        this.userSockets.delete(userId);
        // Update offline status
        ChatCacheService.setUserOffline(userId, socketId);
      }
    }
    
    // Clean up socket mappings
    this.socketUsers.delete(socketId);
    
    // Clean up room memberships
    const socketRoomSet = this.socketRooms.get(socketId);
    if (socketRoomSet) {
      socketRoomSet.forEach(room => {
        this.leaveRoom(socketId, room);
      });
      this.socketRooms.delete(socketId);
    }
    
    this.connectionCount--;
    console.log(`❌ User ${userId} disconnected [${socketId}] - Total: ${this.connectionCount}`);
    
    return true;
  }

  // =================== ROOM MANAGEMENT ===================
  
  joinRoom(socketId, room, roomType = 'unknown') {
    const userInfo = this.socketUsers.get(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    // Add socket to room
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    this.socketRooms.get(socketId).add(room);
    
    // Add user to room tracking
    if (!this.userRooms.has(userId)) {
      this.userRooms.set(userId, new Set());
    }
    this.userRooms.get(userId).add(room);
    
    // Track room type for optimization
    this.trackRoomType(room, roomType);
    
    console.log(`🏠 User ${userId} joined room: ${room}`);
    return true;
  }

  leaveRoom(socketId, room) {
    const userInfo = this.socketUsers.get(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    // Remove socket from room
    const socketRoomSet = this.socketRooms.get(socketId);
    if (socketRoomSet) {
      socketRoomSet.delete(room);
    }
    
    // Check if user has other sockets in this room
    const userSockets = this.getUserSockets(userId);
    let userStillInRoom = false;
    
    for (const otherSocketId of userSockets) {
      if (otherSocketId !== socketId) {
        const otherSocketRooms = this.socketRooms.get(otherSocketId);
        if (otherSocketRooms && otherSocketRooms.has(room)) {
          userStillInRoom = true;
          break;
        }
      }
    }
    
    // If user has no sockets in room, remove from user rooms
    if (!userStillInRoom) {
      const userRoomSet = this.userRooms.get(userId);
      if (userRoomSet) {
        userRoomSet.delete(room);
        if (userRoomSet.size === 0) {
          this.userRooms.delete(userId);
        }
      }
    }
    
    console.log(`🚪 User ${userId} left room: ${room}`);
    return true;
  }

  trackRoomType(room, roomType) {
    if (roomType === 'direct') {
      // Extract user IDs from direct room format: "direct:user1:user2"
      const match = room.match(/direct:(\d+):(\d+)/);
      if (match) {
        const [, user1, user2] = match;
        const key = `${user1}:${user2}`;
        this.directRooms.set(key, room);
      }
    } else if (roomType === 'ride') {
      // Extract ride ID from room format: "ride:123"
      const match = room.match(/ride:(\d+)/);
      if (match) {
        this.rideRooms.set(match[1], room);
      }
    } else if (roomType === 'group') {
      // Extract group ID from room format: "group:123"
      const match = room.match(/group:(\d+)/);
      if (match) {
        this.groupRooms.set(match[1], room);
      }
    }
  }

  // =================== LOOKUP METHODS ===================
  
  getUserSockets(userId) {
    return this.userSockets.get(userId) || new Set();
  }

  getSocketUser(socketId) {
    return this.socketUsers.get(socketId);
  }

  getUserRooms(userId) {
    return this.userRooms.get(userId) || new Set();
  }

  getSocketRooms(socketId) {
    return this.socketRooms.get(socketId) || new Set();
  }

  isUserOnline(userId) {
    const sockets = this.userSockets.get(userId);
    return sockets && sockets.size > 0;
  }

  getOnlineUsers() {
    return Array.from(this.userSockets.keys());
  }

  // =================== ROOM UTILITIES ===================
  
  generateDirectRoomKey(userId1, userId2) {
    const [user1, user2] = [userId1, userId2].sort((a, b) => a - b);
    return `direct:${user1}:${user2}`;
  }

  generateRideRoomKey(rideId) {
    return `ride:${rideId}`;
  }

  generateGroupRoomKey(groupId) {
    return `group:${groupId}`;
  }

  generateUserRoomKey(userId) {
    return `user:${userId}`;
  }

  // =================== BROADCASTING METHODS ===================
  
  broadcastToUser(userId, event, data, excludeSocketId = null) {
    const userSockets = this.getUserSockets(userId);
    const socketIds = [];
    
    for (const socketId of userSockets) {
      if (socketId !== excludeSocketId) {
        socketIds.push(socketId);
      }
    }
    
    return socketIds;
  }

  getUsersInRoom(room) {
    const users = new Set();
    
    for (const [userId, userRooms] of this.userRooms.entries()) {
      if (userRooms.has(room)) {
        users.add(userId);
      }
    }
    
    return Array.from(users);
  }

  getSocketsInRoom(room) {
    const sockets = new Set();
    
    for (const [socketId, socketRooms] of this.socketRooms.entries()) {
      if (socketRooms.has(room)) {
        sockets.add(socketId);
      }
    }
    
    return Array.from(sockets);
  }

  // =================== AUTHORIZATION HELPERS ===================
  
  async canJoinDirectRoom(socketId, otherUserId) {
    const userInfo = this.getSocketUser(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    // Can't chat with yourself
    if (userId === otherUserId) return false;
    
    // Check cached connection
    const connections = await ChatCacheService.getUserConnections(userId);
    if (connections) {
      return connections.some(conn => 
        conn.connected_user_id === otherUserId && 
        conn.status !== 'blocked'
      );
    }
    
    // Default to allow (will be verified in handler)
    return true;
  }

  async canJoinRideRoom(socketId, rideId) {
    const userInfo = this.getSocketUser(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    // Check cached membership
    const membership = ChatCacheService.getRoomMembership(`ride:${rideId}`, userId);
    if (membership !== null) {
      return membership.isMember;
    }
    
    // Default to require verification
    return null; // null means needs DB verification
  }

  async canJoinGroupRoom(socketId, groupId) {
    const userInfo = this.getSocketUser(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    // Check cached membership
    const membership = ChatCacheService.getRoomMembership(`group:${groupId}`, userId);
    if (membership !== null) {
      return membership.isMember;
    }
    
    // Default to require verification
    return null; // null means needs DB verification
  }

  // =================== PERFORMANCE OPTIMIZATION ===================
  
  // Batch operations for better performance
  batchJoinRooms(socketId, rooms) {
    const userInfo = this.socketUsers.get(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    // Initialize if needed
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    if (!this.userRooms.has(userId)) {
      this.userRooms.set(userId, new Set());
    }
    
    const socketRoomSet = this.socketRooms.get(socketId);
    const userRoomSet = this.userRooms.get(userId);
    
    // Add all rooms at once
    rooms.forEach(room => {
      socketRoomSet.add(room);
      userRoomSet.add(room);
    });
    
    console.log(`🏠 User ${userId} batch joined ${rooms.length} rooms`);
    return true;
  }

  batchLeaveRooms(socketId, rooms) {
    const userInfo = this.socketUsers.get(socketId);
    if (!userInfo) return false;
    
    const { userId } = userInfo;
    
    const socketRoomSet = this.socketRooms.get(socketId);
    const userRoomSet = this.userRooms.get(userId);
    
    if (socketRoomSet) {
      rooms.forEach(room => socketRoomSet.delete(room));
    }
    
    // Check if user still has other sockets in these rooms
    const userSockets = this.getUserSockets(userId);
    const roomsToRemoveFromUser = new Set(rooms);
    
    for (const otherSocketId of userSockets) {
      if (otherSocketId !== socketId) {
        const otherSocketRooms = this.socketRooms.get(otherSocketId);
        if (otherSocketRooms) {
          rooms.forEach(room => {
            if (otherSocketRooms.has(room)) {
              roomsToRemoveFromUser.delete(room);
            }
          });
        }
      }
    }
    
    // Remove rooms where user has no other sockets
    if (userRoomSet) {
      roomsToRemoveFromUser.forEach(room => userRoomSet.delete(room));
    }
    
    console.log(`🚪 User ${userId} batch left ${rooms.length} rooms`);
    return true;
  }

  // =================== STATS & MONITORING ===================
  
  getConnectionStats() {
    return {
      totalConnections: this.connectionCount,
      uniqueUsers: this.userSockets.size,
      totalRooms: this.roomCount,
      directRooms: this.directRooms.size,
      rideRooms: this.rideRooms.size,
      groupRooms: this.groupRooms.size,
      averageSocketsPerUser: this.connectionCount / Math.max(this.userSockets.size, 1),
      memoryUsage: {
        userSockets: this.userSockets.size,
        socketUsers: this.socketUsers.size,
        socketRooms: this.socketRooms.size,
        userRooms: this.userRooms.size
      }
    };
  }

  // Get detailed info for debugging
  getUserConnectionInfo(userId) {
    const sockets = this.getUserSockets(userId);
    const rooms = this.getUserRooms(userId);
    
    const socketDetails = [];
    for (const socketId of sockets) {
      const userInfo = this.getSocketUser(socketId);
      const socketRooms = this.getSocketRooms(socketId);
      
      socketDetails.push({
        socketId,
        connectedAt: userInfo?.connectedAt,
        rooms: Array.from(socketRooms)
      });
    }
    
    return {
      userId,
      isOnline: this.isUserOnline(userId),
      socketCount: sockets.size,
      roomCount: rooms.size,
      sockets: socketDetails,
      rooms: Array.from(rooms)
    };
  }

  // =================== CLEANUP & MAINTENANCE ===================
  
  // Periodic cleanup of stale connections
  performMaintenance() {
    let cleaned = 0;
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean up stale socket connections
    for (const [socketId, userInfo] of this.socketUsers.entries()) {
      if (now - userInfo.connectedAt > staleThreshold) {
        this.removeConnection(socketId);
        cleaned++;
      }
    }
    
    // Clean up empty room mappings
    for (const [userId, roomSet] of this.userRooms.entries()) {
      if (roomSet.size === 0) {
        this.userRooms.delete(userId);
      }
    }
    
    for (const [socketId, roomSet] of this.socketRooms.entries()) {
      if (roomSet.size === 0) {
        this.socketRooms.delete(socketId);
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} stale connections`);
    }
    
    return cleaned;
  }

  // Start maintenance timer
  startMaintenance() {
    // Run maintenance every hour
    setInterval(() => {
      this.performMaintenance();
    }, 60 * 60 * 1000);
    
    console.log('🔧 Connection maintenance timer started');
  }

  // =================== SHUTDOWN ===================
  
  shutdown() {
    console.log('🔌 Shutting down Connection Manager...');
    
    // Clear all maps
    this.userSockets.clear();
    this.socketUsers.clear();
    this.socketRooms.clear();
    this.userRooms.clear();
    this.directRooms.clear();
    this.rideRooms.clear();
    this.groupRooms.clear();
    
    this.connectionCount = 0;
    this.roomCount = 0;
    
    console.log('✅ Connection Manager shutdown complete');
  }
}

module.exports = new ConnectionManager();