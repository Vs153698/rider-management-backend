const { Chat, User, Ride, Group, UserConnection } = require('../models');
const { uploadToCloudinary } = require('../config/cloudinary');
const { Op } = require('sequelize');

// Create a new message (enhanced with friend validation)
const createMessage = async (messageData) => {
  const {
    message,
    message_type = 'text',
    chat_type = 'direct',
    attachment_url,
    attachment_type,
    sender_id,
    recipient_id,
    ride_id,
    group_id,
    reply_to_id,
    metadata = {}
  } = messageData;

  // Validate message data
  if (!message && message_type === 'text') {
    throw new Error('Message content required for text messages');
  }

  // Validate chat context
  if (chat_type === 'direct' && !recipient_id) {
    throw new Error('Recipient ID required for direct messages');
  }
  if (chat_type === 'ride' && !ride_id) {
    throw new Error('Ride ID required for ride messages');
  }
  if (chat_type === 'group' && !group_id) {
    throw new Error('Group ID required for group messages');
  }

  // CRITICAL: For direct messages, ensure users are friends
  if (chat_type === 'direct') {
    if (sender_id === recipient_id) {
      throw new Error('Cannot send message to yourself');
    }

    // Check if users are friends
    const areFriends = await UserConnection.areFriends(sender_id, recipient_id);
    if (!areFriends) {
      throw new Error('You can only send messages to friends. Send a friend request first.');
    }

    // Check if either user has blocked the other
    const isBlocked = await UserConnection.isBlocked(sender_id, recipient_id);
    if (isBlocked) {
      throw new Error('Cannot send message to this user');
    }
  }

  // Create the message
  const chat = await Chat.create({
    message,
    message_type,
    chat_type,
    attachment_url,
    attachment_type,
    sender_id,
    recipient_id,
    ride_id,
    group_id,
    reply_to_id,
    metadata
  });

  // Update connection last message time for direct messages
  if (chat_type === 'direct') {
    await UserConnection.update(
      { last_message_at: new Date() },
      {
        where: {
          [Op.or]: [
            { user_id: sender_id, connected_user_id: recipient_id },
            { user_id: recipient_id, connected_user_id: sender_id }
          ],
          status: 'accepted'
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

  return chatWithUsers;
};

// Get direct messages between two users (friends only)
const getDirectMessages = async (userId1, userId2, options = {}) => {
  const { page = 1, limit = 50, before_id, after_id } = options;
  const offset = (page - 1) * limit;

  // CRITICAL: Check if users are friends
  const areFriends = await UserConnection.areFriends(userId1, userId2);
  if (!areFriends) {
    throw new Error('You can only view conversations with friends');
  }

  const whereClause = {
    chat_type: 'direct',
    [Op.or]: [
      { sender_id: userId1, recipient_id: userId2 },
      { sender_id: userId2, recipient_id: userId1 }
    ],
    is_deleted: false
  };

  if (before_id) {
    whereClause.id = { [Op.lt]: before_id };
  }

  if (after_id) {
    whereClause.id = { [Op.gt]: after_id };
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ],
    limit,
    offset,
    order: [['created_at', 'DESC']]
  });

  return {
    messages: messages.rows,
    total: messages.count,
    page,
    pages: Math.ceil(messages.count / limit),
    hasMore: messages.count > offset + limit
  };
};

// Get messages for a ride
const getRideMessages = async (rideId, options = {}) => {
  const { page = 1, limit = 50, before_id, after_id } = options;
  const offset = (page - 1) * limit;

  const whereClause = {
    ride_id: rideId,
    chat_type: 'ride',
    is_deleted: false
  };

  if (before_id) {
    whereClause.id = { [Op.lt]: before_id };
  }

  if (after_id) {
    whereClause.id = { [Op.gt]: after_id };
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ],
    limit,
    offset,
    order: [['created_at', 'DESC']]
  });

  return {
    messages: messages.rows,
    total: messages.count,
    page,
    pages: Math.ceil(messages.count / limit),
    hasMore: messages.count > offset + limit
  };
};

