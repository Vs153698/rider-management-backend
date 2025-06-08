const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified, checkGroupMembership } = require('../middleware/auth');
const { uploadConfigs, handleUploadError, cleanupTempFiles } = require('../middleware/upload');
const {
  createGroup,
  getGroups,
  getNearbyGroups,
  getGroupById,
  updateGroup,
  joinGroup,
  leaveGroup,
  inviteToGroup,
  getGroupMembers,
  removeMember,
  transferAdmin,
  deleteGroup,
  getUserAdminGroups,
  getUserAllGroups
} = require('../controllers/groupController');
const Joi = require('joi');

const router = express.Router();

// Public routes
router.get('/',
  validateQuery(schemas.paginationQuery),
  getGroups
);

router.get('/nearby',
  validateQuery(schemas.locationQuery),
  getNearbyGroups
);

router.get('/:groupId', getGroupById);

// Protected routes
router.use(authenticate);

// User groups routes
router.get('/user/admin', getUserAdminGroups);
router.get('/user/all', getUserAllGroups);

// Create group
router.post('/',
  requireVerified,
  uploadConfigs.groupCover,
  handleUploadError,
  cleanupTempFiles,
  validate(schemas.createGroup),
  createGroup
);

// Update group
router.put('/:groupId',
  requireVerified,
  uploadConfigs.groupCover,
  handleUploadError,
  cleanupTempFiles,
  updateGroup
);

// Group membership
router.post('/:groupId/join', requireVerified, joinGroup);
router.delete('/:groupId/leave', leaveGroup);

// Group management
router.post('/:groupId/invite',
  requireVerified,
  validate(Joi.object({
    user_ids: Joi.array().items(Joi.string().uuid()).optional(),
    phone_numbers: Joi.array().items(Joi.string().pattern(/^\d{10,15}$/)).optional()
  }).or('user_ids', 'phone_numbers')),
  inviteToGroup
);

// Group members
router.get('/:groupId/members',
  validateQuery(schemas.paginationQuery),
  getGroupMembers
);

router.delete('/:groupId/members/:userId',
  removeMember
);

// Admin operations
router.put('/:groupId/transfer-admin',
  validate(Joi.object({
    new_admin_id: Joi.string().uuid().required()
  })),
  transferAdmin
);

router.delete('/:groupId', deleteGroup);

module.exports = router;