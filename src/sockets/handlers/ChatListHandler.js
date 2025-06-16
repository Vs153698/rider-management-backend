// src/handlers/ChatListHandler.js
const ChatCacheService = require('../services/ChatCacheService');
const ConnectionManager = require('../services/ConnectionManager');
const { Chat, User, Ride, Group, UserConnection } = require('../../models');
const { Op } = require('sequelize');

class ChatListHandler {
  constructor(io) {
    this.io = io;
    this.setupEventListeners();
  }

  setupEventListeners() {
    try {
      // Listen for real-time updates
      const messageQueueService = require('../services/MessageQueueService');
      messageQueueService.on('message:new', this.handleNewMessage.bind(this));
      messageQueueService.on('chat:update', this.handleChatUpdate.bind(this));
    } catch (error) {
      console.error('Error setting up ChatListHandler event listeners:', error);
    }
  }

  // =================== SOCKET HANDLERS ===================

  async handleSyncChatList(socket) {
    const startTime = Date.now();
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    
    if (!userInfo) {
      return socket.emit('sync_error', { message: 'User not authenticated' });
    }

    const { userId } = userInfo;

    try {
      console.log(`📋 Fast chat list sync for user ${userId}`);

      // Try cache first - this should be instant
      let chatList = await ChatCacheService.getChatList(userId);
      if (Array.isArray(chatList) && chatList.length > 0) {
        console.log(`⚡ Cache hit! Sending ${chatList.length} chats in ${Date.now() - startTime}ms`);
        return socket.emit('chat_list_loaded', {
          chats: chatList,
          fromCache: true,
          loadTime: Date.now() - startTime
        });
      }

      // Cache miss - build and cache for future requests
      console.log(`💾 Cache miss, building chat list for user ${userId}`);
      chatList = await this.buildChatListOptimized(userId);
      
      // Cache the result
      await ChatCacheService.setChatList(userId, chatList);
      
      console.log(`📤 Built and cached ${chatList.length} chats in ${Date.now() - startTime}ms`);
      
      socket.emit('chat_list_loaded', {
        chats: chatList,
        fromCache: false,
        loadTime: Date.now() - startTime
      });

    } catch (error) {
      console.error('Chat list sync error:', error);
      socket.emit('sync_error', { 
        message: 'Failed to load chat list',
        error: error.message 
      });
    }
  }

  async buildChatListOptimized(userId) {
    const chatList = [];

    try {
      // Use Promise.all for parallel execution
      const [directChats, rideChats, groupChats] = await Promise.all([
        this.getDirectChatsOptimized(userId),
        this.getRideChatsOptimized(userId),
        this.getGroupChatsOptimized(userId)
      ]);

      // Merge all chats
      chatList.push(...directChats, ...rideChats, ...groupChats);

      console.log(`📋 Built chat list for user ${userId} with ${chatList} chats`);

      // Sort by last activity (most recent first)
      chatList.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

      // Limit to 100 most recent chats
      return chatList.slice(0, 100);

    } catch (error) {
      console.error('Error building chat list:', error);
      throw error;
    }
  }