// Get messages for a group
const getGroupMessages = async (groupId, options = {}) => {
  const { page = 1, limit = 50, before_id, after_id } = options;
  const offset = (page - 1) * limit;

  const whereClause = {
    group_id: groupId,
    chat_type: 'group',
    is_deleted: false
  };

  if (before_id) {
    whereClause.id = { [Op.lt]: before_id };
  }

  if (after_id) {
    whereClause.id = { [Op.gt]: after_id };
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ],
    limit,
    offset,
    order: [['created_at', 'DESC']]
  });

  return {
    messages: messages.rows,
    total: messages.count,
    page,
    pages: Math.ceil(messages.count / limit),
    hasMore: messages.count > offset + limit
  };
};

// Edit a message
const editMessage = async (messageId, userId, newMessage) => {
  const chat = await Chat.findByPk(messageId);

  if (!chat) {
    throw new Error('Message not found');
  }

  if (chat.sender_id !== userId) {
    throw new Error('You can only edit your own messages');
  }

  if (chat.is_deleted) {
    throw new Error('Cannot edit deleted message');
  }

  const updatedChat = await chat.update({
    message: newMessage,
    is_edited: true,
    edited_at: new Date()
  });

  return updatedChat;
};

// Delete a message (soft delete)
const deleteMessage = async (messageId, userId) => {
  const chat = await Chat.findByPk(messageId);

  if (!chat) {
    throw new Error('Message not found');
  }

  if (chat.sender_id !== userId) {
    throw new Error('You can only delete your own messages');
  }

  if (chat.is_deleted) {
    throw new Error('Message already deleted');
  }

  await chat.update({
    is_deleted: true,
    deleted_at: new Date(),
    message: null,
    attachment_url: null
  });

  return chat;
};

// DEPRECATED: Start a new conversation - users must be friends first
const startConversation = async (userId1, userId2) => {
  throw new Error('This function is deprecated. Users must be friends before starting conversations. Use friend request system instead.');
};

// Get user connections (friends for chat)
const getUserConnections = async (userId, options = {}) => {
  const { page = 1, limit = 20, search } = options;
  const offset = (page - 1) * limit;

  const whereClause = {
    [Op.or]: [
      { user_id: userId },
      { connected_user_id: userId }
    ],
    status: 'accepted', // Only accepted friends
    is_archived: false
  };

  const includeOptions = [
    {
      model: User,
      as: 'user',
      attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
      required: false
    },
    {
      model: User,
      as: 'connectedUser',
      attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
      required: false
    }
  ];

  // Add search functionality
  if (search) {
    includeOptions[0].where = {
      [Op.or]: [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } }
      ]
    };
    includeOptions[1].where = {
      [Op.or]: [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } }
      ]
    };
  }

  const connections = await UserConnection.findAndCountAll({
    where: whereClause,
    include: includeOptions,
    limit,
    offset,
    order: [['last_message_at', 'DESC']]
  });

  // Extract friend information
  const friends = connections.rows.map(conn => {
    const friend = conn.user?.id === userId ? conn.connectedUser : conn.user;
    if (!friend) return null;

    return {
      ...friend.toJSON(),
      last_message_at: conn.last_message_at,
      friendship_date: conn.accepted_at
    };
  }).filter(friend => friend);

  return {
    connections: friends,
    total: connections.count,
    page,
    pages: Math.ceil(connections.count / limit)
  };
};

// Block/Unblock user (enhanced for friend system)
const toggleBlockUser = async (userId, targetUserId, action) => {
  if (userId === targetUserId) {
    throw new Error('Cannot block yourself');
  }

  let connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: userId, connected_user_id: targetUserId },
        { user_id: targetUserId, connected_user_id: userId }
      ]
    }
  });

  if (action === 'block') {
    if (connection) {
      await connection.update({
        status: 'blocked',
        blocked_at: new Date()
      });
    } else {
      // Create new blocked connection
      connection = await UserConnection.create({
        user_id: userId,
        connected_user_id: targetUserId,
        initiated_by: userId,
        status: 'blocked',
        blocked_at: new Date()
      });
    }
    return connection;
  } else if (action === 'unblock') {
    if (!connection || connection.status !== 'blocked') {
      throw new Error('No blocked connection found');
    }
    // Remove the blocked connection entirely
    await connection.destroy();
    return null;
  } else {
    throw new Error('Invalid action. Use "block" or "unblock"');
  }
};

