const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { cacheSet, cacheGet, cacheDel } = require('../config/redis');
const { sendSMS } = require('./notificationService');

// Generate JWT token
const generateToken = (payload, expiresIn = process.env.JWT_EXPIRES_IN || '7d') => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

// Generate verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Hash password
const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

// Compare password
const comparePassword = async (plainPassword, hashedPassword) => {
  return await bcrypt.compare(plainPassword, hashedPassword);
};

// Send verification code
const sendVerificationCode = async (phoneNumber) => {
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  // Store in cache
  await cacheSet(`verification:${phoneNumber}`, {
    code,
    expires_at: expiresAt,
    attempts: 0
  }, 600); // 10 minutes

  // Send SMS
  const message = `Your Rider App verification code is: ${code}. Valid for 10 minutes.`;
  await sendSMS(phoneNumber, message);

  return { success: true, expires_at: expiresAt };
};

// Verify phone number
const verifyPhoneNumber = async (phoneNumber, inputCode) => {
  const verificationData = await cacheGet(`verification:${phoneNumber}`);
  
  if (!verificationData) {
    throw new Error('Verification code expired or not found');
  }

  if (verificationData.attempts >= 3) {
    await cacheDel(`verification:${phoneNumber}`);
    throw new Error('Too many failed attempts. Please request a new code.');
  }

  if (verificationData.code !== inputCode) {
    verificationData.attempts += 1;
    await cacheSet(`verification:${phoneNumber}`, verificationData, 600);
    throw new Error('Invalid verification code');
  }

  if (new Date() > new Date(verificationData.expires_at)) {
    await cacheDel(`verification:${phoneNumber}`);
    throw new Error('Verification code expired');
  }

  // Mark as verified
  await cacheSet(`verified:${phoneNumber}`, true, 3600); // 1 hour
  await cacheDel(`verification:${phoneNumber}`);

  return { success: true };
};

// Register user
const registerUser = async (userData) => {
  const { phone_number, email, password, first_name, last_name } = userData;

  // Check if phone is verified
  const isVerified = await cacheGet(`verified:${phone_number}`);
  if (!isVerified) {
    throw new Error('Phone number not verified');
  }

  // Check if user already exists
  const existingUser = await User.findOne({ where: { phone_number } });
  
  let user;
  if (existingUser) {
    if (existingUser.is_verified) {
      throw new Error('User already exists and is verified');
    }
    
    // Update existing unverified user
    user = await existingUser.update({
      email,
      password: await hashPassword(password),
      first_name,
      last_name,
      is_verified: true
    });
  } else {
    // Create new user
    user = await User.create({
      phone_number,
      email,
      password: await hashPassword(password),
      first_name,
      last_name,
      is_verified: true
    });
  }

  // Clean up verification cache
  await cacheDel(`verified:${phone_number}`);

  // Generate token
  const token = generateToken({ userId: user.id });

  // Cache user
  await cacheSet(`user:${user.id}`, user, 900);

  return { user, token };
};

// Login user
const loginUser = async (phoneNumber, password) => {
  const user = await User.findOne({ 
    where: { phone_number: phoneNumber },
    attributes: { include: ['password'] }
  });

  if (!user) {
    throw new Error('Invalid phone number or password');
  }

  const isValidPassword = await comparePassword(password, user.password);
  if (!isValidPassword) {
    throw new Error('Invalid phone number or password');
  }

  if (!user.is_verified) {
    throw new Error('Account not verified');
  }

  if (!user.is_active) {
    throw new Error('Account is deactivated');
  }

  // Update last active
  await user.update({ last_active: new Date() });

  // Generate token
  const token = generateToken({ userId: user.id });

  // Cache user
  await cacheSet(`user:${user.id}`, user, 900);

  // Remove password from response
  const userResponse = user.toJSON();
  delete userResponse.password;

  return { user: userResponse, token };
};

// Logout user
const logoutUser = async (userId) => {
  await cacheDel(`user:${userId}`);
  return { success: true };
};

// Refresh token
const refreshToken = async (userId) => {
  const user = await User.findByPk(userId);
  
  if (!user || !user.is_active) {
    throw new Error('User not found or inactive');
  }

  // Update last active
  await user.update({ last_active: new Date() });

  // Generate new token
  const token = generateToken({ userId: user.id });

  // Update cache
  await cacheSet(`user:${user.id}`, user, 900);

  return { user, token };
};

// Generate password reset code
const generatePasswordResetCode = async (phoneNumber) => {
  const user = await User.findOne({ where: { phone_number: phoneNumber } });
  if (!user) {
    throw new Error('User not found');
  }

  const resetCode = generateVerificationCode();
  const resetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await user.update({
    reset_password_token: resetCode,
    reset_password_expires: resetExpires
  });

  // Send SMS
  const message = `Your password reset code is: ${resetCode}. Valid for 10 minutes.`;
  await sendSMS(phoneNumber, message);

  return { success: true };
};

// Reset password
const resetPassword = async (phoneNumber, resetCode, newPassword) => {
  const { Op } = require('sequelize');
  
  const user = await User.findOne({
    where: {
      phone_number: phoneNumber,
      reset_password_token: resetCode,
      reset_password_expires: { [Op.gt]: new Date() }
    }
  });

  if (!user) {
    throw new Error('Invalid or expired reset code');
  }

  await user.update({
    password: await hashPassword(newPassword),
    reset_password_token: null,
    reset_password_expires: null
  });

  // Clear user cache
  await cacheDel(`user:${user.id}`);

  return { success: true };
};

// Change password
const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findByPk(userId, {
    attributes: { include: ['password'] }
  });

  if (!user) {
    throw new Error('User not found');
  }

  const isValidPassword = await comparePassword(currentPassword, user.password);
  if (!isValidPassword) {
    throw new Error('Current password is incorrect');
  }

  await user.update({
    password: await hashPassword(newPassword)
  });

  // Clear user cache
  await cacheDel(`user:${userId}`);

  return { success: true };
};

// Validate token and get user
const validateTokenAndGetUser = async (token) => {
  try {
    const decoded = verifyToken(token);
    
    // Check cache first
    let user = await cacheGet(`user:${decoded.userId}`);
    
    if (!user) {
      user = await User.findByPk(decoded.userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      // Cache user for 15 minutes
      await cacheSet(`user:${decoded.userId}`, user, 900);
    }

    if (!user.is_active) {
      throw new Error('Account is deactivated');
    }

    return user;
  } catch (error) {
    throw new Error('Authentication failed');
  }
};

module.exports = {
  generateToken,
  verifyToken,
  generateVerificationCode,
  hashPassword,
  comparePassword,
  sendVerificationCode,
  verifyPhoneNumber,
  registerUser,
  loginUser,
  logoutUser,
  refreshToken,
  generatePasswordResetCode,
  resetPassword,
  changePassword,
  validateTokenAndGetUser
};