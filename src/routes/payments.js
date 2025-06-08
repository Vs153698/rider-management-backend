const express = require('express');
const { validate, validateQuery, schemas } = require('../middleware/validation');
const { authenticate, requireVerified } = require('../middleware/auth');
const {
  createPayment,
  verifyPaymentStatus,
  getPaymentById,
  getUserPayments,
  getReceivedPayments,
  requestRefund,
  handlePaymentWebhook,
  getPaymentStats,
  cancelPayment,
  getPaymentMethods
} = require('../controllers/paymentController');
const Joi = require('joi');

const router = express.Router();

// Webhook route (no auth required)
router.post('/webhook', handlePaymentWebhook);

// Public routes
router.get('/methods', getPaymentMethods);

// Protected routes
router.use(authenticate);

// Create payment
router.post('/create',
  requireVerified,
  validate(schemas.createPayment),
  createPayment
);

// Verify payment
router.get('/verify/:orderId', verifyPaymentStatus);

// Get payments
router.get('/user',
  validateQuery(schemas.paginationQuery),
  getUserPayments
);

router.get('/received',
  validateQuery(schemas.paginationQuery),
  getReceivedPayments
);

router.get('/stats',
  validateQuery(Joi.object({
    period: Joi.string().valid('7d', '30d', '90d', '1y').default('30d')
  })),
  getPaymentStats
);

router.get('/:paymentId', getPaymentById);

// Refund payment
router.post('/:paymentId/refund',
  validate(Joi.object({
    refund_amount: Joi.number().min(0).optional(),
    reason: Joi.string().max(500).required()
  })),
  requestRefund
);

// Cancel payment
router.post('/:paymentId/cancel', cancelPayment);

module.exports = router;