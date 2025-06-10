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
  getUserConnections,
  getOnlineFriends,
  reactToMessage
} = require('../controllers/chatController');
const Joi = require('joi');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Input sanitization function
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>]/g, ''); // Basic XSS prevention
};

// Parameter validation middleware
const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params);
    if (error) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid parameters',
        details: error.details[0].message
      });
    }
    req.params = value;
    next();
  };
};

// Enhanced validation schemas
const enhancedSchemas = {
  // Message sending validation
  sendMessage: Joi.object({
    message: Joi.string().max(2000).custom((value, helpers) => {
      return sanitizeString(value);
    }).when('message_type', {
      is: 'text',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    message_type: Joi.string().valid('text', 'image', 'location', 'file', 'voice').default('text'),
    chat_type: Joi.string().valid('direct', 'ride', 'group').default('direct'),
    recipient_id: Joi.string().uuid().when('chat_type', {
      is: 'direct',
      then: Joi.required().messages({
        'any.required': 'Recipient ID is required for direct messages',
        'string.guid': 'Recipient ID must be a valid UUID'
      }),
      otherwise: Joi.forbidden().messages({
        'any.unknown': 'Recipient ID is only allowed for direct messages'
      })
    }),
    ride_id: Joi.string().uuid().when('chat_type', {
      is: 'ride',
      then: Joi.required().messages({
        'any.required': 'Ride ID is required for ride messages',
        'string.guid': 'Ride ID must be a valid UUID'
      }),
      otherwise: Joi.forbidden().messages({
        'any.unknown': 'Ride ID is only allowed for ride messages'
      })
    }),
    group_id: Joi.string().uuid().when('chat_type', {
      is: 'group',
      then: Joi.required().messages({
        'any.required': 'Group ID is required for group messages',
        'string.guid': 'Group ID must be a valid UUID'
      }),
      otherwise: Joi.forbidden().messages({
        'any.unknown': 'Group ID is only allowed for group messages'
      })
    }),
    reply_to_id: Joi.string().uuid().optional(),
    metadata: Joi.object().default({})
  }),

  // Message fetching validation (enhanced for ChatDetailScreen)
  getDirectMessages: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    before_message_id: Joi.string().uuid().optional().messages({
      'string.guid': 'before_message_id must be a valid UUID'
    }),
    after_message_id: Joi.string().uuid().optional().messages({
      'string.guid': 'after_message_id must be a valid UUID'
    })
  }),

  getRideMessages: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    before_message_id: Joi.string().uuid().optional().messages({
      'string.guid': 'before_message_id must be a valid UUID'
    }),
    after_message_id: Joi.string().uuid().optional().messages({
      'string.guid': 'after_message_id must be a valid UUID'
    })
  }),

  getGroupMessages: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    before_message_id: Joi.string().uuid().optional().messages({
      'string.guid': 'before_message_id must be a valid UUID'
    }),
    after_message_id: Joi.string().uuid().optional().messages({
      'string.guid': 'after_message_id must be a valid UUID'
    })
  }),

  // Parameter validation schemas
  userIdParam: Joi.object({
    userId: Joi.string().uuid().required().messages({
      'string.guid': 'User ID must be a valid UUID',
      'any.required': 'User ID is required'
    })
  }),

  rideIdParam: Joi.object({
    rideId: Joi.string().uuid().required().messages({
      'string.guid': 'Ride ID must be a valid UUID',
      'any.required': 'Ride ID is required'
    })
  }),

  groupIdParam: Joi.object({
    groupId: Joi.string().uuid().required().messages({
      'string.guid': 'Group ID must be a valid UUID',
      'any.required': 'Group ID is required'
    })
  }),

  messageIdParam: Joi.object({
    messageId: Joi.string().uuid().required().messages({
      'string.guid': 'Message ID must be a valid UUID',
      'any.required': 'Message ID is required'
    })
  }),

  chatPreviewParams: Joi.object({
    chatType: Joi.string().valid('direct', 'ride', 'group').required().messages({
      'any.only': 'Chat type must be one of: direct, ride, group',
      'any.required': 'Chat type is required'
    }),
    chatId: Joi.string().uuid().required().messages({
      'string.guid': 'Chat ID must be a valid UUID',
      'any.required': 'Chat ID is required'
    })
  }),

  // Other validation schemas
  startConversation: Joi.object({
    user_id: Joi.string().uuid().required(),
    initial_message: Joi.string().max(2000).optional().custom((value, helpers) => {
      return sanitizeString(value);
    })
  }).messages({
    'any.unknown': 'This endpoint is deprecated. Users must be friends before starting conversations. Use /friends/request to send friend requests.'
  }),

  toggleBlock: Joi.object({
    action: Joi.string().valid('block', 'unblock').required().messages({
      'any.only': 'Action must be either "block" or "unblock"',
      'any.required': 'Action is required'
    })
  }),

  toggleArchive: Joi.object({
    is_archived: Joi.boolean().required().messages({
      'any.required': 'is_archived field is required',
      'boolean.base': 'is_archived must be a boolean value'
    })
  }),

  editMessage: Joi.object({
    message: Joi.string().max(2000).required().custom((value, helpers) => {
      const sanitized = sanitizeString(value);
      if (!sanitized.trim()) {
        return helpers.error('string.empty');
      }
      return sanitized;
    }).messages({
      'string.empty': 'Message cannot be empty',
      'any.required': 'Message content is required'
    })
  }),

  deleteMessage: Joi.object({
    delete_for_everyone: Joi.boolean().default(false)
  }),

  searchQuery: Joi.object({
    q: Joi.string().min(2).max(100).required().custom((value, helpers) => {
      return sanitizeString(value);
    }).messages({
      'string.min': 'Search query must be at least 2 characters',
      'string.max': 'Search query cannot exceed 100 characters',
      'any.required': 'Search query is required'
    }),
    chat_type: Joi.string().valid('direct', 'ride', 'group').optional(),
    user_id: Joi.string().uuid().optional(),
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional(),
    message_type: Joi.string().valid('text', 'image', 'location', 'file', 'voice').optional(),
    date_from: Joi.date().iso().optional(),
    date_to: Joi.date().iso().min(Joi.ref('date_from')).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  }),

  markAsRead: Joi.object({
    message_ids: Joi.array().items(Joi.string().uuid()).optional(),
    user_id: Joi.string().uuid().optional(),
    chat_type: Joi.string().valid('direct', 'ride', 'group').optional(),
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional()
  }).or('message_ids', 'user_id').messages({
    'object.missing': 'Either message_ids or user_id must be provided'
  }),

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
    group_id: Joi.string().uuid().optional(),
    days: Joi.number().integer().min(1).max(365).default(30)
  }),

  getChatList: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    type: Joi.string().valid('direct', 'ride', 'group').optional()
  }),

  getUserConnections: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    status: Joi.string().valid('accepted', 'blocked', 'pending').default('accepted'),
    search: Joi.string().min(2).max(50).optional().custom((value, helpers) => {
      return sanitizeString(value);
    })
  }),

  friendsSearch: Joi.object({
    q: Joi.string().min(2).max(50).required().custom((value, helpers) => {
      return sanitizeString(value);
    }),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(20).default(10)
  }),

  reactToMessage: Joi.object({
    reaction: Joi.string().pattern(/^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+$/u)
      .required().messages({
        'string.pattern.base': 'Reaction must be a valid emoji',
        'any.required': 'Reaction is required'
      })
  }),

  getOnlineFriends: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(50)
  })
};

