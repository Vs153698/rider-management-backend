// src/handlers/MessageHandler.js
const MessageQueueService = require('../services/MessageQueueService');
const ChatCacheService = require('../services/ChatCacheService');
const ConnectionManager = require('../services/ConnectionManager');
const { Chat, User, UserConnection } = require('../../models');
const { Op } = require('sequelize');

class MessageHandler {
  constructor(io) {
    this.io = io;
    this.setupEventListeners();
    
    // Performance tracking
    this.messagesProcessed = 0;
    this.averageProcessingTime = 0;
  }

  setupEventListeners() {
    // Listen for processed messages
    MessageQueueService.on('message:new', this.handleMessageBroadcast.bind(this));
    MessageQueueService.on('message:confirmed', this.handleMessageConfirmation.bind(this));
    MessageQueueService.on('message:failed', this.handleMessageFailure.bind(this));
  }

  // =================== SENDING MESSAGES ===================

  async handleSendMessage(socket, data) {
    const startTime = Date.now();
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    
    if (!userInfo) {
      return socket.emit('message_error', { 
        tempId: data.tempId,
        message: 'User not authenticated' 
      });
    }

    const { userId } = userInfo;

    try {
      // Ultra-fast validation
      const validationError = this.validateMessage(data, userId);
      if (validationError) {
        return socket.emit('message_error', {
          tempId: data.tempId,
          message: validationError
        });
      }

      // Prepare message data
      const messageData = {
        tempId: data.tempId || this.generateTempId(),
        message: data.message,
        message_type: data.message_type || 'text',
        chat_type: data.chat_type || 'direct',
        sender_id: userId,
        recipient_id: data.recipient_id,
        ride_id: data.ride_id,
        group_id: data.group_id,
        reply_to_id: data.reply_to_id,
        metadata: data.metadata || {}
      };

      // Fast authorization check (cached)
      const authResult = await this.checkMessageAuthorization(messageData);
      if (!authResult.authorized) {
        return socket.emit('message_error', {
          tempId: messageData.tempId,
          message: authResult.reason
        });
      }

      // Immediate acknowledgment to sender
      socket.emit('message_queued', {
        tempId: messageData.tempId,
        status: 'queued',
        timestamp: Date.now(),
        processingTime: Date.now() - startTime
      });

      // Queue for processing (non-blocking)
      const queueResult = await MessageQueueService.queueMessage(messageData);
      
      // Update performance metrics
      this.messagesProcessed++;
      const processingTime = Date.now() - startTime;
      this.averageProcessingTime = (this.averageProcessingTime + processingTime) / 2;

      console.log(`📨 Message queued: ${queueResult.id} in ${processingTime}ms`);

    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('message_error', {
        tempId: data.tempId,
        message: 'Failed to send message',
        error: error.message
      });
    }
  }

  validateMessage(data, userId) {
    // Super fast validation
    if (!data.message && data.message_type === 'text') {
      return 'Message content required';
    }

    if (data.chat_type === 'direct') {
      if (!data.recipient_id) return 'Recipient required';
      if (data.recipient_id === userId) return 'Cannot message yourself';
    } else if (data.chat_type === 'ride' && !data.ride_id) {
      return 'Ride ID required';
    } else if (data.chat_type === 'group' && !data.group_id) {
      return 'Group ID required';
    }

    return null;
  }

