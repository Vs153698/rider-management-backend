const { Chat, User, Ride, Group } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { uploadToCloudinary } = require('../config/cloudinary');
const { getPagination, getPagingData } = require('../utils/helpers');
const { Op } = require('sequelize');

// Send message
const sendMessage = catchAsync(async (req, res, next) => {
  const {
    message,
    message_type = 'text',
    ride_id,
    group_id,
    reply_to_id,
    metadata = {}
  } = req.body;

  // Validate message data
  if (!message && message_type === 'text') {
    return next(new AppError('Message content required', 400));
  }

  if (!ride_id && !group_id) {
    return next(new AppError('Ride ID or Group ID required', 400));
  }

  // Handle file upload for attachments
  let attachment_url = null;
  let attachment_type = null;

  if (req.file) {
    const result = await uploadToCloudinary(req.file, 'chat-attachments');
    attachment_url = result.secure_url;
    attachment_type = req.file.mimetype;
  }

  // Create chat message
  const chat = await Chat.create({
    message,
    message_type,
    attachment_url,
    attachment_type,
    sender_id: req.userId,
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

  res.status(201).json({
    status: 'success',
    message: 'Message sent successfully',
    data: {
      chat: chatWithSender
    }
  });
});

// Get ride messages
const getRideMessages = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  // Check if user is participant or creator
  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'participants',
        where: { id: req.userId },
        required: false
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  const isParticipant = ride.participants?.some(p => p.id === req.userId);
  const isCreator = ride.creator_id === req.userId;

  if (!isParticipant && !isCreator) {
    return next(new AppError('Access denied to ride messages', 403));
  }

  const messages = await Chat.findAndCountAll({
    where: {
      ride_id: rideId,
      is_deleted: false
    },
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
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(messages, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get group messages
const getGroupMessages = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  // Check if user is member or admin
  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'members',
        where: { id: req.userId },
        required: false
      }
    ]
  });

  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  const isMember = group.members?.some(m => m.id === req.userId);
  const isAdmin = group.admin_id === req.userId;

  if (!isMember && !isAdmin) {
    return next(new AppError('Access denied to group messages', 403));
  }

  const messages = await Chat.findAndCountAll({
    where: {
      group_id: groupId,
      is_deleted: false
    },
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
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(messages, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Edit message
const editMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const { message } = req.body;

  const chat = await Chat.findByPk(messageId);

  if (!chat) {
    return next(new AppError('Message not found', 404));
  }

  if (!chat.canEdit(req.userId)) {
    return next(new AppError('Cannot edit this message', 403));
  }

  const updatedChat = await chat.update({
    message,
    is_edited: true,
    edited_at: new Date()
  });

  res.status(200).json({
    status: 'success',
    message: 'Message updated successfully',
    data: {
      chat: updatedChat
    }
  });
});

// Delete message
const deleteMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;

  const chat = await Chat.findByPk(messageId);

  if (!chat) {
    return next(new AppError('Message not found', 404));
  }

  if (!chat.canDelete(req.userId)) {
    return next(new AppError('Cannot delete this message', 403));
  }

  chat.softDelete();
  await chat.save();

  res.status(200).json({
    status: 'success',
    message: 'Message deleted successfully'
  });
});

// Get message by ID
const getMessageById = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;

  const chat = await Chat.findByPk(messageId, {
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
    ]
  });

  if (!chat) {
    return next(new AppError('Message not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      chat
    }
  });
});

// Search messages
const searchMessages = catchAsync(async (req, res, next) => {
  const { q, ride_id, group_id, message_type, page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  if (!q || q.length < 2) {
    return next(new AppError('Search query must be at least 2 characters', 400));
  }

  const whereClause = {
    message: { [Op.iLike]: `%${q}%` },
    is_deleted: false
  };

  if (ride_id) whereClause.ride_id = ride_id;
  if (group_id) whereClause.group_id = group_id;
  if (message_type) whereClause.message_type = message_type;

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
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(messages, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get chat statistics
const getChatStats = catchAsync(async (req, res, next) => {
  const { ride_id, group_id } = req.query;

  const whereClause = { is_deleted: false };
  if (ride_id) whereClause.ride_id = ride_id;
  if (group_id) whereClause.group_id = group_id;

  const stats = await Chat.findAll({
    where: whereClause,
    attributes: [
      'message_type',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count']
    ],
    group: ['message_type']
  });

  const totalMessages = await Chat.count({ where: whereClause });

  const activeUsers = await Chat.findAll({
    where: {
      ...whereClause,
      created_at: {
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      }
    },
    attributes: [
      'sender_id',
      [sequelize.fn('COUNT', sequelize.col('id')), 'message_count']
    ],
    group: ['sender_id'],
    order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
    limit: 10,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  res.status(200).json({
    status: 'success',
    data: {
      total_messages: totalMessages,
      message_types: stats,
      active_users: activeUsers
    }
  });
});

// Mark messages as read
const markAsRead = catchAsync(async (req, res, next) => {
  const { message_ids } = req.body;

  if (!message_ids || !Array.isArray(message_ids)) {
    return next(new AppError('Message IDs array required', 400));
  }

  // This would typically update a separate 'message_reads' table
  // For now, we'll just return success
  // In a real implementation, you'd track read status per user

  res.status(200).json({
    status: 'success',
    message: 'Messages marked as read',
    data: {
      marked_count: message_ids.length
    }
  });
});

// Get unread message count
const getUnreadCount = catchAsync(async (req, res, next) => {
  const { ride_id, group_id } = req.query;

  // This would typically query a 'message_reads' table
  // For now, we'll return a placeholder response
  // In a real implementation, you'd track read status per user

  const unreadCount = 0; // Placeholder

  res.status(200).json({
    status: 'success',
    data: {
      unread_count: unreadCount,
      ride_id,
      group_id
    }
  });
});

module.exports = {
  sendMessage,
  getRideMessages,
  getGroupMessages,
  editMessage,
  deleteMessage,
  getMessageById,
  searchMessages,
  getChatStats,
  markAsRead,
  getUnreadCount
};