// Rate limiting middleware (simple implementation)
const rateLimit = (maxRequests = 100, windowMs = 60000) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const key = req.userId || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!requests.has(key)) {
      requests.set(key, []);
    }
    
    const userRequests = requests.get(key);
    // Remove old requests
    const recentRequests = userRequests.filter(time => time > windowStart);
    
    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please try again later.',
        retry_after: Math.ceil(windowMs / 1000)
      });
    }
    
    recentRequests.push(now);
    requests.set(key, recentRequests);
    next();
  };
};

// Chat list and connections (only shows friends)
router.get('/list',
  rateLimit(50, 60000), // 50 requests per minute
  validateQuery(enhancedSchemas.getChatList),
  getChatList
);

router.get('/connections',
  rateLimit(30, 60000), // 30 requests per minute
  validateQuery(enhancedSchemas.getUserConnections),
  getUserConnections
);

router.get('/friends/online',
  rateLimit(20, 60000), // 20 requests per minute
  validateQuery(enhancedSchemas.getOnlineFriends),
  getOnlineFriends
);

// DEPRECATED: Start new conversation - users must be friends first
router.post('/start-conversation',
  requireVerified,
  rateLimit(10, 60000), // 10 requests per minute
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
  rateLimit(60, 60000), // 60 messages per minute
  uploadConfigs.chatAttachment,
  handleUploadError,
  cleanupTempFiles,
  validate(enhancedSchemas.sendMessage),
  sendMessage
);