  async checkMessageAuthorization(messageData) {
    try {
      const { chat_type, sender_id, recipient_id, ride_id, group_id } = messageData;

      if (chat_type === 'direct') {
        // Check cached connection
        const connections = await ChatCacheService.getUserConnections(sender_id);
        if (connections) {
          const hasConnection = connections.some(conn => 
            conn.connected_user_id === recipient_id && 
            conn.status !== 'blocked'
          );
          return { 
            authorized: hasConnection, 
            reason: hasConnection ? null : 'No connection or user blocked' 
          };
        }
        
        // Fallback to DB check (will be cached for next time)
        const connection = await UserConnection.findOne({
          where: {
            user_id: sender_id,
            connected_user_id: recipient_id,
            status: { [Op.ne]: 'blocked' }
          },
          attributes: ['id', 'status']
        });

        if (!connection) {
          // Auto-create connection for messaging
          try {
            await UserConnection.create({
              user_id: sender_id,
              connected_user_id: recipient_id,
              initiated_by: sender_id,
              status: 'accepted',
              accepted_at: new Date()
            });
            return { authorized: true };
          } catch (error) {
            return { authorized: false, reason: 'Failed to create connection' };
          }
        }

        return { authorized: true };

      } else if (chat_type === 'ride') {
        // Check cached membership
        const membership = ChatCacheService.getRoomMembership(`ride:${ride_id}`, sender_id);
        if (membership !== null) {
          return { 
            authorized: membership.isMember, 
            reason: membership.isMember ? null : 'Not a ride member' 
          };
        }

        // Fallback to DB check
        const ride = await require('../../models').Ride.findByPk(ride_id, {
          attributes: ['id', 'creator_id'],
          include: [{
            model: User,
            as: 'participants',
            where: { id: sender_id },
            required: false,
            attributes: ['id']
          }]
        });

        const isMember = ride && (
          ride.creator_id === sender_id || 
          (ride.participants && ride.participants.length > 0)
        );

        // Cache the result
        ChatCacheService.setRoomMembership(`ride:${ride_id}`, sender_id, isMember);

        return { 
          authorized: isMember, 
          reason: isMember ? null : 'Not a ride member' 
        };

      } else if (chat_type === 'group') {
        // Similar logic for groups
        const membership = ChatCacheService.getRoomMembership(`group:${group_id}`, sender_id);
        if (membership !== null) {
          return { 
            authorized: membership.isMember, 
            reason: membership.isMember ? null : 'Not a group member' 
          };
        }

        // Fallback to DB check
        const group = await require('../../models').Group.findByPk(group_id, {
          attributes: ['id', 'admin_id'],
          include: [{
            model: User,
            as: 'members',
            where: { id: sender_id },
            required: false,
            attributes: ['id']
          }]
        });

        const isMember = group && (
          group.admin_id === sender_id || 
          (group.members && group.members.length > 0)
        );

        // Cache the result
        ChatCacheService.setRoomMembership(`group:${group_id}`, sender_id, isMember);

        return { 
          authorized: isMember, 
          reason: isMember ? null : 'Not a group member' 
        };
      }

      return { authorized: false, reason: 'Unknown chat type' };

    } catch (error) {
      console.error('Authorization check error:', error);
      return { authorized: false, reason: 'Authorization check failed' };
    }
  }

  // =================== MESSAGE BROADCASTING ===================

  async handleMessageBroadcast(messageData) {
    try {
      const { chat_type, sender_id, recipient_id, ride_id, group_id } = messageData;

      // Determine recipients
      let recipientIds = [];
      let roomKey = null;

      if (chat_type === 'direct') {
        recipientIds = [recipient_id];
        roomKey = ConnectionManager.generateDirectRoomKey(sender_id, recipient_id);
      } else if (chat_type === 'ride') {
        recipientIds = await this.getRideParticipants(ride_id);
        roomKey = ConnectionManager.generateRideRoomKey(ride_id);
      } else if (chat_type === 'group') {
        recipientIds = await this.getGroupMembers(group_id);
        roomKey = ConnectionManager.generateGroupRoomKey(group_id);
      }

      // Broadcast to room
      if (roomKey) {
        this.io.to(roomKey).emit('new_message', messageData);
      }

      // Send individual notifications
      await Promise.all(
        recipientIds
          .filter(id => id !== sender_id)
          .map(recipientId => this.sendDirectNotification(recipientId, messageData))
      );

      // Update conversation caches
      await this.updateConversationCaches(messageData);

    } catch (error) {
      console.error('Message broadcast error:', error);
    }
  }

