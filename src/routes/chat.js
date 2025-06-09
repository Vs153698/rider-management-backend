const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified } = require('../middleware/auth');
const { uploadConfigs, handleUploadError, cleanupTempFiles } = require('../middleware/upload');
const {
  sendMessage,
  getDirectMessages,
  getRideMessages,
  getGroupMessages,
  startConversation,
  toggleBlockUser,
  toggleArchiveConversation,
  editMessage,
  deleteMessage,
  getMessageById,
  searchMessages,
  getChatStats,
  markAsRead,
  getUnreadCount,
  getChatList,
  getUserConnections
} = require('../controllers/chatController');
const Joi = require('joi');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Enhanced validation schemas
const enhancedSchemas = {
  sendMessage: Joi.object({
    message: Joi.string().max(2000).when('message_type', {
      is: 'text',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    message_type: Joi.string().valid('text', 'image', 'location', 'file', 'voice').default('text'),
    chat_type: Joi.string().valid('direct', 'ride', 'group').default('direct'),
    recipient_id: Joi.string().uuid().when('chat_type', {
      is: 'direct',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    ride_id: Joi.string().uuid().when('chat_type', {
      is: 'ride',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    group_id: Joi.string().uuid().when('chat_type', {
      is: 'group',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    reply_to_id: Joi.string().uuid().optional(),
    metadata: Joi.object().default({})
  }),
  
  // NOTE: startConversation is now deprecated - users must be friends first
  startConversation: Joi.object({
    user_id: Joi.string().uuid().required()
  }).messages({
    'any.unknown': 'This endpoint is deprecated. Users must be friends before starting conversations. Use /friends/request to send friend requests.'
  }),

  toggleBlock: Joi.object({
    action: Joi.string().valid('block', 'unblock').required()
  }),

  toggleArchive: Joi.object({
    is_archived: Joi.boolean().required()
  }),

  searchQuery: Joi.object({
    q: Joi.string().min(2).max(100).required(),
    chat_type: Joi.string().valid('direct', 'ride', 'group').optional(),
    user_id: Joi.string().uuid().optional(),
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional(),
    message_type: Joi.string().valid('text', 'image', 'location', 'file', 'voice').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  }),

  markAsRead: Joi.object({
    message_ids: Joi.array().items(Joi.string().uuid()).optional(),
    user_id: Joi.string().uuid().optional(),
    chat_type: Joi.string().valid('direct', 'ride', 'group').optional()
  }).or('message_ids', 'user_id'),

  unreadCount: Joi.object({
    chat_type: Joi.string().valid('direct', 'ride', 'group').optional(),
    user_id: Joi.string().uuid().optional(),
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional()
  }),

  chatStats: Joi.object({
    chat_type: Joi.string().valid('direct', 'ride', 'group').optional(),
    user_id: Joi.string().uuid().optional(),
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional()
  }),

  getChatList: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    type: Joi.string().valid('direct', 'ride', 'group').optional()
  }),

  getUserConnections: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    status: Joi.string().valid('active', 'blocked', 'muted').default('active'),
    search: Joi.string().min(2).max(50).optional()
  })
};

// Chat list and connections (only shows friends)
router.get('/list',
  validateQuery(enhancedSchemas.getChatList),
  getChatList
);

router.get('/connections',
  validateQuery(enhancedSchemas.getUserConnections),
  getUserConnections
);

// DEPRECATED: Start new conversation - users must be friends first
router.post('/start-conversation',
  requireVerified,
  validate(enhancedSchemas.startConversation),
  (req, res, next) => {
    return res.status(400).json({
      status: 'error',
      message: 'This endpoint is deprecated. Users must be friends before starting conversations.',
      hint: 'Use /api/friends/request to send friend requests, then chat with friends directly.'
    });
  }
);

// Send message (enhanced for all chat types with friend validation)
router.post('/send',
  requireVerified,
  uploadConfigs.chatAttachment,
  handleUploadError,
  cleanupTempFiles,
  validate(enhancedSchemas.sendMessage),
  sendMessage
);

// Get messages by chat type
router.get('/direct/:userId/messages',
  validateQuery(schemas.paginationQuery),
  getDirectMessages
);

router.get('/ride/:rideId/messages',
  validateQuery(schemas.paginationQuery),
  getRideMessages
);

router.get('/group/:groupId/messages',
  validateQuery(schemas.paginationQuery),
  getGroupMessages
);

// Message operations
router.get('/message/:messageId', getMessageById);

router.put('/message/:messageId',
  validate(Joi.object({
    message: Joi.string().max(2000).required()
  })),
  editMessage
);

router.delete('/message/:messageId', deleteMessage);

// User management (enhanced for friends only)
router.post('/user/:user_id/block',
  validate(enhancedSchemas.toggleBlock),
  toggleBlockUser
);

router.post('/user/:user_id/archive',
  validate(enhancedSchemas.toggleArchive),
  toggleArchiveConversation
);

// Search and stats
router.get('/search',
  validateQuery(enhancedSchemas.searchQuery),
  searchMessages
);

router.get('/stats',
  validateQuery(enhancedSchemas.chatStats),
  getChatStats
);

// Read status
router.post('/mark-read',
  validate(enhancedSchemas.markAsRead),
  markAsRead
);

router.get('/unread-count',
  validateQuery(enhancedSchemas.unreadCount),
  getUnreadCount
);

// Get conversation info (friends only)
router.get('/conversation/:userId/info',
  async (req, res, next) => {
    try {
      const { userId: otherUserId } = req.params;
      const { UserConnection, User } = require('../models');

      // Check if users are friends
      const areFriends = await UserConnection.areFriends(req.userId, otherUserId);
      if (!areFriends) {
        return res.status(403).json({
          status: 'error',
          message: 'You can only view conversations with friends',
          hint: 'Send a friend request first to start chatting'
        });
      }

      const connection = await UserConnection.findOne({
        where: {
          user_id: req.userId,
          connected_user_id: otherUserId,
          status: 'accepted'
        },
        include: [{
          model: User,
          as: 'connectedUser',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active']
        }]
      });

      if (!connection) {
        return res.status(404).json({
          status: 'error',
          message: 'No conversation found'
        });
      }

      res.json({
        status: 'success',
        data: {
          connection,
          conversation_id: require('../models').Chat.getDirectConversationId(req.userId, otherUserId)
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Search friends to chat with (replaces general user search for chat)
router.get('/friends/search',
  validateQuery(Joi.object({
    q: Joi.string().min(2).max(50).required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(20).default(10)
  })),
  async (req, res, next) => {
    try {
      const { q, page = 1, limit = 10 } = req.query;
      const { User, UserConnection } = require('../models');
      const { Op } = require('sequelize');
      const { getPagination, getPagingData } = require('../utils/helpers');

      const { limit: limitNum, offset } = getPagination(page - 1, limit);

      // Search only among friends
      const friends = await UserConnection.findAndCountAll({
        where: {
          [Op.or]: [
            { user_id: req.userId },
            { connected_user_id: req.userId }
          ],
          status: 'accepted'
        },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
            where: {
              [Op.and]: [
                { id: { [Op.ne]: req.userId } },
                {
                  [Op.or]: [
                    { first_name: { [Op.iLike]: `%${q}%` } },
                    { last_name: { [Op.iLike]: `%${q}%` } }
                  ]
                }
              ]
            },
            required: false
          },
          {
            model: User,
            as: 'connectedUser',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
            where: {
              [Op.and]: [
                { id: { [Op.ne]: req.userId } },
                {
                  [Op.or]: [
                    { first_name: { [Op.iLike]: `%${q}%` } },
                    { last_name: { [Op.iLike]: `%${q}%` } }
                  ]
                }
              ]
            },
            required: false
          }
        ],
        limit: limitNum,
        offset
      });

      // Extract friend data
      const friendsData = friends.rows.map(conn => {
        const friend = conn.user?.id === req.userId ? conn.connectedUser : conn.user;
        if (!friend) return null;

        return {
          ...friend.toJSON(),
          connection_status: 'accepted',
          last_message_at: conn.last_message_at
        };
      }).filter(friend => friend);

      const response = getPagingData({ 
        rows: friendsData, 
        count: friends.count 
      }, page - 1, limitNum);

      res.json({
        status: 'success',
        data: response
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get chat preview (friends only for direct chats)
router.get('/preview/:chatType/:chatId',
  async (req, res, next) => {
    try {
      const { chatType, chatId } = req.params;
      const { Chat, User, UserConnection } = require('../models');
      const { Op } = require('sequelize');

      let whereClause = {
        is_deleted: false
      };

      if (chatType === 'direct') {
        // Check if users are friends first
        const areFriends = await UserConnection.areFriends(req.userId, chatId);
        if (!areFriends) {
          return res.status(403).json({
            status: 'error',
            message: 'You can only view conversations with friends'
          });
        }

        whereClause.chat_type = 'direct';
        whereClause[Op.or] = [
          { sender_id: req.userId, recipient_id: chatId },
          { sender_id: chatId, recipient_id: req.userId }
        ];
      } else if (chatType === 'ride') {
        whereClause.chat_type = 'ride';
        whereClause.ride_id = chatId;
      } else if (chatType === 'group') {
        whereClause.chat_type = 'group';
        whereClause.group_id = chatId;
      }

      const lastMessage = await Chat.findOne({
        where: whereClause,
        include: [{
          model: User,
          as: 'sender',
          attributes: ['id', 'first_name', 'last_name']
        }],
        order: [['created_at', 'DESC']]
      });

      const messageCount = await Chat.count({ where: whereClause });

      const unreadCount = chatType === 'direct' 
        ? await Chat.count({
            where: {
              ...whereClause,
              sender_id: chatId,
              recipient_id: req.userId,
              is_read: false
            }
          })
        : await Chat.count({
            where: {
              ...whereClause,
              sender_id: { [Op.ne]: req.userId },
              is_read: false
            }
          });

      res.json({
        status: 'success',
        data: {
          chat_type: chatType,
          chat_id: chatId,
          last_message: lastMessage,
          total_messages: messageCount,
          unread_count: unreadCount
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;