// Get messages by chat type (FIXED with proper validation)
router.get('/direct/:userId/messages',
  rateLimit(100, 60000), // 100 requests per minute
  validateParams(enhancedSchemas.userIdParam),
  validateQuery(enhancedSchemas.getDirectMessages),
  getDirectMessages
);

router.get('/ride/:rideId/messages',
  rateLimit(100, 60000),
  validateParams(enhancedSchemas.rideIdParam),
  validateQuery(enhancedSchemas.getRideMessages),
  getRideMessages
);

router.get('/group/:groupId/messages',
  rateLimit(100, 60000),
  validateParams(enhancedSchemas.groupIdParam),
  validateQuery(enhancedSchemas.getGroupMessages),
  getGroupMessages
);

// Message operations
router.get('/message/:messageId',
  rateLimit(50, 60000),
  validateParams(enhancedSchemas.messageIdParam),
  getMessageById
);

router.put('/message/:messageId',
  requireVerified,
  rateLimit(20, 60000), // 20 edits per minute
  validateParams(enhancedSchemas.messageIdParam),
  validate(enhancedSchemas.editMessage),
  editMessage
);

router.delete('/message/:messageId',
  requireVerified,
  rateLimit(20, 60000), // 20 deletes per minute
  validateParams(enhancedSchemas.messageIdParam),
  validate(enhancedSchemas.deleteMessage),
  deleteMessage
);

// Message reactions
router.post('/message/:messageId/react',
  requireVerified,
  rateLimit(30, 60000), // 30 reactions per minute
  validateParams(enhancedSchemas.messageIdParam),
  validate(enhancedSchemas.reactToMessage),
  reactToMessage
);

// User management (enhanced for friends only)
router.post('/user/:user_id/block',
  requireVerified,
  rateLimit(10, 60000), // 10 block actions per minute
  validateParams(Joi.object({
    user_id: Joi.string().uuid().required().messages({
      'string.guid': 'User ID must be a valid UUID',
      'any.required': 'User ID is required'
    })
  })),
  validate(enhancedSchemas.toggleBlock),
  toggleBlockUser
);

router.post('/user/:user_id/archive',
  requireVerified,
  rateLimit(20, 60000), // 20 archive actions per minute
  validateParams(Joi.object({
    user_id: Joi.string().uuid().required().messages({
      'string.guid': 'User ID must be a valid UUID',
      'any.required': 'User ID is required'
    })
  })),
  validate(enhancedSchemas.toggleArchive),
  toggleArchiveConversation
);

// Search and stats
router.get('/search',
  rateLimit(30, 60000), // 30 searches per minute
  validateQuery(enhancedSchemas.searchQuery),
  searchMessages
);

