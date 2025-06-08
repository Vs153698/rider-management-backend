const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified, checkOwnership } = require('../middleware/auth');
const { uploadConfigs, handleUploadError, cleanupTempFiles } = require('../middleware/upload');
const { Ride } = require('../models');
const {
  createRide,
  getRides,
  getNearbyRides,
  getRideById,
  updateRide,
  joinRide,
  leaveRide,
  cancelRide,
  inviteToRide,
  getRideParticipants,
  deleteRide,
  checkUserAlreadyJoined
} = require('../controllers/rideController');
const Joi = require('joi');
const { convertRideFormData } = require('../middleware/ConvertRideData');

const router = express.Router();



// Public routes
router.get('/',
  validateQuery(schemas.paginationQuery),
  getRides
);

router.get('/nearby',
  validateQuery(schemas.locationQuery),
  getNearbyRides
);

router.get('/:rideId', getRideById);

// Protected routes
router.use(authenticate);

// Create ride - WITH FORMDATA CONVERSION MIDDLEWARE
router.post('/',
  requireVerified,
  uploadConfigs.rideCover,
  handleUploadError,
  cleanupTempFiles,
  convertRideFormData,  // 👈 NEW: Convert FormData types before validation
  validate(schemas.createRide),
  createRide
);

// Update ride - WITH FORMDATA CONVERSION MIDDLEWARE
router.put('/:rideId',
  requireVerified,
  uploadConfigs.rideCover,
  handleUploadError,
  cleanupTempFiles,
  convertRideFormData,  // 👈 NEW: Convert FormData types before validation
  validate(schemas.updateRide),
  updateRide
);

// Ride participation
router.post('/:rideId/join', requireVerified, joinRide);
router.delete('/:rideId/leave', leaveRide);

// Ride management
router.post('/:rideId/cancel',
  validate(Joi.object({
    reason: Joi.string().max(500).optional()
  })),
  cancelRide
);

router.post('/:rideId/invite',
  requireVerified,
  validate(Joi.object({
    user_ids: Joi.array().items(Joi.string().uuid()).optional(),
    phone_numbers: Joi.array().items(Joi.string().pattern(/^\d{10,15}$/)).optional()
  }).or('user_ids', 'phone_numbers')),
  inviteToRide
);

// Ride participants
router.get('/:rideId/participants', getRideParticipants);
router.get('/:rideId/check-user-joined', checkUserAlreadyJoined);

// Delete ride
router.delete('/:rideId',
  checkOwnership(Ride),
  deleteRide
);

module.exports = router;