const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate, schemas } = require('../middleware/validation');
const { authenticate } = require('../middleware/auth');
const {
  sendVerificationCode,
  verifyPhone,
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  refreshToken
} = require('../controllers/authController');
const Joi = require('joi');

const router = express.Router();

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    status: 'error',
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const verificationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Limit each IP to 3 verification requests per minute
  message: {
    status: 'error',
    message: 'Too many verification requests, please try again later.'
  }
});

// Auth routes
router.post('/send-verification', 
  verificationLimiter,
  validate(schemas.phoneVerification),
  sendVerificationCode
);

router.post('/verify-phone',
  authLimiter,
  validate(schemas.otpVerification),
  verifyPhone
);

router.post('/register',
  authLimiter,
  validate(schemas.userRegistration),
  register
);

router.post('/login',
  authLimiter,
  validate(schemas.userLogin),
  login
);

router.post('/logout',
  authenticate,
  logout
);

router.post('/forgot-password',
  authLimiter,
  validate(schemas.phoneVerification),
  forgotPassword
);

router.post('/reset-password',
  authLimiter,
  validate(Joi.object({
    phone_number: Joi.string().pattern(/^\d{10,15}$/).required(),
    reset_code: Joi.string().length(6).required(),
    new_password: Joi.string().min(6).max(100).required()
  })),
  resetPassword
);

router.post('/change-password',
  authenticate,
  validate(Joi.object({
    current_password: Joi.string().required(),
    new_password: Joi.string().min(6).max(100).required()
  })),
  changePassword
);

router.post('/refresh-token',
  authenticate,
  refreshToken
);

module.exports = router;