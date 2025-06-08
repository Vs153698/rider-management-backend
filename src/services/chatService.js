const { Chat, User, Ride, Group } = require('../models');
const { uploadToCloudinary } = require('../config/cloudinary');
const { Op } = require('sequelize');

// Create a new message
const createMessage = async (messageData) => {
  const {
    message,
    message_type = 'text',
    attachment_url,
    attachment_type,
    sender_id,
    ride_id,
    group_id,
    reply_to_id,
    metadata = {}
  } = messageData;

  // Validate message data
  if (!message && message_type === 'text') {
    throw new Error('Message content required for text messages');
  }

  if (!ride_id && !group_id) {
    throw new Error('Either ride_id or group_id is required');
  }

  // Create the message
  const chat = await Chat.create({
    message,
    message_type,
    attachment_url,
    attachment_type,
    sender_id,
    ride_id,
    group_id,
    reply_to_id,
    metadata
  });

  // Include sender information
  const chatWithSender = await Chat.findByPk(chat.id, {
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  return chatWithSender;
};

// Get messages for a ride
const getRideMessages = async (rideId, options = {}) => {
  const { page = 1, limit = 50, before_id, after_id } = options;
  const offset = (page - 1) * limit;

  const whereClause = {
    ride_id: rideId,
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

// Search messages
const searchMessages = async (searchOptions) => {
  const {
    query,
    ride_id,
    group_id,
    message_type,
    sender_id,
    date_from,
    date_to,
    page = 1,
    limit = 20
  } = searchOptions;

  const offset = (page - 1) * limit;

  const whereClause = {
    is_deleted: false
  };

  if (query) {
    whereClause.message = { [Op.iLike]: `%${query}%` };
  }

  if (ride_id) whereClause.ride_id = ride_id;
  if (group_id) whereClause.group_id = group_id;
  if (message_type) whereClause.message_type = message_type;
  if (sender_id) whereClause.sender_id = sender_id;

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

// Get chat statistics
const getChatStatistics = async (options = {}) => {
  const { ride_id, group_id, date_from, date_to } = options;

  const whereClause = { is_deleted: false };
  
  if (ride_id) whereClause.ride_id = ride_id;
  if (group_id) whereClause.group_id = group_id;

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

// Check user permissions for chat
const checkChatPermissions = async (userId, rideId = null, groupId = null) => {
  if (rideId) {
    const ride = await Ride.findByPk(rideId, {
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

  if (groupId) {
    const group = await Group.findByPk(groupId, {
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

// Get unread message count (placeholder - would need read tracking table)
const getUnreadCount = async (userId, rideId = null, groupId = null) => {
  // This is a placeholder implementation
  // In a real app, you'd have a separate table tracking read status
  return {
    unread_count: 0,
    last_read_at: new Date()
  };
};

// Mark messages as read (placeholder - would need read tracking table)
const markMessagesAsRead = async (userId, messageIds) => {
  // This is a placeholder implementation
  // In a real app, you'd update a separate read tracking table
  return {
    success: true,
    marked_count: messageIds.length
  };
};

module.exports = {
  createMessage,
  getRideMessages,
  getGroupMessages,
  editMessage,
  deleteMessage,
  searchMessages,
  getChatStatistics,
  uploadAttachment,
  checkChatPermissions,
  getUnreadCount,
  markMessagesAsRead
};