  async sendDirectNotification(recipientId, messageData) {
    try {
      const userSockets = ConnectionManager.getUserSockets(recipientId);
      
      for (const socketId of userSockets) {
        this.io.to(socketId).emit('new_direct_message', {
          ...messageData,
          conversation_id: this.getConversationId(messageData)
        });
      }

    } catch (error) {
      console.error('Direct notification error:', error);
    }
  }

  async updateConversationCaches(messageData) {
    try {
      const conversationKey = this.getConversationKey(messageData);
      
      // Add to recent messages cache
      await ChatCacheService.addMessageToConversation(conversationKey, messageData);
      
      // Update chat lists for affected users (handled by ChatListHandler)
      
    } catch (error) {
      console.error('Cache update error:', error);
    }
  }

  handleMessageConfirmation(confirmationData) {
    try {
      const { tempId, id, status, timestamp } = confirmationData;
      
      // Find sender's sockets and confirm
      // This is handled by the queue service publishing to specific users
      
    } catch (error) {
      console.error('Message confirmation error:', error);
    }
  }

  handleMessageFailure(failureData) {
    try {
      const { tempId, id, error } = failureData;
      
      // Notify sender of failure
      // This is handled by the queue service
      
    } catch (error) {
      console.error('Message failure handling error:', error);
    }
  }

  // =================== MESSAGE HISTORY ===================

  async handleGetMessages(socket, data) {
    const startTime = Date.now();
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    
    if (!userInfo) {
      return socket.emit('messages_error', { message: 'User not authenticated' });
    }

    const { userId } = userInfo;
    const { chat_type, other_user_id, ride_id, group_id, page = 1, limit = 50 } = data;

    try {
      // Generate conversation key
      const conversationKey = this.generateConversationKey(chat_type, userId, {
        other_user_id, ride_id, group_id
      });

      // Try cache first
      let messages = await ChatCacheService.getCachedMessages(conversationKey, page, limit);
      
      if (messages) {
        console.log(`⚡ Messages cache hit for ${conversationKey} - ${messages.length} messages in ${Date.now() - startTime}ms`);
        return socket.emit('messages_loaded', {
          messages,
          page,
          hasMore: messages.length === limit,
          fromCache: true,
          loadTime: Date.now() - startTime
        });
      }

      // Cache miss - fetch from database
      messages = await this.fetchMessagesFromDB(conversationKey, chat_type, {
        userId, other_user_id, ride_id, group_id, page, limit
      });

      // Cache for future requests
      await ChatCacheService.cacheMessages(conversationKey, messages, page, limit);

      console.log(`💾 Messages fetched from DB for ${conversationKey} - ${messages.length} messages in ${Date.now() - startTime}ms`);

      socket.emit('messages_loaded', {
        messages,
        page,  
        hasMore: messages.length === limit,
        fromCache: false,
        loadTime: Date.now() - startTime
      });

    } catch (error) {
      console.error('Get messages error:', error);
      socket.emit('messages_error', {
        message: 'Failed to load messages',
        error: error.message
      });
    }
  }

  async fetchMessagesFromDB(conversationKey, chat_type, params) {
    const { userId, other_user_id, ride_id, group_id, page, limit } = params;
    const offset = (page - 1) * limit;

    let whereCondition = {
      is_deleted: false,
      chat_type
    };

    if (chat_type === 'direct') {
      whereCondition[Op.or] = [
        { sender_id: userId, recipient_id: other_user_id },
        { sender_id: other_user_id, recipient_id: userId }
      ];
    } else if (chat_type === 'ride') {
      whereCondition.ride_id = ride_id;
    } else if (chat_type === 'group') {
      whereCondition.group_id = group_id;
    }

    const messages = await Chat.findAll({
      where: whereCondition,
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
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: false
    });

    // Convert to plain objects for better performance
    return messages.map(msg => ({
      id: msg.id,
      message: msg.message,
      message_type: msg.message_type,
      chat_type: msg.chat_type,
      sender_id: msg.sender_id,
      recipient_id: msg.recipient_id,
      ride_id: msg.ride_id,
      group_id: msg.group_id,
      reply_to_id: msg.reply_to_id,
      metadata: msg.metadata,
      is_read: msg.is_read,
      is_edited: msg.is_edited,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      sender: msg.sender ? {
        id: msg.sender.id,
        first_name: msg.sender.first_name,
        last_name: msg.sender.last_name,
        profile_picture: msg.sender.profile_picture
      } : null,
      recipient: msg.recipient ? {
        id: msg.recipient.id,
        first_name: msg.recipient.first_name,
        last_name: msg.recipient.last_name,
        profile_picture: msg.recipient.profile_picture
      } : null
    }));
  }