  async getDirectChatsOptimized(userId) {
    try {
      // Single optimized query for direct messages
      const directMessages = await Chat.sequelize.query(`
        WITH ranked_messages AS (
          SELECT 
            c.*,
            sender.id as sender_id, sender.first_name as sender_fname, 
            sender.last_name as sender_lname, sender.profile_picture as sender_pic,
            recipient.id as recipient_id, recipient.first_name as recipient_fname,
            recipient.last_name as recipient_lname, recipient.profile_picture as recipient_pic,
            ROW_NUMBER() OVER (
              PARTITION BY 
                CASE 
                  WHEN c.sender_id = :userId THEN c.recipient_id
                  ELSE c.sender_id
                END
              ORDER BY c.created_at DESC
            ) as rn
          FROM "Chats" c
          INNER JOIN "Users" sender ON c.sender_id = sender.id
          INNER JOIN "Users" recipient ON c.recipient_id = recipient.id
          WHERE c.chat_type = 'direct'
            AND (c.sender_id = :userId OR c.recipient_id = :userId)
            AND c.is_deleted = false
        )
        SELECT * FROM ranked_messages WHERE rn = 1
        ORDER BY created_at DESC
        LIMIT 50
      `, {
        replacements: { userId },
        type: Chat.sequelize.QueryTypes.SELECT
      });

      const directChats = await Promise.all(
        directMessages.map(async (msg) => {
          const otherUserId = msg.sender_id === userId ? msg.recipient_id : msg.sender_id;
          const otherUser = msg.sender_id === userId ? 
            { id: msg.recipient_id, first_name: msg.recipient_fname, last_name: msg.recipient_lname, profile_picture: msg.recipient_pic } :
            { id: msg.sender_id, first_name: msg.sender_fname, last_name: msg.sender_lname, profile_picture: msg.sender_pic };

          // Get unread count with optimized query
          const unreadCount = await this.getUnreadCountOptimized('direct', userId, { otherUserId });

          return {
            type: 'direct',
            userId: otherUserId,
            userName: `${otherUser.first_name} ${otherUser.last_name}`.trim(),
            avatar: otherUser.profile_picture,
            isOnline: ChatCacheService.isUserOnline(otherUserId),
            lastMessage: {
              id: msg.id,
              message: msg.message,
              message_type: msg.message_type,
              sender_id: msg.sender_id,
              createdAt: msg.created_at,
              is_read: msg.is_read
            },
            unreadCount,
            lastActivity: msg.created_at
          };
        })
      );

      return directChats;

    } catch (error) {
      console.error('Error getting direct chats:', error);
      return [];
    }
  }

  async getRideChatsOptimized(userId) {
    try {
      // Get user's rides with latest messages
      const rideMessages = await Chat.sequelize.query(`
        WITH user_rides AS (
          SELECT DISTINCT r.id as ride_id
          FROM "Rides" r
          LEFT JOIN "RideParticipants" rp ON r.id = rp.ride_id
          WHERE r.creator_id = :userId OR rp.user_id = :userId
        ),
        latest_ride_messages AS (
          SELECT 
            c.*,
            r.title as ride_title,
            r.cover_image as ride_cover,
            ROW_NUMBER() OVER (PARTITION BY c.ride_id ORDER BY c.created_at DESC) as rn
          FROM "Chats" c
          INNER JOIN "Rides" r ON c.ride_id = r.id
          INNER JOIN user_rides ur ON c.ride_id = ur.ride_id
          WHERE c.chat_type = 'ride'
            AND c.is_deleted = false
        )
        SELECT * FROM latest_ride_messages WHERE rn = 1
        ORDER BY created_at DESC
        LIMIT 25
      `, {
        replacements: { userId },
        type: Chat.sequelize.QueryTypes.SELECT
      });

      const rideChats = await Promise.all(
        rideMessages.map(async (msg) => {
          const unreadCount = await this.getUnreadCountOptimized('ride', userId, { rideId: msg.ride_id });
          
          // Get participant count efficiently
          const participantCount = await Chat.sequelize.query(`
            SELECT 
              (SELECT COUNT(*) FROM "RideParticipants" WHERE ride_id = :rideId) + 1 as count
          `, {
            replacements: { rideId: msg.ride_id },
            type: Chat.sequelize.QueryTypes.SELECT
          });

          return {
            type: 'ride',
            id: msg.ride_id,
            title: msg.ride_title,
            avatar: msg.ride_cover,
            participantCount: participantCount[0]?.count || 1,
            lastMessage: {
              id: msg.id,
              message: msg.message,
              message_type: msg.message_type,
              sender_id: msg.sender_id,
              createdAt: msg.created_at,
              is_read: msg.is_read
            },
            unreadCount,
            lastActivity: msg.created_at
          };
        })
      );

      return rideChats;

    } catch (error) {
      console.error('Error getting ride chats:', error);
      return [];
    }
  }