// Archive/Unarchive conversation (friends only)
const toggleArchiveConversation = async (userId, targetUserId, isArchived) => {
  // Check if users are friends
  const areFriends = await UserConnection.areFriends(userId, targetUserId);
  if (!areFriends) {
    throw new Error('You can only archive conversations with friends');
  }

  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: userId, connected_user_id: targetUserId },
        { user_id: targetUserId, connected_user_id: userId }
      ],
      status: 'accepted'
    }
  });

  if (!connection) {
    throw new Error('No friendship found with this user');
  }

  await connection.update({ is_archived: isArchived });
  return connection;
};

// Search messages (enhanced for friend system)
const searchMessages = async (searchOptions) => {
  const {
    query,
    chat_type,
    user_id,
    ride_id,
    group_id,
    message_type,
    sender_id,
    date_from,
    date_to,
    page = 1,
    limit = 20,
    current_user_id
  } = searchOptions;

  const offset = (page - 1) * limit;

  const whereClause = {
    is_deleted: false
  };

  if (query) {
    whereClause.message = { [Op.iLike]: `%${query}%` };
  }

  if (chat_type) whereClause.chat_type = chat_type;
  if (message_type) whereClause.message_type = message_type;
  if (sender_id) whereClause.sender_id = sender_id;

  // Handle different chat types with friend validation
  if (chat_type === 'direct' && user_id) {
    // Check if users are friends
    const areFriends = await UserConnection.areFriends(current_user_id, user_id);
    if (!areFriends) {
      throw new Error('You can only search messages with friends');
    }

    whereClause[Op.or] = [
      { sender_id: current_user_id, recipient_id: user_id },
      { sender_id: user_id, recipient_id: current_user_id }
    ];
  } else if (chat_type === 'direct') {
    // Search all direct messages with friends only
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: current_user_id },
          { connected_user_id: current_user_id }
        ],
        status: 'accepted'
      },
      attributes: ['user_id', 'connected_user_id']
    });

    const friendIds = friendConnections.map(conn => 
      conn.user_id === current_user_id ? conn.connected_user_id : conn.user_id
    );

    whereClause[Op.or] = [
      { sender_id: current_user_id, recipient_id: { [Op.in]: friendIds } },
      { sender_id: { [Op.in]: friendIds }, recipient_id: current_user_id }
    ];
  }

  if (ride_id) whereClause.ride_id = ride_id;
  if (group_id) whereClause.group_id = group_id;

  if (date_from || date_to) {
    whereClause.created_at = {};
    if (date_from) whereClause.created_at[Op.gte] = new Date(date_from);
    if (date_to) whereClause.created_at[Op.lte] = new Date(date_to);
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
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
        model: Ride,
        as: 'ride',
        attributes: ['id', 'title'],
        required: false
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name'],
        required: false
      }
    ],
    limit,
    offset,
    order: [['created_at', 'DESC']]
  });

  return {
    messages: messages.rows,
    total: messages.count,
    page,
    pages: Math.ceil(messages.count / limit)
  };
};

