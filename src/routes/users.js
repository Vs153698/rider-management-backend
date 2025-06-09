const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified } = require('../middleware/auth');
const { uploadConfigs, handleUploadError, cleanupTempFiles } = require('../middleware/upload');
const {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  uploadCoverPicture,
  getUserById,
  searchUsers,
  getUserRides,
  getUserGroups,
  getUserRentals,
  deactivateAccount,
  deleteAccount
} = require('../controllers/userController');
const Joi = require('joi');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Enhanced validation schemas
const userSchemas = {
  updateProfile: Joi.object({
    first_name: Joi.string().min(2).max(50).optional(),
    last_name: Joi.string().min(2).max(50).optional(),
    email: Joi.string().email().optional(),
    bio: Joi.string().max(500).optional(),
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90).optional(),
      longitude: Joi.number().min(-180).max(180).optional(),
      address: Joi.string().max(200).optional(),
      city: Joi.string().max(100).optional(),
      state: Joi.string().max(100).optional(),
      country: Joi.string().max(100).optional()
    }).optional(),
    emergency_contact: Joi.object({
      name: Joi.string().max(100).optional(),
      phone: Joi.string().max(15).optional(),
      relationship: Joi.string().max(50).optional()
    }).optional(),
    bike_info: Joi.object({
      make: Joi.string().max(50).optional(),
      model: Joi.string().max(50).optional(),
      year: Joi.number().integer().min(1900).max(new Date().getFullYear() + 1).optional(),
      type: Joi.string().valid('motorcycle', 'scooter', 'electric', 'bicycle', 'other').optional(),
      engine_size: Joi.string().max(20).optional(),
      color: Joi.string().max(30).optional(),
      license_plate: Joi.string().max(20).optional()
    }).optional()
  }),

  searchUsers: Joi.object({
    q: Joi.string().min(2).max(50).required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(20).default(10),
    friends_only: Joi.boolean().default(false)
  }),

  paginationQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    status: Joi.string().optional()
  })
};

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', 
  requireVerified,
  validate(userSchemas.updateProfile),
  updateProfile
);

// Image upload routes
router.post('/upload/profile-picture',
  requireVerified,
  uploadConfigs.single('profile_picture'), 
  handleUploadError,
  cleanupTempFiles,
  uploadProfilePicture
);

router.post('/upload/cover-picture',
  requireVerified,
  uploadConfigs.single('cover_picture'),
  handleUploadError,
  cleanupTempFiles,
  uploadCoverPicture
);

// Public user routes (enhanced with friend system)
router.get('/search',
  validateQuery(userSchemas.searchUsers),
  searchUsers
);

// Get user by ID - shows limited info unless friends
router.get('/:userId', getUserById);

// User's content routes
router.get('/:userId/rides',
  validateQuery(userSchemas.paginationQuery),
  getUserRides
);

router.get('/:userId/groups',
  validateQuery(userSchemas.paginationQuery),
  getUserGroups
);

router.get('/:userId/rentals',
  validateQuery(userSchemas.paginationQuery),
  getUserRentals
);

// Account management routes
router.put('/deactivate', deactivateAccount);
router.delete('/delete',
  validate(Joi.object({
    password: Joi.string().required()
  })),
  deleteAccount
);

// Friend-related user routes
router.get('/:userId/friendship-status',
  async (req, res, next) => {
    try {
      const { userId: otherUserId } = req.params;
      const { UserConnection } = require('../models');

      if (otherUserId === req.userId) {
        return res.status(200).json({
          status: 'success',
          data: {
            user_id: otherUserId,
            relationship: 'self',
            can_chat: false,
            can_send_request: false
          }
        });
      }

      const { status, connection, canChat } = await UserConnection.getConnectionStatus(req.userId, otherUserId);

      let canSendRequest = false;
      if (status === 'none' || status === 'rejected') {
        canSendRequest = true;
      }

      res.status(200).json({
        status: 'success',
        data: {
          user_id: otherUserId,
          relationship: status,
          can_chat: canChat,
          can_send_request: canSendRequest,
          connection_date: connection?.accepted_at || null,
          request_date: connection?.created_at || null
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get mutual friends with another user
router.get('/:userId/mutual-friends',
  validateQuery(userSchemas.paginationQuery),
  async (req, res, next) => {
    try {
      const { userId: otherUserId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const { UserConnection, User } = require('../models');
      const { Op } = require('sequelize');
      const { getPagination, getPagingData } = require('../utils/helpers');

      if (otherUserId === req.userId) {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot get mutual friends with yourself'
        });
      }

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

      // Get other user's friends that are also current user's friends
      const mutualFriendConnections = await UserConnection.findAndCountAll({
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
      const mutualFriends = mutualFriendConnections.rows.map(conn => {
        if (currentUserFriendIds.includes(conn.user_id)) {
          return conn.user;
        } else {
          return conn.connectedUser;
        }
      }).filter(user => user); // Remove null values

      const response = getPagingData({ 
        rows: mutualFriends, 
        count: mutualFriendConnections.count 
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

// Check if user can view another user's profile (privacy check)
router.get('/:userId/privacy-check',
  async (req, res, next) => {
    try {
      const { userId: targetUserId } = req.params;
      const { UserConnection } = require('../models');

      if (targetUserId === req.userId) {
        return res.status(200).json({
          status: 'success',
          data: {
            can_view_full_profile: true,
            can_send_message: false,
            can_view_rides: true,
            can_view_groups: true,
            relationship: 'self'
          }
        });
      }

      const { status, canChat } = await UserConnection.getConnectionStatus(req.userId, targetUserId);

      const canViewFullProfile = status === 'accepted';
      const canViewLimitedProfile = ['none', 'sent', 'received'].includes(status);
      const canSendMessage = canChat;
      const canViewRides = status === 'accepted'; // Only friends can see rides
      const canViewGroups = status === 'accepted'; // Only friends can see groups

      res.status(200).json({
        status: 'success',
        data: {
          can_view_full_profile: canViewFullProfile,
          can_view_limited_profile: canViewLimitedProfile,
          can_send_message: canSendMessage,
          can_view_rides: canViewRides,
          can_view_groups: canViewGroups,
          relationship: status,
          is_blocked: status === 'blocked'
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;