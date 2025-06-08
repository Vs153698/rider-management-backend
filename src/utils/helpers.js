const crypto = require('crypto');
const moment = require('moment');

// Generate random string
const generateRandomString = (length = 10) => {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
};

// Generate unique filename
const generateUniqueFilename = (originalFilename) => {
  const timestamp = Date.now();
  const random = generateRandomString(8);
  const extension = originalFilename.split('.').pop();
  return `${timestamp}-${random}.${extension}`;
};

// Format phone number
const formatPhoneNumber = (phone) => {
  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, '');
  
  // Add country code if not present
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return `+${cleaned}`;
  } else if (cleaned.length === 13 && cleaned.startsWith('+91')) {
    return cleaned;
  }
  
  return phone; // Return as-is if format is unclear
};

// Validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate phone number format
const isValidPhoneNumber = (phone) => {
  const phoneRegex = /^(\+91|91)?[6-9]\d{9}$/;
  return phoneRegex.test(phone.replace(/\D/g, ''));
};

// Sanitize user input
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 1000); // Limit length
};

// Format currency
const formatCurrency = (amount, currency = 'INR') => {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  
  return formatter.format(amount);
};

// Calculate age from date
const calculateAge = (birthDate) => {
  return moment().diff(moment(birthDate), 'years');
};

// Format date for display
const formatDate = (date, format = 'DD MMM YYYY') => {
  return moment(date).format(format);
};

// Format date with time
const formatDateTime = (date) => {
  return moment(date).format('DD MMM YYYY, hh:mm A');
};

// Get time ago
const getTimeAgo = (date) => {
  return moment(date).fromNow();
};

// Check if date is in future
const isFutureDate = (date) => {
  return moment(date).isAfter(moment());
};

// Get date range
const getDateRange = (startDate, endDate) => {
  const start = moment(startDate);
  const end = moment(endDate);
  const dates = [];
  
  while (start.isSameOrBefore(end)) {
    dates.push(start.format('YYYY-MM-DD'));
    start.add(1, 'day');
  }
  
  return dates;
};

// Pagination helper
const getPagination = (page, size) => {
  const limit = size ? +size : 3;
  const offset = page ? page * limit : 0;
  
  return { limit, offset };
};

// Pagination data formatter
const getPagingData = (data, page, limit) => {
  const { count: totalItems, rows: items } = data;
  const currentPage = page ? +page : 0;
  const totalPages = Math.ceil(totalItems / limit);
  
  return {
    totalItems,
    items,
    totalPages,
    currentPage,
    hasNext: currentPage < totalPages - 1,
    hasPrev: currentPage > 0
  };
};

// Remove sensitive data from user object
const sanitizeUser = (user) => {
  if (!user) return null;
  
  const sanitized = { ...user };
  delete sanitized.password;
  delete sanitized.verification_code;
  delete sanitized.reset_password_token;
  delete sanitized.reset_password_expires;
  
  return sanitized;
};

// Generate slug from text
const generateSlug = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-');
};

// Validate password strength
const validatePasswordStrength = (password) => {
  const minLength = 6;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasNonalphas = /\W/.test(password);
  
  let strength = 0;
  let feedback = [];
  
  if (password.length >= minLength) strength++;
  else feedback.push('Password must be at least 6 characters long');
  
  if (hasUpperCase) strength++;
  else feedback.push('Add uppercase letters');
  
  if (hasLowerCase) strength++;
  else feedback.push('Add lowercase letters');
  
  if (hasNumbers) strength++;
  else feedback.push('Add numbers');
  
  if (hasNonalphas) strength++;
  else feedback.push('Add special characters');
  
  const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  
  return {
    strength,
    level: levels[Math.min(strength, 4)],
    isValid: strength >= 2,
    feedback
  };
};

// Generate QR code data for ride sharing
const generateRideQRData = (rideId, creatorId) => {
  const data = {
    type: 'ride_invitation',
    ride_id: rideId,
    creator_id: creatorId,
    timestamp: Date.now()
  };
  
  return Buffer.from(JSON.stringify(data)).toString('base64');
};

// Parse QR code data
const parseQRData = (qrData) => {
  try {
    const jsonString = Buffer.from(qrData, 'base64').toString('utf-8');
    return JSON.parse(jsonString);
  } catch (error) {
    return null;
  }
};

// Calculate ride fee based on distance and group size
const calculateRideFee = (distance, baseRate = 5, participants = 1) => {
  const baseFee = distance * baseRate;
  const perPersonFee = Math.max(baseFee / participants, 10); // Minimum ₹10 per person
  return Math.round(perPersonFee);
};

// Generate emergency code
const generateEmergencyCode = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Mask sensitive information
const maskSensitiveInfo = (data, fields = ['phone_number', 'email']) => {
  const masked = { ...data };
  
  fields.forEach(field => {
    if (masked[field]) {
      if (field === 'phone_number') {
        masked[field] = masked[field].replace(/(\d{3})\d{4}(\d{3})/, '$1****$2');
      } else if (field === 'email') {
        masked[field] = masked[field].replace(/(.{2}).*@/, '$1***@');
      }
    }
  });
  
  return masked;
};

// Convert coordinates to readable address (placeholder)
const coordinatesToAddress = async (latitude, longitude) => {
  // In production, use Google Maps Geocoding API
  return `Location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
};

// Calculate estimated arrival time
const calculateETA = (distance, averageSpeed = 45) => {
  const timeInHours = distance / averageSpeed;
  const hours = Math.floor(timeInHours);
  const minutes = Math.round((timeInHours - hours) * 60);
  
  return {
    hours,
    minutes,
    totalMinutes: Math.round(timeInHours * 60),
    formatted: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  };
};

// Group array by key
const groupBy = (array, key) => {
  return array.reduce((result, currentValue) => {
    const groupKey = currentValue[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(currentValue);
    return result;
  }, {});
};

// Deep clone object
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

// Check if object is empty
const isEmpty = (obj) => {
  return Object.keys(obj).length === 0;
};

// Retry function with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

module.exports = {
  generateRandomString,
  generateUniqueFilename,
  formatPhoneNumber,
  isValidEmail,
  isValidPhoneNumber,
  sanitizeInput,
  formatCurrency,
  calculateAge,
  formatDate,
  formatDateTime,
  getTimeAgo,
  isFutureDate,
  getDateRange,
  getPagination,
  getPagingData,
  sanitizeUser,
  generateSlug,
  validatePasswordStrength,
  generateRideQRData,
  parseQRData,
  calculateRideFee,
  generateEmergencyCode,
  maskSensitiveInfo,
  coordinatesToAddress,
  calculateETA,
  groupBy,
  deepClone,
  isEmpty,
  retryWithBackoff
};