  async getGroupChatsOptimized(userId) {
    try {
      // Get user's groups with latest messages
      const groupMessages = await Chat.sequelize.query(`
        WITH user_groups AS (
          SELECT DISTINCT g.id as group_id
          FROM "Groups" g
          LEFT JOIN "GroupMembers" gm ON g.id = gm.group_id
          WHERE g.admin_id = :userId OR gm.user_id = :userId
        ),
        latest_group_messages AS (
          SELECT 
            c.*,
            g.name as group_name,
            g.cover_image as group_cover,
            ROW_NUMBER() OVER (PARTITION BY c.group_id ORDER BY c.created_at DESC) as rn
          FROM "Chats" c
          INNER JOIN "Groups" g ON c.group_id = g.id
          INNER JOIN user_groups ug ON c.group_id = ug.group_id
          WHERE c.chat_type = 'group'
            AND c.is_deleted = false
        )
        SELECT * FROM latest_group_messages WHERE rn = 1
        ORDER BY created_at DESC
        LIMIT 25
      `, {
        replacements: { userId },
        type: Chat.sequelize.QueryTypes.SELECT
      });

      const groupChats = await Promise.all(
        groupMessages.map(async (msg) => {
          const unreadCount = await this.getUnreadCountOptimized('group', userId, { groupId: msg.group_id });
          
          // Get member count efficiently
          const memberCount = await Chat.sequelize.query(`
            SELECT 
              (SELECT COUNT(*) FROM "GroupMembers" WHERE group_id = :groupId) + 1 as count
          `, {
            replacements: { groupId: msg.group_id },
            type: Chat.sequelize.QueryTypes.SELECT
          });

          return {
            type: 'group',
            id: msg.group_id,
            name: msg.group_name,
            avatar: msg.group_cover,
            memberCount: memberCount[0]?.count || 1,
            lastMessage: {
              id: msg.id,
              message: msg.message,
              message_type: msg.message_type,
              sender_id: msg.sender_id,
              createdAt: msg.created_at,
              is_read: msg.is_read
            },
            unreadCount,
            lastActivity: msg.created_at
          };
        })
      );

      return groupChats;

    } catch (error) {
      console.error('Error getting group chats:', error);
      return [];
    }
  }

