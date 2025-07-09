// src/sockets/socketHandlers.js - Fixed version with proper chat fetching
const HighPerformanceSocketManager = require('./SocketMangers');
const { Chat, User, UserConnection, Group, Ride } = require('../models');
const { Op } = require('sequelize');
const { logger } = require('../middleware/errorHandler');

// Extend the socket manager with specialized handlers
class ExtendedSocketManager extends HighPerformanceSocketManager {
  constructor(io) {
    super(io);
    this.setupAdvancedHandlers();
  }
  
  setupAdvancedHandlers() {
    this.io.on('connection', (socket) => {
      this.setupUserSpecificHandlers(socket);
    });
  }
  
  setupUserSpecificHandlers(socket) {
    const requireAuth = (callback) => {
      return (...args) => {
        if (!socket.userId) {
          return socket.emit('auth_error', { error: 'Authentication required' });
        }
        return callback(...args);
      };
    };

    // Enhanced chat features
    socket.on('react_to_message', requireAuth((data) => this.handleReactToMessage(socket, data)));
    socket.on('edit_message', requireAuth((data) => this.handleEditMessage(socket, data)));
    socket.on('delete_message', requireAuth((data) => this.handleDeleteMessage(socket, data)));
    socket.on('forward_message', requireAuth((data) => this.handleForwardMessage(socket, data)));
    
    // Advanced friend features
    socket.on('block_user', requireAuth((data) => this.handleBlockUser(socket, data)));
    socket.on('unblock_user', requireAuth((data) => this.handleUnblockUser(socket, data)));
    socket.on('remove_friend', requireAuth((data) => this.handleRemoveFriend(socket, data)));
    socket.on('get_mutual_friends', requireAuth((data) => this.handleGetMutualFriends(socket, data)));
    
    // Group management
    socket.on('create_group', requireAuth((data) => this.handleCreateGroup(socket, data)));
    socket.on('join_group', requireAuth((data) => this.handleJoinGroup(socket, data)));
    socket.on('leave_group', requireAuth((data) => this.handleLeaveGroup(socket, data)));
    socket.on('invite_to_group', requireAuth((data) => this.handleInviteToGroup(socket, data)));
    socket.on('remove_from_group', requireAuth((data) => this.handleRemoveFromGroup(socket, data)));
    socket.on('transfer_group_admin', requireAuth((data) => this.handleTransferGroupAdmin(socket, data)));
    
    // Ride management
    socket.on('create_ride', requireAuth((data) => this.handleCreateRide(socket, data)));
    socket.on('join_ride', requireAuth((data) => this.handleJoinRide(socket, data)));
    socket.on('leave_ride', requireAuth((data) => this.handleLeaveRide(socket, data)));
    socket.on('update_ride_status', requireAuth((data) => this.handleUpdateRideStatus(socket, data)));
    
    // Advanced messaging features
    socket.on('create_poll', requireAuth((data) => this.handleCreatePoll(socket, data)));
    socket.on('vote_poll', requireAuth((data) => this.handleVotePoll(socket, data)));
    socket.on('close_poll', requireAuth((data) => this.handleClosePoll(socket, data)));
    socket.on('share_location', requireAuth((data) => this.handleShareLocation(socket, data)));
    socket.on('send_voice_note', requireAuth((data) => this.handleSendVoiceNote(socket, data)));
    socket.on('send_file', requireAuth((data) => this.handleSendFile(socket, data)));
    
    // Real-time status updates
    socket.on('update_ride_location', requireAuth((data) => this.handleUpdateRideLocation(socket, data)));
    socket.on('send_quick_status', requireAuth((data) => this.handleSendQuickStatus(socket, data)));
    socket.on('send_fuel_status', requireAuth((data) => this.handleSendFuelStatus(socket, data)));
    socket.on('create_itinerary', requireAuth((data) => this.handleCreateItinerary(socket, data)));
    
    // Bulk operations for performance
    socket.on('mark_multiple_read', requireAuth((data) => this.handleMarkMultipleRead(socket, data)));
    socket.on('archive_conversations', requireAuth((data) => this.handleArchiveConversations(socket, data)));
    
    // FIXED: Chat list sync handler
    socket.on('sync_chat_list', requireAuth(() => {
      console.log('🔄 sync_chat_list event received for socket:', socket.id);
      this.handleSyncChatList(socket);
    }));
    
    // Real-time search
    socket.on('search_messages', requireAuth((data) => this.handleSearchMessages(socket, data)));
    socket.on('search_users', requireAuth((data) => this.handleSearchUsers(socket, data)));
    
    // Presence and activity
    socket.on('update_activity', requireAuth((data) => this.handleUpdateActivity(socket, data)));
    socket.on('get_online_status', requireAuth((data) => this.handleGetOnlineStatus(socket, data)));
  }
  