  // =================== MESSAGE ACTIONS ===================

  async handleEditMessage(socket, data) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) {
      return socket.emit('edit_error', { message: 'User not authenticated' });
    }

    const { userId } = userInfo;
    const { message_id, new_message } = data;

    try {
      // Check if user owns the message
      const message = await Chat.findOne({
        where: {
          id: message_id,
          sender_id: userId,
          is_deleted: false
        },
        attributes: ['id', 'chat_type', 'recipient_id', 'ride_id', 'group_id']
      });

      if (!message) {
        return socket.emit('edit_error', { message: 'Message not found or unauthorized' });
      }

      // Update message
      await Chat.update({
        message: new_message,
        is_edited: true,
        edited_at: new Date()
      }, {
        where: { id: message_id }
      });

      // Broadcast update
      const roomKey = this.getRoomKey(message);
      const updateData = {
        id: message_id,
        message: new_message,
        is_edited: true,
        edited_at: new Date()
      };

      this.io.to(roomKey).emit('message_edited', updateData);

      // Invalidate relevant caches
      await this.invalidateMessageCaches(message);

    } catch (error) {
      console.error('Edit message error:', error);
      socket.emit('edit_error', { message: 'Failed to edit message' });
    }
  }

  async handleDeleteMessage(socket, data) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) {
      return socket.emit('delete_error', { message: 'User not authenticated' });
    }

    const { userId } = userInfo;
    const { message_id } = data;

    try {
      // Check if user owns the message
      const message = await Chat.findOne({
        where: {
          id: message_id,
          sender_id: userId,
          is_deleted: false
        },
        attributes: ['id', 'chat_type', 'recipient_id', 'ride_id', 'group_id']
      });

      if (!message) {
        return socket.emit('delete_error', { message: 'Message not found or unauthorized' });
      }

      // Soft delete
      await Chat.update({
        is_deleted: true,
        deleted_at: new Date()
      }, {
        where: { id: message_id }
      });

      // Broadcast deletion
      const roomKey = this.getRoomKey(message);
      this.io.to(roomKey).emit('message_deleted', {
        id: message_id,
        deleted_at: new Date()
      });

      // Invalidate relevant caches
      await this.invalidateMessageCaches(message);

    } catch (error) {
      console.error('Delete message error:', error);
      socket.emit('delete_error', { message: 'Failed to delete message' });
    }
  }

  // =================== READ RECEIPTS ===================

  async handleMarkMessagesRead(socket, data) {
    const userInfo = ConnectionManager.getSocketUser(socket.id);
    if (!userInfo) return;

    const { userId } = userInfo;
    const { chat_type, sender_id, message_ids } = data;

    try {
      let updateQuery = {
        is_read: true,
        read_at: new Date()
      };

      let whereCondition = {
        recipient_id: userId,
        is_read: false,
        is_deleted: false
      };

      if (chat_type === 'direct' && sender_id) {
        whereCondition.chat_type = 'direct';
        whereCondition.sender_id = sender_id;
      } else if (message_ids && Array.isArray(message_ids)) {
        whereCondition.id = { [Op.in]: message_ids };
      }

      const [updatedCount] = await Chat.update(updateQuery, {
        where: whereCondition
      });

      if (updatedCount > 0) {
        // Notify sender about read receipt
        if (chat_type === 'direct' && sender_id) {
          const senderSockets = ConnectionManager.getUserSockets(sender_id);
          
          for (const socketId of senderSockets) {
            this.io.to(socketId).emit('messages_read', {
              reader_id: userId,
              read_at: new Date(),
              count: updatedCount
            });
          }
        }
      }

      socket.emit('mark_read_success', {
        chat_type,
        message_count: updatedCount
      });

    } catch (error) {
      console.error('Mark messages read error:', error);
      socket.emit('mark_read_error', { message: 'Failed to mark messages as read' });
    }
  }

  // =================== UTILITY METHODS ===================

  getConversationKey(messageData) {
    if (messageData.chat_type === 'direct') {
      const [user1, user2] = [messageData.sender_id, messageData.recipient_id].sort();
      return `direct:${user1}:${user2}`;
    } else if (messageData.chat_type === 'ride') {
      return `ride:${messageData.ride_id}`;
    } else if (messageData.chat_type === 'group') {
      return `group:${messageData.group_id}`;
    }
    return 'unknown';
  }

  getConversationId(messageData) {
    return this.getConversationKey(messageData);
  }

  generateConversationKey(chat_type, userId, params) {
    if (chat_type === 'direct') {
      const [user1, user2] = [userId, params.other_user_id].sort();
      return `direct:${user1}:${user2}`;
    } else if (chat_type === 'ride') {
      return `ride:${params.ride_id}`;
    } else if (chat_type === 'group') {
      return `group:${params.group_id}`;
    }
    return 'unknown';
  }

  getRoomKey(message) {
    if (message.chat_type === 'direct') {
      return ConnectionManager.generateDirectRoomKey(message.sender_id, message.recipient_id);
    } else if (message.chat_type === 'ride') {
      return ConnectionManager.generateRideRoomKey(message.ride_id);
    } else if (message.chat_type === 'group') {
      return ConnectionManager.generateGroupRoomKey(message.group_id);
    }
    return null;
  }

  generateTempId() {
    return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getRideParticipants(rideId) {
    // This should be cached for performance
    try {
      const ride = await require('../../models').Ride.findByPk(rideId, {
        attributes: ['creator_id'],
        include: [{
          model: User,
          as: 'participants',
          attributes: ['id'],
          through: { attributes: [] }
        }]
      });

      if (!ride) return [];

      const participants = [ride.creator_id];
      if (ride.participants) {
        participants.push(...ride.participants.map(p => p.id));
      }

      return [...new Set(participants)]; // Remove duplicates
    } catch (error) {
      console.error('Error getting ride participants:', error);
      return [];
    }
  }

  async getGroupMembers(groupId) {
    // This should be cached for performance
    try {
      const group = await require('../../models').Group.findByPk(groupId, {
        attributes: ['admin_id'],
        include: [{
          model: User,
          as: 'members',
          attributes: ['id'],
          through: { attributes: [] }
        }]
      });

      if (!group) return [];

      const members = [group.admin_id];
      if (group.members) {
        members.push(...group.members.map(m => m.id));
      }

      return [...new Set(members)]; // Remove duplicates
    } catch (error) {
      console.error('Error getting group members:', error);
      return [];
    }
  }

  async invalidateMessageCaches(message) {
    try {
      const conversationKey = this.getConversationKey(message);
      await ChatCacheService.invalidateMessageCache(conversationKey);
    } catch (error) {
      console.error('Error invalidating message caches:', error);
    }
  }

  // =================== PERFORMANCE MONITORING ===================

  getPerformanceStats() {
    return {
      messagesProcessed: this.messagesProcessed,
      averageProcessingTime: this.averageProcessingTime,
      queueStats: MessageQueueService.getStats?.() || {}
    };
  }
}

module.exports = MessageHandler;