  async getUnreadCountOptimized(chatType, userId, params) {
    try {
      let query = '';
      let replacements = { userId };

      if (chatType === 'direct') {
        query = `
          SELECT COUNT(*) as count
          FROM "Chats"
          WHERE chat_type = 'direct'
            AND sender_id = :otherUserId
            AND recipient_id = :userId
            AND is_read = false
            AND is_deleted = false
        `;
        replacements.otherUserId = params.otherUserId;
      } else if (chatType === 'ride') {
        query = `
          SELECT COUNT(*) as count
          FROM "Chats"
          WHERE chat_type = 'ride'
            AND ride_id = :rideId
            AND sender_id != :userId
            AND is_read = false
            AND is_deleted = false
        `;
        replacements.rideId = params.rideId;
      } else if (chatType === 'group') {
        query = `
          SELECT COUNT(*) as count
          FROM "Chats"
          WHERE chat_type = 'group'
            AND group_id = :groupId
            AND sender_id != :userId
            AND is_read = false
            AND is_deleted = false
        `;
        replacements.groupId = params.groupId;
      }

      const result = await Chat.sequelize.query(query, {
        replacements,
        type: Chat.sequelize.QueryTypes.SELECT
      });

      return parseInt(result[0]?.count || 0);

    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  // =================== REAL-TIME UPDATES ===================

  async handleNewMessage(messageData) {
    try {
      // Update chat lists for all affected users
      const affectedUsers = this.getAffectedUsers(messageData);
      
      await Promise.all(
        affectedUsers.map(userId => this.updateChatListForUser(userId, messageData))
      );

    } catch (error) {
      console.error('Error handling new message for chat list:', error);
    }
  }

  // ADDED: Missing handleChatUpdate method
  async handleChatUpdate(updateData) {
    try {
      console.log('Handling chat update:', updateData);
      
      // Handle different types of chat updates
      switch (updateData.type) {
        case 'read_status':
          await this.handleReadStatusUpdate(updateData);
          break;
        case 'participant_added':
        case 'participant_removed':
          await this.handleParticipantUpdate(updateData);
          break;
        case 'chat_settings':
          await this.handleChatSettingsUpdate(updateData);
          break;
        default:
          console.log('Unknown chat update type:', updateData.type);
      }
      
    } catch (error) {
      console.error('Error handling chat update:', error);
    }
  }

  async handleReadStatusUpdate(updateData) {
    try {
      const { userId, chatType, chatId, messageId } = updateData;
      
      // Invalidate chat list cache to refresh unread counts
      await ChatCacheService.invalidateUserCache(userId);
      
      // Notify user's sockets about the update
      const userSockets = ConnectionManager.getUserSockets(userId);
      
      for (const socketId of userSockets) {
        this.io.to(socketId).emit('chat_list_updated', {
          type: 'read_status_changed',
          chatType,
          chatId,
          messageId,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error handling read status update:', error);
    }
  }

  async handleParticipantUpdate(updateData) {
    try {
      const { chatType, chatId, participants } = updateData;
      
      // Invalidate cache for all affected participants
      const invalidatePromises = participants.map(userId => 
        ChatCacheService.invalidateUserCache(userId)
      );
      
      await Promise.all(invalidatePromises);
      
      // Notify all participants
      for (const userId of participants) {
        const userSockets = ConnectionManager.getUserSockets(userId);
        
        for (const socketId of userSockets) {
          this.io.to(socketId).emit('chat_list_updated', {
            type: 'participants_changed',
            chatType,
            chatId,
            timestamp: new Date().toISOString()
          });
        }
      }
      
    } catch (error) {
      console.error('Error handling participant update:', error);
    }
  }

  async handleChatSettingsUpdate(updateData) {
    try {
      const { chatType, chatId, participants, settings } = updateData;
      
      // Invalidate cache for all participants
      const invalidatePromises = participants.map(userId => 
        ChatCacheService.invalidateUserCache(userId)
      );
      
      await Promise.all(invalidatePromises);
      
      // Notify all participants about settings change
      for (const userId of participants) {
        const userSockets = ConnectionManager.getUserSockets(userId);
        
        for (const socketId of userSockets) {
          this.io.to(socketId).emit('chat_list_updated', {
            type: 'settings_changed',
            chatType,
            chatId,
            settings,
            timestamp: new Date().toISOString()
          });
        }
      }
      
    } catch (error) {
      console.error('Error handling chat settings update:', error);
    }
  }

  getAffectedUsers(messageData) {
    const users = [];
    
    if (messageData.chat_type === 'direct') {
      users.push(messageData.sender_id);
      if (messageData.recipient_id !== messageData.sender_id) {
        users.push(messageData.recipient_id);
      }
    } else if (messageData.chat_type === 'ride') {
      // Get all ride participants (this should be cached)
      // For now, we'll handle this in the socket layer
      users.push(messageData.sender_id);
    } else if (messageData.chat_type === 'group') {
      // Get all group members (this should be cached)
      // For now, we'll handle this in the socket layer
      users.push(messageData.sender_id);
    }
    
    return users;
  }

  async updateChatListForUser(userId, messageData) {
    try {
      // Prepare chat update data
      const chatUpdate = {
        lastMessage: {
          id: messageData.id,
          message: messageData.message,
          message_type: messageData.message_type,
          sender_id: messageData.sender_id,
          createdAt: messageData.createdAt || new Date().toISOString(),
          is_read: false
        },
        lastActivity: messageData.createdAt || new Date().toISOString()
      };

      if (messageData.chat_type === 'direct') {
        const otherUserId = userId === messageData.sender_id ? 
          messageData.recipient_id : messageData.sender_id;
        
        chatUpdate.type = 'direct';
        chatUpdate.userId = otherUserId;
      } else if (messageData.chat_type === 'ride') {
        chatUpdate.type = 'ride';
        chatUpdate.id = messageData.ride_id;
      } else if (messageData.chat_type === 'group') {
        chatUpdate.type = 'group';
        chatUpdate.id = messageData.group_id;
      }

      // Update unread count if not sender
      if (userId !== messageData.sender_id) {
        // This could be optimized further with cached counters
        chatUpdate.unreadCount = await this.getUnreadCountForUpdate(userId, messageData);
      }

      // Update cache
      const updatedChat = await ChatCacheService.updateChatInList(userId, chatUpdate);
      
      if (updatedChat) {
        // Emit to user's connected sockets
        const userSockets = ConnectionManager.getUserSockets(userId);
        
        for (const socketId of userSockets) {
          this.io.to(socketId).emit('chat_list_updated', {
            type: 'message_received',
            chat: updatedChat,
            message: messageData
          });
        }
      }

    } catch (error) {
      console.error(`Error updating chat list for user ${userId}:`, error);
    }
  }

  async getUnreadCountForUpdate(userId, messageData) {
    // This is a simplified version - in production you might want to use cached counters
    try {
      if (messageData.chat_type === 'direct') {
        return await this.getUnreadCountOptimized('direct', userId, { 
          otherUserId: messageData.sender_id 
        });
      } else if (messageData.chat_type === 'ride') {
        return await this.getUnreadCountOptimized('ride', userId, { 
          rideId: messageData.ride_id 
        });
      } else if (messageData.chat_type === 'group') {
        return await this.getUnreadCountOptimized('group', userId, { 
          groupId: messageData.group_id 
        });
      }
    } catch (error) {
      console.error('Error getting unread count for update:', error);
    }
    
    return 0;
  }

  // =================== CHAT LIST INVALIDATION ===================

  async invalidateChatList(userId, reason = 'unknown') {
    try {
      await ChatCacheService.invalidateUserCache(userId);
      
      // Notify user to refresh chat list
      const userSockets = ConnectionManager.getUserSockets(userId);
      
      for (const socketId of userSockets) {
        this.io.to(socketId).emit('chat_list_invalidated', {
          reason,
          timestamp: new Date().toISOString()
        });
      }
      
      console.log(`📋 Chat list invalidated for user ${userId} - reason: ${reason}`);
      
    } catch (error) {
      console.error(`Error invalidating chat list for user ${userId}:`, error);
    }
  }

  // =================== BATCH OPERATIONS ===================

  async handleBatchChatListSync(userIds) {
    try {
      console.log(`📋 Batch chat list sync for ${userIds.length} users`);
      
      const results = await Promise.allSettled(
        userIds.map(userId => this.buildChatListOptimized(userId))
      );
      
      // Cache all results
      const cachePromises = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const userId = userIds[index];
          cachePromises.push(
            ChatCacheService.setChatList(userId, result.value)
          );
        }
      });
      
      await Promise.all(cachePromises);
      
      console.log(`📋 Batch sync complete for ${userIds.length} users`);
      
      return results;
      
    } catch (error) {
      console.error('Error in batch chat list sync:', error);
      throw error;
    }
  }

  // =================== UTILITY METHODS ===================

  // Get chat list stats for monitoring
  async getChatListStats(userId) {
    try {
      const chatList = await ChatCacheService.getChatList(userId);
      
      if (!chatList) {
        return { error: 'Chat list not cached' };
      }
      
      const stats = {
        totalChats: chatList.length,
        directChats: chatList.filter(c => c.type === 'direct').length,
        rideChats: chatList.filter(c => c.type === 'ride').length,
        groupChats: chatList.filter(c => c.type === 'group').length,
        unreadChats: chatList.filter(c => c.unreadCount > 0).length,
        totalUnreadCount: chatList.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
        onlineContacts: chatList.filter(c => c.type === 'direct' && c.isOnline).length,
        lastActivity: chatList[0]?.lastActivity || null
      };
      
      return stats;
      
    } catch (error) {
      console.error('Error getting chat list stats:', error);
      return { error: error.message };
    }
  }

  // Force refresh chat list (bypass cache)
  async forceRefreshChatList(userId) {
    try {
      console.log(`🔄 Force refreshing chat list for user ${userId}`);
      
      // Clear cache first
      await ChatCacheService.invalidateUserCache(userId);
      
      // Build fresh chat list
      const chatList = await this.buildChatListOptimized(userId);
      
      // Cache the new list
      await ChatCacheService.setChatList(userId, chatList);
      
      // Notify user's sockets
      const userSockets = ConnectionManager.getUserSockets(userId);
      
      for (const socketId of userSockets) {
        this.io.to(socketId).emit('chat_list_refreshed', {
          chats: chatList,
          timestamp: new Date().toISOString()
        });
      }
      
      return chatList;
      
    } catch (error) {
      console.error(`Error force refreshing chat list for user ${userId}:`, error);
      throw error;
    }
  }

  // Handle user connection/disconnection for chat list updates
  async handleUserOnlineStatusChange(userId, isOnline) {
    try {
      // Find all users who have this user in their direct chats
      const affectedUsers = await this.getUsersWithDirectChat(userId);
      
      // Update their cached chat lists
      await Promise.all(
        affectedUsers.map(async (affectedUserId) => {
          const chatList = await ChatCacheService.getChatList(affectedUserId);
          
          if (chatList) {
            // Find and update the direct chat
            const directChat = chatList.find(c => 
              c.type === 'direct' && c.userId === userId
            );
            
            if (directChat) {
              directChat.isOnline = isOnline;
              await ChatCacheService.setChatList(affectedUserId, chatList);
              
              // Notify affected user's sockets
              const userSockets = ConnectionManager.getUserSockets(affectedUserId);
              
              for (const socketId of userSockets) {
                this.io.to(socketId).emit('contact_status_changed', {
                  userId,
                  isOnline,
                  timestamp: new Date().toISOString()
                });
              }
            }
          }
        })
      );
      
    } catch (error) {
      console.error('Error handling user online status change:', error);
    }
  }

  async getUsersWithDirectChat(userId) {
    try {
      // Find all users who have direct conversations with this user
      const result = await Chat.sequelize.query(`
        SELECT DISTINCT 
          CASE 
            WHEN sender_id = :userId THEN recipient_id
            ELSE sender_id
          END as user_id
        FROM "Chats"
        WHERE chat_type = 'direct'
          AND (sender_id = :userId OR recipient_id = :userId)
          AND is_deleted = false
      `, {
        replacements: { userId },
        type: Chat.sequelize.QueryTypes.SELECT
      });
      
      return result.map(row => row.user_id).filter(id => id !== userId);
      
    } catch (error) {
      console.error('Error getting users with direct chat:', error);
      return [];
    }
  }

  // =================== PERFORMANCE MONITORING ===================

  getPerformanceStats() {
    return {
      cacheStats: ChatCacheService.getStats(),
      connectionStats: ConnectionManager.getConnectionStats(),
      handlerStats: {
        messageUpdatesProcessed: this.messageUpdatesProcessed || 0,
        chatListBuilds: this.chatListBuilds || 0,
        cacheHitRate: this.cacheHitRate || 0
      }
    };
  }
}

module.exports = ChatListHandler;