  // ==================== FIXED CHAT LIST SYNC ====================
  
  async handleSyncChatList(socket) {
    try {
      const userId = socket.userId;
      console.log(`🔄 Starting comprehensive chat sync for user ${userId}`);
      
      // Get all chat types in parallel for better performance
      const [directChats, groupChats, rideChats] = await Promise.all([
        this.getUserDirectChats(userId),
        this.getUserGroupChats(userId),
        this.getUserRideChats(userId)
      ]);
      
      console.log(`📊 Chat sync results for user ${userId}:`, {
        direct: directChats.length,
        groups: groupChats.length,
        rides: rideChats.length
      });
      
      // Combine and sort all chats
      const allChats = [...directChats, ...groupChats, ...rideChats];
      
      // Sort by last activity (most recent first)
      allChats.sort((a, b) => {
        const timeA = a.lastMessage?.createdAt || a.lastActivity || a.updated_at;
        const timeB = b.lastMessage?.createdAt || b.lastActivity || b.updated_at;
        return new Date(timeB) - new Date(timeA);
      });
      
      console.log(`✅ Successfully synced ${allChats.length} chats for user ${userId}`);
      
      // Send to client
      socket.emit('chat_list_synced', {
        chat_list: allChats,
        total_count: allChats.length,
        timestamp: new Date(),
        sync_id: Date.now(),
        user_id: userId,
        breakdown: {
          direct: directChats.length,
          groups: groupChats.length,
          rides: rideChats.length
        }
      });
      
    } catch (error) {
      console.error('❌ Sync chat list error:', error);
      socket.emit('sync_error', { 
        error: 'Failed to sync chat list',
        details: error.message,
        code: 'SYNC_FAILED'
      });
    }
  }

  // ==================== FIXED DIRECT CHATS ====================
  
  async getUserDirectChats(userId) {
    try {
      console.log(`📱 Fetching direct chats for user ${userId}`);
      
      // Get all accepted friend connections
      const friendConnections = await UserConnection.findAll({
        where: {
          [Op.or]: [
            { user_id: userId, status: 'accepted' },
            { connected_user_id: userId, status: 'accepted' }
          ]
        },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active', 'is_online']
          },
          {
            model: User,
            as: 'connectedUser',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active', 'is_online']
          }
        ]
      });
      
      console.log(`📱 Found ${friendConnections.length} friend connections for user ${userId}`);
      
      if (friendConnections.length === 0) {
        return [];
      }
      
      const directChats = [];
      const processedUserIds = new Set(); // Prevent duplicates
      
