// API Response Status
const RESPONSE_STATUS = {
  SUCCESS: 'success',
  ERROR: 'error',
  FAIL: 'fail'
};

// User Status
const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  DELETED: 'deleted'
};

// Ride Status
const RIDE_STATUS = {
  UPCOMING: 'upcoming',
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

// Ride Visibility
const RIDE_VISIBILITY = {
  PUBLIC: 'public',
  GROUP_ONLY: 'group_only',
  PRIVATE: 'private'
};

// Group Types
const GROUP_TYPES = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  INVITE_ONLY: 'invite_only'
};

// Message Types
const MESSAGE_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  LOCATION: 'location',
  FILE: 'file',
  VOICE: 'voice'
};

// Payment Types
const PAYMENT_TYPES = {
  RIDE_FEE: 'ride_fee',
  GROUP_MEMBERSHIP: 'group_membership',
  RENTAL_PAYMENT: 'rental_payment',
  SECURITY_DEPOSIT: 'security_deposit'
};

// Payment Status
const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
};

// Payment Methods
const PAYMENT_METHODS = {
  CARD: 'card',
  UPI: 'upi',
  NETBANKING: 'netbanking',
  WALLET: 'wallet'
};

// Rental Categories
const RENTAL_CATEGORIES = {
  BIKE_GEAR: 'bike_gear',
  CAMPING: 'camping',
  ELECTRONICS: 'electronics',
  TOOLS: 'tools',
  CLOTHING: 'clothing',
  ACCESSORIES: 'accessories',
  SAFETY_GEAR: 'safety_gear',
  OTHER: 'other'
};

// Rental Condition
const RENTAL_CONDITIONS = {
  NEW: 'new',
  LIKE_NEW: 'like_new',
  GOOD: 'good',
  FAIR: 'fair',
  POOR: 'poor'
};

// Rental Status
const RENTAL_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  RENTED: 'rented',
  MAINTENANCE: 'maintenance'
};

// Pickup Options
const PICKUP_OPTIONS = {
  PICKUP: 'pickup',
  DELIVERY: 'delivery',
  MEET_LOCATION: 'meet_location'
};

// File Types
const ALLOWED_IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp'];
const ALLOWED_DOCUMENT_TYPES = ['pdf', 'doc', 'docx', 'txt'];
const ALLOWED_ATTACHMENT_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES];

// File Size Limits (in bytes)
const FILE_SIZE_LIMITS = {
  IMAGE: 10 * 1024 * 1024, // 10MB
  DOCUMENT: 25 * 1024 * 1024, // 25MB
  ATTACHMENT: 15 * 1024 * 1024 // 15MB
};

// Pagination Defaults
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100
};

// Location Defaults
const LOCATION = {
  DEFAULT_RADIUS: 50, // km
  MAX_RADIUS: 200, // km
  MIN_RADIUS: 1 // km
};

// Rate Limiting
const RATE_LIMITS = {
  AUTH: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 5
  },
  VERIFICATION: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 3
  },
  API: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100
  }
};

// JWT Configuration
const JWT = {
  DEFAULT_EXPIRES_IN: '7d',
  REFRESH_EXPIRES_IN: '30d'
};

// Cache TTL (Time To Live) in seconds
const CACHE_TTL = {
  USER: 900, // 15 minutes
  RIDES: 300, // 5 minutes
  GROUPS: 600, // 10 minutes
  RENTALS: 1800, // 30 minutes
  VERIFICATION: 600 // 10 minutes
};

// Socket Events
const SOCKET_EVENTS = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  
  // Rooms
  JOIN_RIDE: 'join_ride',
  LEAVE_RIDE: 'leave_ride',
  JOIN_GROUP: 'join_group',
  LEAVE_GROUP: 'leave_group',
  
  // Messages
  SEND_MESSAGE: 'send_message',
  NEW_MESSAGE: 'new_message',
  EDIT_MESSAGE: 'edit_message',
  DELETE_MESSAGE: 'delete_message',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_DELETED: 'message_deleted',
  
  // Typing
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
  USER_TYPING: 'user_typing',
  
  // Location
  SHARE_LOCATION: 'share_location',
  UPDATE_LIVE_LOCATION: 'update_live_location',
  LIVE_LOCATION_UPDATE: 'live_location_update',
  
  // Errors
  JOIN_ERROR: 'join_error',
  MESSAGE_ERROR: 'message_error',
  EDIT_ERROR: 'edit_error',
  DELETE_ERROR: 'delete_error'
};

// Notification Types
const NOTIFICATION_TYPES = {
  RIDE_INVITATION: 'ride_invitation',
  GROUP_INVITATION: 'group_invitation',
  RIDE_REMINDER: 'ride_reminder',
  PAYMENT_CONFIRMATION: 'payment_confirmation',
  RENTAL_BOOKING: 'rental_booking',
  EMERGENCY_ALERT: 'emergency_alert'
};

// Error Codes
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR'
};

// Default Coordinates (India)
const DEFAULT_LOCATION = {
  LATITUDE: 20.5937,
  LONGITUDE: 78.9629
};

// Currency
const DEFAULT_CURRENCY = 'INR';

// Date Formats
const DATE_FORMATS = {
  DATE_ONLY: 'YYYY-MM-DD',
  DATE_TIME: 'YYYY-MM-DD HH:mm:ss',
  DISPLAY_DATE: 'DD MMM YYYY',
  DISPLAY_DATE_TIME: 'DD MMM YYYY, hh:mm A'
};

// Regex Patterns
const REGEX_PATTERNS = {
  PHONE_NUMBER: /^(\+91|91)?[6-9]\d{9}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{6,}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
};

// App Configuration
const APP_CONFIG = {
  NAME: 'Rider Management App',
  VERSION: '1.0.0',
  DESCRIPTION: 'A comprehensive rider management platform with groups, chat, and rentals',
  SUPPORT_EMAIL: 'support@riderapp.com',
  SUPPORT_PHONE: '+91-9999999999'
};

module.exports = {
  RESPONSE_STATUS,
  USER_STATUS,
  RIDE_STATUS,
  RIDE_VISIBILITY,
  GROUP_TYPES,
  MESSAGE_TYPES,
  PAYMENT_TYPES,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  RENTAL_CATEGORIES,
  RENTAL_CONDITIONS,
  RENTAL_STATUS,
  PICKUP_OPTIONS,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_ATTACHMENT_TYPES,
  FILE_SIZE_LIMITS,
  PAGINATION,
  LOCATION,
  RATE_LIMITS,
  JWT,
  CACHE_TTL,
  SOCKET_EVENTS,
  NOTIFICATION_TYPES,
  ERROR_CODES,
  DEFAULT_LOCATION,
  DEFAULT_CURRENCY,
  DATE_FORMATS,
  REGEX_PATTERNS,
  APP_CONFIG
};