// Get chat statistics (enhanced for friend system)
const getChatStatistics = async (options = {}) => {
  const { chat_type, user_id, ride_id, group_id, date_from, date_to, current_user_id } = options;

  const whereClause = { is_deleted: false };
  
  if (chat_type) whereClause.chat_type = chat_type;
  if (ride_id) whereClause.ride_id = ride_id;
  if (group_id) whereClause.group_id = group_id;

  // Handle direct messages with friend validation
  if (chat_type === 'direct' && user_id) {
    // Check if users are friends
    const areFriends = await UserConnection.areFriends(current_user_id, user_id);
    if (!areFriends) {
      throw new Error('You can only view stats for conversations with friends');
    }

    whereClause[Op.or] = [
      { sender_id: current_user_id, recipient_id: user_id },
      { sender_id: user_id, recipient_id: current_user_id }
    ];
  } else if (chat_type === 'direct') {
    // Get stats for all direct messages with friends
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: current_user_id },
          { connected_user_id: current_user_id }
        ],
        status: 'accepted'
      },
      attributes: ['user_id', 'connected_user_id']
    });

    const friendIds = friendConnections.map(conn => 
      conn.user_id === current_user_id ? conn.connected_user_id : conn.user_id
    );

    whereClause[Op.or] = [
      { sender_id: current_user_id, recipient_id: { [Op.in]: friendIds } },
      { sender_id: { [Op.in]: friendIds }, recipient_id: current_user_id }
    ];
  }

  if (date_from || date_to) {
    whereClause.created_at = {};
    if (date_from) whereClause.created_at[Op.gte] = new Date(date_from);
    if (date_to) whereClause.created_at[Op.lte] = new Date(date_to);
  }

  // Total messages
  const totalMessages = await Chat.count({ where: whereClause });

  // Messages by type
  const messagesByType = await Chat.findAll({
    where: whereClause,
    attributes: [
      'message_type',
      [Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'count']
    ],
    group: ['message_type']
  });

  // Messages by chat type
  const messagesByChatType = await Chat.findAll({
    where: whereClause,
    attributes: [
      'chat_type',
      [Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'count']
    ],
    group: ['chat_type']
  });

  // Active users (users who sent messages)
  const activeUsers = await Chat.findAll({
    where: whereClause,
    attributes: [
      'sender_id',
      [Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'message_count']
    ],
    group: ['sender_id'],
    order: [[Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'DESC']],
    limit: 10,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  // Messages per day (last 7 days)
  const messagesPerDay = await Chat.findAll({
    where: {
      ...whereClause,
      created_at: {
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    },
    attributes: [
      [Chat.sequelize.fn('DATE', Chat.sequelize.col('created_at')), 'date'],
      [Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'count']
    ],
    group: [Chat.sequelize.fn('DATE', Chat.sequelize.col('created_at'))],
    order: [[Chat.sequelize.fn('DATE', Chat.sequelize.col('created_at')), 'ASC']]
  });

  return {
    total_messages: totalMessages,
    messages_by_type: messagesByType,
    messages_by_chat_type: messagesByChatType,
    active_users: activeUsers,
    messages_per_day: messagesPerDay
  };
};

// Upload attachment
const uploadAttachment = async (file, folder = 'chat-attachments') => {
  try {
    const result = await uploadToCloudinary(file, folder);
    return {
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      size: result.bytes
    };
  } catch (error) {
    throw new Error(`File upload failed: ${error.message}`);
  }
};

// Check user permissions for chat (enhanced with friend system)
const checkChatPermissions = async (userId, chatType, contextId) => {
  if (chatType === 'direct') {
    // For direct messages, check if users are friends
    const areFriends = await UserConnection.areFriends(userId, contextId);
    if (!areFriends) {
      return { hasAccess: false, reason: 'Users are not friends' };
    }

    // Check if either user has blocked the other
    const isBlocked = await UserConnection.isBlocked(userId, contextId);
    if (isBlocked) {
      return { hasAccess: false, reason: 'User is blocked' };
    }

    return { hasAccess: true, role: 'friend' };
  }

  if (chatType === 'ride') {
    const ride = await Ride.findByPk(contextId, {
      include: [
        {
          model: User,
          as: 'participants',
          where: { id: userId },
          required: false
        }
      ]
    });

    if (!ride) {
      return { hasAccess: false, reason: 'Ride not found' };
    }

    const isParticipant = ride.participants?.some(p => p.id === userId);
    const isCreator = ride.creator_id === userId;

    if (!isParticipant && !isCreator) {
      return { hasAccess: false, reason: 'Not a ride participant' };
    }

    return { hasAccess: true, role: isCreator ? 'creator' : 'participant' };
  }

  if (chatType === 'group') {
    const group = await Group.findByPk(contextId, {
      include: [
        {
          model: User,
          as: 'members',
          where: { id: userId },
          required: false
        }
      ]
    });

    if (!group) {
      return { hasAccess: false, reason: 'Group not found' };
    }

    const isMember = group.members?.some(m => m.id === userId);
    const isAdmin = group.admin_id === userId;

    if (!isMember && !isAdmin) {
      return { hasAccess: false, reason: 'Not a group member' };
    }

    return { hasAccess: true, role: isAdmin ? 'admin' : 'member' };
  }

  return { hasAccess: false, reason: 'Invalid chat context' };
};

// Get unread message count (enhanced for friend system)
const getUnreadCount = async (userId, options = {}) => {
  const { chat_type, user_id, ride_id, group_id } = options;

  const whereClause = {
    is_read: false,
    is_deleted: false
  };

  if (chat_type === 'direct') {
    whereClause.chat_type = 'direct';
    whereClause.recipient_id = userId;
    
    if (user_id) {
      // Check if users are friends
      const areFriends = await UserConnection.areFriends(userId, user_id);
      if (!areFriends) {
        throw new Error('You can only check unread count for friends');
      }
      whereClause.sender_id = user_id;
    } else {
      // Count unread messages from all friends
      const friendConnections = await UserConnection.findAll({
        where: {
          [Op.or]: [
            { user_id: userId },
            { connected_user_id: userId }
          ],
          status: 'accepted'
        },
        attributes: ['user_id', 'connected_user_id']
      });

      const friendIds = friendConnections.map(conn => 
        conn.user_id === userId ? conn.connected_user_id : conn.user_id
      );

      whereClause.sender_id = { [Op.in]: friendIds };
    }
  } else if (chat_type === 'ride') {
    whereClause.chat_type = 'ride';
    whereClause.sender_id = { [Op.ne]: userId };
    if (ride_id) {
      whereClause.ride_id = ride_id;
    }
  } else if (chat_type === 'group') {
    whereClause.chat_type = 'group';
    whereClause.sender_id = { [Op.ne]: userId };
    if (group_id) {
      whereClause.group_id = group_id;
    }
  } else {
    // Get total unread count across all chat types (friends only for direct)
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: userId },
          { connected_user_id: userId }
        ],
        status: 'accepted'
      },
      attributes: ['user_id', 'connected_user_id']
    });

    const friendIds = friendConnections.map(conn => 
      conn.user_id === userId ? conn.connected_user_id : conn.user_id
    );

    whereClause[Op.or] = [
      { chat_type: 'direct', recipient_id: userId, sender_id: { [Op.in]: friendIds } },
      { chat_type: 'ride', sender_id: { [Op.ne]: userId } },
      { chat_type: 'group', sender_id: { [Op.ne]: userId } }
    ];
  }

  const unreadCount = await Chat.count({ where: whereClause });

  return {
    unread_count: unreadCount,
    last_checked_at: new Date()
  };
};