      for (const connection of friendConnections) {
        const friend = connection.user_id === userId ? connection.connectedUser : connection.user;
        
        if (!friend || processedUserIds.has(friend.id)) {
          continue; // Skip if already processed or invalid
        }
        
        processedUserIds.add(friend.id);
        
        // Get last message between these users
        const lastMessage = await Chat.findOne({
          where: {
            chat_type: 'direct',
            [Op.or]: [
              { sender_id: userId, recipient_id: friend.id },
              { sender_id: friend.id, recipient_id: userId }
            ],
            is_deleted: false
          },
          include: [{
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }],
          order: [['createdAt', 'DESC']]
        });
        
        // Get unread count
        const unreadCount = await Chat.count({
          where: {
            chat_type: 'direct',
            sender_id: friend.id,
            recipient_id: userId,
            is_read: false,
            is_deleted: false
          }
        });
        
        // Check if friend is online
        const isOnline = this.presenceCache.has(friend.id) && 
                        this.presenceCache.get(friend.id).status === 'online';
        
        directChats.push({
          type: 'direct',
          id: friend.id,
          userId: friend.id,
          user: {
            id: friend.id,
            first_name: friend.first_name,
            last_name: friend.last_name,
            profile_picture: friend.profile_picture,
            last_active: friend.last_active,
            is_online: friend.is_online
          },
          userName: `${friend.first_name} ${friend.last_name}`.trim(),
          name: `${friend.first_name} ${friend.last_name}`.trim(),
          avatar: friend.profile_picture,
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            message: lastMessage.message,
            message_type: lastMessage.message_type,
            sender_id: lastMessage.sender_id,
            sender: lastMessage.sender,
            createdAt: lastMessage.createdAt,
            is_read: lastMessage.is_read
          } : null,
          unreadCount,
          isOnline,
          lastActivity: lastMessage?.createdAt || connection.updated_at,
          updated_at: lastMessage?.createdAt || connection.updated_at
        });
      }
      
      console.log(`✅ Processed ${directChats.length} unique direct chats for user ${userId}`);
      return directChats;
      
    } catch (error) {
      console.error('❌ Get direct chats error:', error);
      return [];
    }
  }

  // ==================== FIXED GROUP CHATS ====================
  
  async getUserGroupChats(userId) {
    try {
      console.log(`👥 Fetching group chats for user ${userId}`);
      
      // Get groups where user is a member OR admin
      const userGroups = await Group.findAll({
        where: {
          [Op.or]: [
            { admin_id: userId }, // User is admin
            { '$members.id$': userId } // User is member
          ]
        },
        include: [
          {
            model: User,
            as: 'members',
            attributes: ['id'],
            through: { attributes: [] },
            required: false
          },
          {
            model: User,
            as: 'admin',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
            required: false
          }
        ]
      });
      
      console.log(`👥 Found ${userGroups.length} groups for user ${userId}`);
      
      if (userGroups.length === 0) {
        return [];
      }
      
      const groupChats = [];
      
      for (const group of userGroups) {
        // Verify user is actually a member or admin
        const isMember = group.members?.some(member => member.id === userId);
        const isAdmin = group.admin_id === userId;
        
        if (!isMember && !isAdmin) {
          console.warn(`⚠️ User ${userId} not found in group ${group.id} members`);
          continue;
        }
        
        // Get last message in group
        const lastMessage = await Chat.findOne({
          where: {
            chat_type: 'group',
            group_id: group.id,
            is_deleted: false
          },
          include: [{
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }],
          order: [['createdAt', 'DESC']]
        });
        
        // Get unread count
        const unreadCount = await Chat.count({
          where: {
            chat_type: 'group',
            group_id: group.id,
            sender_id: { [Op.ne]: userId },
            is_read: false,
            is_deleted: false
          }
        });
        
        groupChats.push({
          type: 'group',
          id: group.id,
          name: group.name,
          title: group.name,
          avatar: group.cover_image,
          cover_image: group.cover_image,
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            message: lastMessage.message,
            message_type: lastMessage.message_type,
            sender_id: lastMessage.sender_id,
            sender: lastMessage.sender,
            createdAt: lastMessage.createdAt,
            is_read: lastMessage.is_read
          } : null,
          unreadCount,
          member_count: group.current_members,
          admin_id: group.admin_id,
          isAdmin: isAdmin,
          lastActivity: lastMessage?.createdAt || group.updated_at,
          updated_at: lastMessage?.createdAt || group.updated_at,
          createdAt: group.createdAt
        });
      }
      
      console.log(`✅ Processed ${groupChats.length} group chats for user ${userId}`);
      return groupChats;
      
    } catch (error) {
      console.error('❌ Get group chats error:', error);
      return [];
    }
  }

  // ==================== FIXED RIDE CHATS ====================
  
  async getUserRideChats(userId) {
    try {
      console.log(`🚗 Fetching ride chats for user ${userId}`);
      
      // Get rides where user is a participant OR creator
      const userRides = await Ride.findAll({
        where: {
          [Op.or]: [
            { creator_id: userId }, // User is creator
            { '$participants.id$': userId } // User is participant
          ]
        },
        include: [
          {
            model: User,
            as: 'participants',
            attributes: ['id'],
            through: { attributes: [] },
            required: false
          },
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
            required: false
          }
        ]
      });
      
      console.log(`🚗 Found ${userRides.length} rides for user ${userId}`);
      
      if (userRides.length === 0) {
        return [];
      }
      
      const rideChats = [];
      
      for (const ride of userRides) {
        // Verify user is actually a participant or creator
        const isParticipant = ride.participants?.some(participant => participant.id === userId);
        const isCreator = ride.creator_id === userId;
        
        if (!isParticipant && !isCreator) {
          console.warn(`⚠️ User ${userId} not found in ride ${ride.id} participants`);
          continue;
        }
        
        // Get last message in ride
        const lastMessage = await Chat.findOne({
          where: {
            chat_type: 'ride',
            ride_id: ride.id,
            is_deleted: false
          },
          include: [{
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }],
          order: [['createdAt', 'DESC']]
        });
        
        // Get unread count
        const unreadCount = await Chat.count({
          where: {
            chat_type: 'ride',
            ride_id: ride.id,
            sender_id: { [Op.ne]: userId },
            is_read: false,
            is_deleted: false
          }
        });
        
        rideChats.push({
          type: 'ride',
          id: ride.id,
          title: ride.title,
          name: ride.title,
          avatar: ride.cover_image,
          cover_image: ride.cover_image,
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            message: lastMessage.message,
            message_type: lastMessage.message_type,
            sender_id: lastMessage.sender_id,
            sender: lastMessage.sender,
            createdAt: lastMessage.createdAt,
            is_read: lastMessage.is_read
          } : null,
          unreadCount,
          participant_count: ride.current_participants,
          creator_id: ride.creator_id,
          isCreator: isCreator,
          lastActivity: lastMessage?.createdAt || ride.updated_at,
          updated_at: lastMessage?.createdAt || ride.updated_at,
          ride_date: ride.ride_date,
          start_location: ride.start_location,
          end_location: ride.end_location,
          status: ride.status,
          createdAt: ride.createdAt
        });
      }
      
      console.log(`✅ Processed ${rideChats.length} ride chats for user ${userId}`);
      return rideChats;
      
    } catch (error) {
      console.error('❌ Get ride chats error:', error);
      return [];
    }
  }

  // ==================== MESSAGE FEATURES ====================
  
  async handleReactToMessage(socket, data) {
    try {
      const { message_id, reaction } = data;
      const userId = socket.userId;
      
      const message = await Chat.findByPk(message_id);
      if (!message) {
        return socket.emit('reaction_error', { error: 'Message not found' });
      }
      
      // Verify access permissions
      const hasAccess = await this.verifyMessageAccess(userId, message);
      if (!hasAccess) {
        return socket.emit('reaction_error', { error: 'Access denied' });
      }
      
      // Update reactions in metadata
      let reactions = message.metadata?.reactions || {};
      
      if (reactions[reaction] && reactions[reaction].includes(userId)) {
        // Remove reaction
        reactions[reaction] = reactions[reaction].filter(id => id !== userId);
        if (reactions[reaction].length === 0) {
          delete reactions[reaction];
        }
      } else {
        // Add reaction
        if (!reactions[reaction]) reactions[reaction] = [];
        reactions[reaction].push(userId);
      }
      
      await message.update({
        metadata: { ...message.metadata, reactions }
      });
      
      // Broadcast reaction update
      const reactionData = {
        type: 'message_reaction',
        message_id,
        reactions,
        user_id: userId,
        reaction,
        timestamp: new Date()
      };
      
      await this.broadcastToMessageParticipants(message, 'reaction_update', reactionData);
      
      socket.emit('reaction_success', { message_id, reactions });
      
    } catch (error) {
      console.error('React to message error:', error);
      socket.emit('reaction_error', { error: 'Failed to react to message' });
    }
  }
  
  async handleEditMessage(socket, data) {
    try {
      const { message_id, new_message } = data;
      const userId = socket.userId;
      
      const message = await Chat.findByPk(message_id, {
        include: [{
          model: User,
          as: 'sender',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        }]
      });
      
      if (!message) {
        return socket.emit('edit_error', { error: 'Message not found' });
      }
      
      if (message.sender_id !== userId) {
        return socket.emit('edit_error', { error: 'Can only edit your own messages' });
      }
      
      // Check time limit (24 hours)
      const messageAge = Date.now() - new Date(message.createdAt).getTime();
      if (messageAge > 24 * 60 * 60 * 1000) {
        return socket.emit('edit_error', { error: 'Cannot edit messages older than 24 hours' });
      }
      
      await message.update({
        message: new_message.trim(),
        is_edited: true,
        edited_at: new Date()
      });
      
      const editData = {
        type: 'message_edited',
        message_id,
        new_message: new_message.trim(),
        edited_at: new Date(),
        sender: message.sender
      };
      
      await this.broadcastToMessageParticipants(message, 'message_edited', editData);
      
      socket.emit('edit_success', { message_id, new_message: new_message.trim() });
      
    } catch (error) {
      console.error('Edit message error:', error);
      socket.emit('edit_error', { error: 'Failed to edit message' });
    }
  }
  
  async handleDeleteMessage(socket, data) {
    try {
      const { message_id, delete_for_everyone = false } = data;
      const userId = socket.userId;
      
      const message = await Chat.findByPk(message_id);
      if (!message || message.sender_id !== userId) {
        return socket.emit('delete_error', { error: 'Cannot delete this message' });
      }
      
      // Check time limit for delete for everyone
      if (delete_for_everyone) {
        const messageAge = Date.now() - new Date(message.createdAt).getTime();
        if (messageAge > 60 * 60 * 1000) { // 1 hour
          return socket.emit('delete_error', { error: 'Can only delete for everyone within 1 hour' });
        }
      }
      
      await message.update({
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: userId,
        message: delete_for_everyone ? null : message.message
      });
      
      const deleteData = {
        type: 'message_deleted',
        message_id,
        delete_for_everyone,
        deleted_by: userId,
        deleted_at: new Date()
      };
      
      if (delete_for_everyone) {
        await this.broadcastToMessageParticipants(message, 'message_deleted', deleteData);
      } else {
        socket.emit('message_deleted', deleteData);
      }
      
      socket.emit('delete_success', { message_id, delete_for_everyone });
      
    } catch (error) {
      console.error('Delete message error:', error);
      socket.emit('delete_error', { error: 'Failed to delete message' });
    }
  }
  
  // ==================== UTILITY METHODS ====================
  
  async verifyMessageAccess(userId, message) {
    try {
      switch (message.chat_type) {
        case 'direct':
          return message.sender_id === userId || message.recipient_id === userId;
        case 'ride':
          if (message.ride_id) {
            const ride = await Ride.findByPk(message.ride_id, {
              include: [{
                model: User,
                as: 'participants',
                where: { id: userId },
                required: false
              }]
            });
            return ride && (ride.creator_id === userId || ride.participants?.some(p => p.id === userId));
          }
          return false;
        case 'group':
          if (message.group_id) {
            const group = await Group.findByPk(message.group_id, {
              include: [{
                model: User,
                as: 'members',
                where: { id: userId },
                required: false
              }]
            });
            return group && (group.admin_id === userId || group.members?.some(m => m.id === userId));
          }
          return false;
        default:
          return false;
      }
    } catch (error) {
      console.error('Access verification error:', error);
      return false;
    }
  }
  
  async broadcastToMessageParticipants(message, event, data) {
    switch (message.chat_type) {
      case 'direct':
        this.io.to(`user_${message.sender_id}`).emit(event, data);
        if (message.recipient_id) {
          this.io.to(`user_${message.recipient_id}`).emit(event, data);
        }
        break;
      case 'ride':
        if (message.ride_id) {
          this.io.to(`ride_${message.ride_id}`).emit(event, data);
        }
        break;
      case 'group':
        if (message.group_id) {
          this.io.to(`group_${message.group_id}`).emit(event, data);
        }
        break;
    }
  }
  
  // ==================== SEND INITIAL DATA ====================
  
  async sendInitialData(socket, userId) {
    try {
      console.log(`📤 Sending initial data to user ${userId}`);
      
      // Send online friends count
      const onlineFriendsCount = await this.getOnlineFriendsCount(userId);
      
      // Send unread messages count
      const totalUnread = await Chat.count({
        where: {
          [Op.or]: [
            { 
              recipient_id: userId, 
              chat_type: 'direct',
              is_read: false,
              is_deleted: false
            },
            { 
              chat_type: { [Op.in]: ['group', 'ride'] },
              sender_id: { [Op.ne]: userId },
              is_read: false,
              is_deleted: false
            }
          ]
        }
      });
      
      // Send pending friend requests count
      const pendingRequests = await UserConnection.count({
        where: {
          connected_user_id: userId,
          status: 'pending'
        }
      });
      
      // Get complete chat list
      const chatListData = await this.buildCompleteChatList(userId);
      
      const initialData = {
        online_friends_count: onlineFriendsCount,
        total_unread: totalUnread,
        pending_requests: pendingRequests,
        chat_list: chatListData,
        server_time: new Date(),
        user_id: userId
      };
      
      console.log(`📊 Initial data for user ${userId}:`, {
        chats: chatListData.length,
        unread: totalUnread,
        friends: onlineFriendsCount,
        pending: pendingRequests
      });
      
      socket.emit('initial_data', initialData);
      
      // Also emit chat_list_synced for compatibility
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
        details: error.message 
      });
    }
  }
  
  // Build complete chat list
  async buildCompleteChatList(userId) {
    try {
      console.log(`📋 Building complete chat list for user ${userId}`);
      
      const [directChats, groupChats, rideChats] = await Promise.all([
        this.getUserDirectChats(userId),
        this.getUserGroupChats(userId),
        this.getUserRideChats(userId)
      ]);
      
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
  
  async getOnlineFriendsCount(userId) {
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
    
    return friendIds.filter(friendId => 
      this.presenceCache.has(friendId) && 
      this.presenceCache.get(friendId).status === 'online'
    ).length;
  }
}

// Factory function to create the socket manager
function createSocketManager(io) {
  return new ExtendedSocketManager(io);
}

module.exports = createSocketManager;