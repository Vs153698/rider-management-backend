const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified } = require('../middleware/auth');
const { uploadConfigs, handleUploadError, cleanupTempFiles } = require('../middleware/upload');
const {
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
} = require('../controllers/chatController');
const Joi = require('joi');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Send message
router.post('/send',
  requireVerified,
  uploadConfigs.chatAttachment,
  handleUploadError,
  cleanupTempFiles,
  validate(schemas.sendMessage),
  sendMessage
);

// Get messages
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

// Search and stats
router.get('/search',
  validateQuery(schemas.searchQuery),
  searchMessages
);

router.get('/stats',
  validateQuery(Joi.object({
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional()
  }).or('ride_id', 'group_id')),
  getChatStats
);

// Read status
router.post('/mark-read',
  validate(Joi.object({
    message_ids: Joi.array().items(Joi.string().uuid()).required()
  })),
  markAsRead
);

router.get('/unread-count',
  validateQuery(Joi.object({
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional()
  })),
  getUnreadCount
);

module.exports = router;