// Mark messages as read (enhanced for friend system)
const markMessagesAsRead = async (userId, options = {}) => {
  const { message_ids, user_id, chat_type, ride_id, group_id } = options;

  let whereClause = {
    is_read: false,
    is_deleted: false
  };

  if (message_ids && Array.isArray(message_ids)) {
    whereClause.id = { [Op.in]: message_ids };
    whereClause[Op.or] = [
      { recipient_id: userId }, // Direct messages to user
      { sender_id: { [Op.ne]: userId } } // Messages not sent by user
    ];
  } else if (chat_type === 'direct' && user_id) {
    // Check if users are friends
    const areFriends = await UserConnection.areFriends(userId, user_id);
    if (!areFriends) {
      throw new Error('You can only mark messages from friends as read');
    }

    whereClause.chat_type = 'direct';
    whereClause.sender_id = user_id;
    whereClause.recipient_id = userId;
  } else if (chat_type === 'ride' && ride_id) {
    whereClause.chat_type = 'ride';
    whereClause.ride_id = ride_id;
    whereClause.sender_id = { [Op.ne]: userId };
  } else if (chat_type === 'group' && group_id) {
    whereClause.chat_type = 'group';
    whereClause.group_id = group_id;
    whereClause.sender_id = { [Op.ne]: userId };
  } else {
    throw new Error('Invalid parameters for marking messages as read');
  }

  const updateResult = await Chat.update(
    { is_read: true, read_at: new Date() },
    { where: whereClause }
  );

  return {
    success: true,
    marked_count: updateResult[0]
  };
};

module.exports = {
  createMessage,
  getDirectMessages,
  getRideMessages,
  getGroupMessages,
  startConversation, // Deprecated but kept for backward compatibility
  getUserConnections,
  toggleBlockUser,
  toggleArchiveConversation,
  editMessage,
  deleteMessage,
  searchMessages,
  getChatStatistics,
  uploadAttachment,
  checkChatPermissions,
  getUnreadCount,
  markMessagesAsRead
};