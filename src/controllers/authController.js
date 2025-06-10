const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { sendSMS, sendEmail } = require('../services/notificationService');
const { cacheSet, cacheGet, cacheDel } = require('../config/redis');

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Generate verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send verification code
const sendVerificationCode = catchAsync(async (req, res, next) => {
  const { phone_number } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ where: { phone_number } });
  if (existingUser && existingUser.is_verified) {
    return next(new AppError('User already exists and is verified', 409));
  }

  // Generate verification code
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store verification code in cache
  await cacheSet(`verification:${phone_number}`, {
    code,
    expires_at: expiresAt,
    attempts: 0
  }, 600); // 10 minutes

  // Send SMS
  try {
    await sendSMS(phone_number, `Your Rider App verification code is: ${code}. Valid for 10 minutes.`);
  } catch (error) {
    return next(new AppError('Failed to send verification code', 500));
  }

  res.status(200).json({
    status: 'success',
    message: 'Verification code sent successfully',
    expires_at: expiresAt
  });
});

// Verify phone number
const verifyPhone = catchAsync(async (req, res, next) => {
  const { phone_number, code } = req.body;

  // Get verification data from cache
  const verificationData = await cacheGet(`verification:${phone_number}`);
  
  if (!verificationData) {
    return next(new AppError('Verification code expired or not found', 400));
  }

  // Check attempts
  if (verificationData.attempts >= 3) {
    await cacheDel(`verification:${phone_number}`);
    return next(new AppError('Too many failed attempts. Please request a new code.', 429));
  }

  // Verify code
  if (verificationData.code !== code) {
    verificationData.attempts += 1;
    await cacheSet(`verification:${phone_number}`, verificationData, 600);
    return next(new AppError('Invalid verification code', 400));
  }

  // Check expiration
  if (new Date() > new Date(verificationData.expires_at)) {
    await cacheDel(`verification:${phone_number}`);
    return next(new AppError('Verification code expired', 400));
  }

  // Mark as verified in cache
  await cacheSet(`verified:${phone_number}`, true, 3600); // 1 hour
  await cacheDel(`verification:${phone_number}`);

  res.status(200).json({
    status: 'success',
    message: 'Phone number verified successfully'
  });
});

// Register user
const register = catchAsync(async (req, res, next) => {
  const { phone_number, email, password, first_name, last_name } = req.body;
  console.log('Registering user:', phone_number, email, first_name, last_name);

  // Check if phone is verified
  const isVerified = await cacheGet(`verified:${phone_number}`);
  console.log('Is phone number verified:', isVerified);
  if (!isVerified) {
    return next(new AppError('Phone number not verified', 400));
  }

  // Check if user already exists
  const existingUser = await User.findOne({ 
    where: { phone_number }
  });

  let user;
  if (existingUser) {
    // Update existing unverified user
    if (existingUser.is_verified) {
      return next(new AppError('User already exists and is verified', 409));
    }
    
    user = await existingUser.update({
      email,
      password,
      first_name,
      last_name,
      is_verified: true
    });
  } else {
    // Create new user
    user = await User.create({
      phone_number,
      email,
      password,
      first_name,
      last_name,
      is_verified: true
    });
  }

  // Clean up verification cache
  await cacheDel(`verified:${phone_number}`);

  // Generate token
  const token = generateToken(user.id);

  // Cache user
  await cacheSet(`user:${user.id}`, user, 900);

  res.status(201).json({
    status: 'success',
    message: 'User registered successfully',
    data: {
      user,
      token
    }
  });
});

// Login user
const login = catchAsync(async (req, res, next) => {
  const { phone_number, password } = req.body;

  // Find user
  const user = await User.findOne({ 
    where: { phone_number },
    attributes: { include: ['password'] }
  });

  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid phone number or password', 401));
  }

  if (!user.is_verified) {
    return next(new AppError('Account not verified', 401));
  }

  if (!user.is_active) {
    return next(new AppError('Account is deactivated', 401));
  }

  // Update last active
  await user.update({ last_active: new Date() });

  // Generate token
  const token = generateToken(user.id);

  // Cache user
  await cacheSet(`user:${user.id}`, user, 900);

  // Remove password from response
  user.password = undefined;

  res.status(200).json({
    status: 'success',
    message: 'Login successful',
    data: {
      user,
      token
    }
  });
});

// Logout user
const logout = catchAsync(async (req, res, next) => {
  // Clear user cache
  await cacheDel(`user:${req.userId}`);

  res.status(200).json({
    status: 'success',
    message: 'Logout successful'
  });
});

// Forgot password
const forgotPassword = catchAsync(async (req, res, next) => {
  const { phone_number } = req.body;

  const user = await User.findOne({ where: { phone_number } });
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Generate reset code
  const resetCode = generateVerificationCode();
  const resetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Update user with reset token
  await user.update({
    reset_password_token: resetCode,
    reset_password_expires: resetExpires
  });

  // Send SMS
  try {
    await sendSMS(phone_number, `Your password reset code is: ${resetCode}. Valid for 10 minutes.`);
  } catch (error) {
    await user.update({
      reset_password_token: null,
      reset_password_expires: null
    });
    return next(new AppError('Failed to send reset code', 500));
  }

  res.status(200).json({
    status: 'success',
    message: 'Password reset code sent successfully'
  });
});

// Reset password
const resetPassword = catchAsync(async (req, res, next) => {
  const { phone_number, reset_code, new_password } = req.body;

  const user = await User.findOne({
    where: {
      phone_number,
      reset_password_token: reset_code,
      reset_password_expires: { [Op.gt]: new Date() }
    }
  });

  if (!user) {
    return next(new AppError('Invalid or expired reset code', 400));
  }

  // Update password
  await user.update({
    password: new_password,
    reset_password_token: null,
    reset_password_expires: null
  });

  // Clear user cache
  await cacheDel(`user:${user.id}`);

  res.status(200).json({
    status: 'success',
    message: 'Password reset successful'
  });
});

// Change password
const changePassword = catchAsync(async (req, res, next) => {
  const { current_password, new_password } = req.body;

  const user = await User.findByPk(req.userId, {
    attributes: { include: ['password'] }
  });

  if (!(await user.comparePassword(current_password))) {
    return next(new AppError('Current password is incorrect', 400));
  }

  await user.update({ password: new_password });

  // Clear user cache
  await cacheDel(`user:${req.userId}`);

  res.status(200).json({
    status: 'success',
    message: 'Password changed successfully'
  });
});

// Refresh token
const refreshToken = catchAsync(async (req, res, next) => {
  const user = await User.findByPk(req.userId);
  
  if (!user || !user.is_active) {
    return next(new AppError('User not found or inactive', 401));
  }

  // Update last active
  await user.update({ last_active: new Date() });

  // Generate new token
  const token = generateToken(user.id);

  // Update cache
  await cacheSet(`user:${user.id}`, user, 900);

  res.status(200).json({
    status: 'success',
    data: {
      token,
      user
    }
  });
});

module.exports = {
  sendVerificationCode,
  verifyPhone,
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  refreshToken
};