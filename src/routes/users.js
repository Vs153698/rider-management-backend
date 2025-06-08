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

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', 
  requireVerified,
  validate(schemas.updateProfile),
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

// Public user routes
router.get('/search',
  validateQuery(schemas.searchQuery),
  searchUsers
);

router.get('/:userId', getUserById);
router.get('/:userId/rides',
  validateQuery(schemas.paginationQuery),
  getUserRides
);

router.get('/:userId/groups',
  validateQuery(schemas.paginationQuery),
  getUserGroups
);

router.get('/:userId/rentals',
  validateQuery(schemas.paginationQuery),
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

module.exports = router;