router.get('/stats',
  rateLimit(20, 60000), // 20 stats requests per minute
  validateQuery(enhancedSchemas.chatStats),
  getChatStats
);

// Read status
router.post('/mark-read',
  requireVerified,
  rateLimit(50, 60000), // 50 mark-read actions per minute
  validate(enhancedSchemas.markAsRead),
  markAsRead
);

router.get('/unread-count',
  rateLimit(30, 60000), // 30 unread count checks per minute
  validateQuery(enhancedSchemas.unreadCount),
  getUnreadCount
);

// Get conversation info (friends only)
router.get('/conversation/:userId/info',
  rateLimit(20, 60000), // 20 conversation info requests per minute
  validateParams(enhancedSchemas.userIdParam),
  async (req, res, next) => {
    try {
      const { userId: otherUserId } = req.params;
      const { UserConnection, User, Chat } = require('../models');

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
          [require('sequelize').Op.or]: [
            { user_id: req.userId, connected_user_id: otherUserId },
            { user_id: otherUserId, connected_user_id: req.userId }
          ],
          status: 'accepted'
        },
        include: [{
          model: User,
          as: req.userId === connection?.user_id ? 'connectedUser' : 'user',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active']
        }]
      });

      if (!connection) {
        return res.status(404).json({
          status: 'error',
          message: 'No conversation found'
        });
      }

      // Get conversation ID
      const conversationId = Chat.getDirectConversationId 
        ? Chat.getDirectConversationId(req.userId, otherUserId)
        : `${Math.min(req.userId, otherUserId)}-${Math.max(req.userId, otherUserId)}`;

      res.json({
        status: 'success',
        data: {
          connection,
          conversation_id: conversationId,
          other_user: connection.user?.id === req.userId ? connection.connectedUser : connection.user
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Search friends to chat with (replaces general user search for chat)
router.get('/friends/search',
  rateLimit(20, 60000), // 20 friend searches per minute
  validateQuery(enhancedSchemas.friendsSearch),
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
  rateLimit(30, 60000), // 30 preview requests per minute
  validateParams(enhancedSchemas.chatPreviewParams),
  async (req, res, next) => {
    try {
      const { chatType, chatId } = req.params;
      const { Chat, User, UserConnection, Ride, Group } = require('../models');
      const { Op } = require('sequelize');

      let whereClause = {
        is_deleted: false
      };

      // Validate access based on chat type
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
        // Verify ride access
        const ride = await Ride.findByPk(chatId, {
          include: [{
            model: User,
            as: 'participants',
            where: { id: req.userId },
            required: false
          }]
        });

        if (!ride) {
          return res.status(404).json({
            status: 'error',
            message: 'Ride not found'
          });
        }

        const isParticipant = ride.participants?.some(p => p.id === req.userId);
        const isCreator = ride.creator_id === req.userId;

        if (!isParticipant && !isCreator) {
          return res.status(403).json({
            status: 'error',
            message: 'Access denied to ride chat'
          });
        }

        whereClause.chat_type = 'ride';
        whereClause.ride_id = chatId;
      } else if (chatType === 'group') {
        // Verify group access
        const group = await Group.findByPk(chatId, {
          include: [{
            model: User,
            as: 'members',
            where: { id: req.userId },
            required: false
          }]
        });

        if (!group) {
          return res.status(404).json({
            status: 'error',
            message: 'Group not found'
          });
        }

        const isMember = group.members?.some(m => m.id === req.userId);
        const isAdmin = group.admin_id === req.userId;

        if (!isMember && !isAdmin) {
          return res.status(403).json({
            status: 'error',
            message: 'Access denied to group chat'
          });
        }

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

// Error handling middleware
router.use((error, req, res, next) => {
  console.error('Chat route error:', error);
  
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      details: error.message
    });
  }
  
  if (error.name === 'SequelizeValidationError') {
    return res.status(400).json({
      status: 'error',
      message: 'Database validation failed',
      details: error.errors.map(e => e.message)
    });
  }
  
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
});

module.exports = router;