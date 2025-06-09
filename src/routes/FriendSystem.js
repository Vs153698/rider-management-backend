const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified } = require('../middleware/auth');
const {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  getFriendRequests,
  getFriendsList,
  searchFriends,
  getFriendStatus
} = require('../controllers/friendsController');
const Joi = require('joi');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Enhanced validation schemas
const friendsSchemas = {
  sendFriendRequest: Joi.object({
    user_id: Joi.string().uuid().required()
  }),

  friendRequestAction: Joi.object({
    user_id: Joi.string().uuid().required()
  }),

  getFriendRequests: Joi.object({
    type: Joi.string().valid('sent', 'received').default('received'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20)
  }),

  getFriendsList: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    search: Joi.string().min(2).max(50).optional(),
    online_only: Joi.boolean().default(false)
  }),

  searchFriends: Joi.object({
    q: Joi.string().min(2).max(50).required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(20).default(10)
  })
};

// Send friend request
router.post('/request',
  requireVerified,
  validate(friendsSchemas.sendFriendRequest),
  sendFriendRequest
);

// Accept friend request
router.post('/accept',
  requireVerified,
  validate(friendsSchemas.friendRequestAction),
  acceptFriendRequest
);

// Reject friend request
router.post('/reject',
  requireVerified,
  validate(friendsSchemas.friendRequestAction),
  rejectFriendRequest
);

// Remove friend (unfriend)
router.delete('/remove/:userId',
  requireVerified,
  removeFriend
);

// Block user
router.post('/block',
  requireVerified,
  validate(friendsSchemas.friendRequestAction),
  blockUser
);

// Unblock user
router.post('/unblock',
  requireVerified,
  validate(friendsSchemas.friendRequestAction),
  unblockUser
);

// Get friend requests (sent or received)
router.get('/requests',
  validateQuery(friendsSchemas.getFriendRequests),
  getFriendRequests
);

// Get friends list
router.get('/list',
  validateQuery(friendsSchemas.getFriendsList),
  getFriendsList
);

// Search friends
router.get('/search',
  validateQuery(friendsSchemas.searchFriends),
  searchFriends
);

// Get friendship status with specific user
router.get('/status/:userId',
  getFriendStatus
);

// Get mutual friends
router.get('/mutual/:userId',
  validateQuery(schemas.paginationQuery),
  async (req, res, next) => {
    try {
      const { userId: otherUserId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const { UserConnection, User } = require('../models');
      const { Op } = require('sequelize');
      const { getPagination, getPagingData } = require('../utils/helpers');

      const { limit: limitNum, offset } = getPagination(page - 1, limit);

      // Get current user's friends
      const currentUserFriends = await UserConnection.findAll({
        where: {
          [Op.or]: [
            { user_id: req.userId, status: 'accepted' },
            { connected_user_id: req.userId, status: 'accepted' }
          ]
        },
        attributes: ['user_id', 'connected_user_id']
      });

      // Extract friend IDs (excluding current user)
      const currentUserFriendIds = currentUserFriends.map(conn => 
        conn.user_id === req.userId ? conn.connected_user_id : conn.user_id
      );

      if (currentUserFriendIds.length === 0) {
        return res.json({
          status: 'success',
          data: {
            rows: [],
            totalItems: 0,
            totalPages: 0,
            currentPage: parseInt(page),
            hasNext: false,
            hasPrev: false
          }
        });
      }

      // Get other user's friends
      const otherUserFriends = await UserConnection.findAndCountAll({
        where: {
          [Op.or]: [
            { user_id: otherUserId, status: 'accepted' },
            { connected_user_id: otherUserId, status: 'accepted' }
          ],
          [Op.or]: [
            { user_id: { [Op.in]: currentUserFriendIds } },
            { connected_user_id: { [Op.in]: currentUserFriendIds } }
          ]
        },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
            where: { id: { [Op.in]: currentUserFriendIds } },
            required: false
          },
          {
            model: User,
            as: 'connectedUser',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
            where: { id: { [Op.in]: currentUserFriendIds } },
            required: false
          }
        ],
        limit: limitNum,
        offset,
        distinct: true
      });

      // Extract the mutual friends
      const mutualFriends = otherUserFriends.rows.map(conn => {
        if (currentUserFriendIds.includes(conn.user_id)) {
          return conn.user;
        } else {
          return conn.connectedUser;
        }
      }).filter(user => user); // Remove null values

      const response = getPagingData({ 
        rows: mutualFriends, 
        count: otherUserFriends.count 
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

// Friend suggestions (users with mutual friends or nearby)
router.get('/suggestions',
  validateQuery(schemas.paginationQuery),
  async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;
      const { UserConnection, User } = require('../models');
      const { Op } = require('sequelize');
      const { getPagination, getPagingData } = require('../utils/helpers');

      const { limit: limitNum, offset } = getPagination(page - 1, limit);

      // Get users that current user is NOT connected with
      const existingConnections = await UserConnection.findAll({
        where: {
          [Op.or]: [
            { user_id: req.userId },
            { connected_user_id: req.userId }
          ]
        },
        attributes: ['user_id', 'connected_user_id']
      });

      const connectedUserIds = existingConnections.map(conn => 
        conn.user_id === req.userId ? conn.connected_user_id : conn.user_id
      );
      connectedUserIds.push(req.userId); // Exclude self

      // Find users not in connections
      const suggestions = await User.findAndCountAll({
        where: {
          id: { [Op.notIn]: connectedUserIds },
          is_active: true,
          is_verified: true
        },
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'bio'],
        limit: limitNum,
        offset,
        order: [['created_at', 'DESC']]
      });

      const response = getPagingData(suggestions, page - 1, limitNum);

      res.json({
        status: 'success',
        data: response
      });

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;