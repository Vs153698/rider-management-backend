const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified, checkOwnership } = require('../middleware/auth');
const { uploadConfigs, handleUploadError, cleanupTempFiles } = require('../middleware/upload');
const { Rental } = require('../models');
const {
  createRental,
  getRentals,
  getNearbyRentals,
  getRentalById,
  updateRental,
  bookRental,
  getRentalBookings,
  getUserBookings,
  searchRentals,
  rateRental,
  deleteRental,
  getCategories
} = require('../controllers/rentalController');
const Joi = require('joi');

const router = express.Router();

// Public routes
router.get('/',
  validateQuery(schemas.paginationQuery),
  getRentals
);

router.get('/nearby',
  validateQuery(schemas.locationQuery),
  getNearbyRentals
);

router.get('/categories', getCategories);
router.get('/:rentalId', getRentalById);

router.get('/search',
  validateQuery(schemas.searchQuery),
  searchRentals
);

// Protected routes
router.use(authenticate);

// Create rental
router.post('/',
  requireVerified,
  uploadConfigs.rental,
  handleUploadError,
  cleanupTempFiles,
  validate(schemas.createRental),
  createRental
);

// Update rental
router.put('/:rentalId',
  requireVerified,
  uploadConfigs.rental,
  handleUploadError,
  cleanupTempFiles,
  updateRental
);

// Book rental
router.post('/:rentalId/book',
  requireVerified,
  validate(Joi.object({
    start_date: Joi.date().greater('now').required(),
    end_date: Joi.date().greater(Joi.ref('start_date')).required(),
    message: Joi.string().max(500).optional()
  })),
  bookRental
);

// Rental bookings
router.get('/:rentalId/bookings',
  validateQuery(schemas.paginationQuery),
  getRentalBookings
);

router.get('/user/bookings',
  validateQuery(schemas.paginationQuery),
  getUserBookings
);

// Rate rental
router.post('/:rentalId/rate',
  validate(Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    review: Joi.string().max(1000).optional()
  })),
  rateRental
);

// Delete rental
router.delete('/:rentalId',
  checkOwnership(Rental),
  deleteRental
);

module.exports = router;