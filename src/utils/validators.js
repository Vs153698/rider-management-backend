const Joi = require('joi');
const { 
  RIDE_STATUS, 
  RIDE_VISIBILITY, 
  GROUP_TYPES, 
  MESSAGE_TYPES,
  PAYMENT_TYPES,
  PAYMENT_STATUS,
  RENTAL_CATEGORIES,
  RENTAL_CONDITIONS,
  PICKUP_OPTIONS,
  REGEX_PATTERNS 
} = require('./constants');

// Custom validators
const customValidators = {
  // Phone number validator
  phoneNumber: () => Joi.string().pattern(REGEX_PATTERNS.PHONE_NUMBER).message('Invalid phone number format'),
  
  // Email validator
  email: () => Joi.string().email().message('Invalid email format'),
  
  // UUID validator
  uuid: () => Joi.string().pattern(REGEX_PATTERNS.UUID).message('Invalid UUID format'),
  
  // Password validator
  password: () => Joi.string().min(6).max(100).message('Password must be between 6 and 100 characters'),
  
  // Location validator
  location: () => Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    address: Joi.string().min(1).max(200).required()
  }),
  
  // Date validator (future dates only)
  futureDate: () => Joi.date().greater('now').message('Date must be in the future'),
  
  // Time validator (24 hour format)
  time: () => Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).message('Time must be in HH:MM format'),
  
  // Price validator
  price: () => Joi.number().min(0).precision(2).message('Price must be a positive number with up to 2 decimal places'),
  
  // Rating validator
  rating: () => Joi.number().integer().min(1).max(5).message('Rating must be between 1 and 5'),
  
  // Currency validator
  currency: () => Joi.string().length(3).uppercase().default('INR'),
  
  // Array of UUIDs
  uuidArray: () => Joi.array().items(customValidators.uuid()),
  
  // Array of phone numbers
  phoneArray: () => Joi.array().items(customValidators.phoneNumber()),
  
  // Pagination validator
  pagination: () => Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().optional(),
    order: Joi.string().valid('ASC', 'DESC').default('DESC')
  }),
  
  // Search query validator
  searchQuery: () => Joi.object({
    q: Joi.string().min(1).max(100).optional(),
    category: Joi.string().optional(),
    status: Joi.string().optional(),
    is_paid: Joi.boolean().optional(),
    min_price: Joi.number().min(0).optional(),
    max_price: Joi.number().min(0).optional(),
    date_from: Joi.date().optional(),
    date_to: Joi.date().min(Joi.ref('date_from')).optional()
  }),
  
  // Location query validator
  locationQuery: () => Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    radius: Joi.number().integer().min(1).max(200).default(50)
  })
};

// Extended validation schemas
const extendedSchemas = {
  // User schemas
  userRegistration: Joi.object({
    phone_number: customValidators.phoneNumber().required(),
    email: customValidators.email().optional(),
    password: customValidators.password().required(),
    first_name: Joi.string().min(2).max(50).required(),
    last_name: Joi.string().min(2).max(50).required(),
    verification_code: Joi.string().length(6).required()
  }),

  userLogin: Joi.object({
    phone_number: customValidators.phoneNumber().required(),
    password: Joi.string().required()
  }),

  updateProfile: Joi.object({
    first_name: Joi.string().min(2).max(50).optional(),
    last_name: Joi.string().min(2).max(50).optional(),
    email: customValidators.email().optional(),
    bio: Joi.string().max(500).optional(),
    location: customValidators.location().optional(),
    emergency_contact: Joi.object({
      name: Joi.string().min(2).max(50).required(),
      phone: customValidators.phoneNumber().required(),
      relationship: Joi.string().max(50).optional()
    }).optional(),
    bike_info: Joi.object({
      make: Joi.string().max(50).optional(),
      model: Joi.string().max(50).optional(),
      year: Joi.number().integer().min(1950).max(new Date().getFullYear() + 1).optional(),
      color: Joi.string().max(30).optional(),
      license_plate: Joi.string().max(20).optional(),
      engine_capacity: Joi.number().min(50).max(2000).optional(),
      fuel_type: Joi.string().valid('petrol', 'diesel', 'electric', 'hybrid').optional()
    }).optional()
  }),

  // Ride schemas
  createRide: Joi.object({
    title: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(1000).optional(),
    start_location: customValidators.location().required(),
    end_location: customValidators.location().required(),
    waypoints: Joi.array().items(customValidators.location()).optional(),
    ride_date: customValidators.futureDate().required(),
    ride_time: customValidators.time().required(),
    max_participants: Joi.number().integer().min(1).max(100).required(),
    is_paid: Joi.boolean().default(false),
    price: Joi.when('is_paid', {
      is: true,
      then: customValidators.price().required(),
      otherwise: Joi.optional()
    }),
    currency: customValidators.currency().optional(),
    group_id: customValidators.uuid().optional(),
    visibility: Joi.string().valid(...Object.values(RIDE_VISIBILITY)).default(RIDE_VISIBILITY.PUBLIC),
    requirements: Joi.object().optional(),
    rules: Joi.string().max(1000).optional(),
    emergency_contacts: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      phone: customValidators.phoneNumber().required(),
      relationship: Joi.string().optional()
    })).optional()
  }),

  updateRide: Joi.object({
    title: Joi.string().min(3).max(100).optional(),
    description: Joi.string().max(1000).optional(),
    ride_date: customValidators.futureDate().optional(),
    ride_time: customValidators.time().optional(),
    max_participants: Joi.number().integer().min(1).max(100).optional(),
    price: customValidators.price().optional(),
    visibility: Joi.string().valid(...Object.values(RIDE_VISIBILITY)).optional(),
    requirements: Joi.object().optional(),
    rules: Joi.string().max(1000).optional()
  }),

  // Group schemas
  createGroup: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(1000).optional(),
    group_type: Joi.string().valid(...Object.values(GROUP_TYPES)).default(GROUP_TYPES.PUBLIC),
    is_paid: Joi.boolean().default(false),
    membership_fee: Joi.when('is_paid', {
      is: true,
      then: customValidators.price().required(),
      otherwise: Joi.optional()
    }),
    currency: customValidators.currency().optional(),
    max_members: Joi.number().integer().min(1).max(1000).default(100),
    location: customValidators.location().optional(),
    rules: Joi.string().max(2000).optional(),
    tags: Joi.array().items(Joi.string().max(30)).max(10).optional(),
    settings: Joi.object({
      allow_member_invite: Joi.boolean().default(true),
      require_approval: Joi.boolean().default(false),
      auto_approve_rides: Joi.boolean().default(false)
    }).optional()
  }),

  // Rental schemas
  createRental: Joi.object({
    title: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(1000).optional(),
    category: Joi.string().valid(...Object.values(RENTAL_CATEGORIES)).required(),
    subcategory: Joi.string().max(50).optional(),
    condition: Joi.string().valid(...Object.values(RENTAL_CONDITIONS)).required(),
    price_per_day: customValidators.price().required(),
    price_per_week: customValidators.price().optional(),
    price_per_month: customValidators.price().optional(),
    currency: customValidators.currency().optional(),
    security_deposit: customValidators.price().optional(),
    location: customValidators.location().required(),
    availability: Joi.object({
      available_from: Joi.date().optional(),
      available_until: Joi.date().min(Joi.ref('available_from')).optional(),
      min_rental_days: Joi.number().integer().min(1).default(1),
      max_rental_days: Joi.number().integer().min(1).default(30),
      blocked_dates: Joi.array().items(Joi.date()).optional()
    }).optional(),
    specifications: Joi.object().optional(),
    rental_terms: Joi.string().max(2000).optional(),
    pickup_options: Joi.array().items(
      Joi.string().valid(...Object.values(PICKUP_OPTIONS))
    ).min(1).default([PICKUP_OPTIONS.PICKUP]),
    delivery_radius_km: Joi.number().integer().min(0).max(100).default(10),
    delivery_fee: customValidators.price().default(0)
  }),

  // Chat schemas
  sendMessage: Joi.object({
    message: Joi.string().max(2000).when('message_type', {
      is: MESSAGE_TYPES.TEXT,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    message_type: Joi.string().valid(...Object.values(MESSAGE_TYPES)).default(MESSAGE_TYPES.TEXT),
    ride_id: customValidators.uuid().optional(),
    group_id: customValidators.uuid().optional(),
    reply_to_id: customValidators.uuid().optional(),
    metadata: Joi.object().optional()
  }).or('ride_id', 'group_id'),

  // Payment schemas
  createPayment: Joi.object({
    amount: customValidators.price().required(),
    currency: customValidators.currency().optional(),
    payment_type: Joi.string().valid(...Object.values(PAYMENT_TYPES)).required(),
    ride_id: customValidators.uuid().optional(),
    group_id: customValidators.uuid().optional(),
    rental_id: customValidators.uuid().optional(),
    recipient_id: customValidators.uuid().optional(),
    metadata: Joi.object().optional()
  }),

  // Booking schemas
  rentalBooking: Joi.object({
    start_date: Joi.date().greater('now').required(),
    end_date: Joi.date().greater(Joi.ref('start_date')).required(),
    message: Joi.string().max(500).optional(),
    delivery_required: Joi.boolean().default(false),
    delivery_address: Joi.when('delivery_required', {
      is: true,
      then: customValidators.location().required(),
      otherwise: Joi.optional()
    })
  }),

  // Rating schemas
  rateItem: Joi.object({
    rating: customValidators.rating().required(),
    review: Joi.string().max(1000).optional(),
    images: Joi.array().items(Joi.string().uri()).max(5).optional()
  }),

  // Invitation schemas
  sendInvitation: Joi.object({
    user_ids: customValidators.uuidArray().optional(),
    phone_numbers: customValidators.phoneArray().optional(),
    message: Joi.string().max(500).optional()
  }).or('user_ids', 'phone_numbers'),

  // Emergency contact schema
  emergencyContact: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    phone: customValidators.phoneNumber().required(),
    relationship: Joi.string().max(50).optional(),
    email: customValidators.email().optional(),
    address: Joi.string().max(200).optional()
  }),

  // File upload schema
  fileUpload: Joi.object({
    file_type: Joi.string().valid('image', 'document', 'audio', 'video').required(),
    max_size: Joi.number().integer().min(1).optional(),
    allowed_formats: Joi.array().items(Joi.string()).optional()
  }),

  // Settings schema
  userSettings: Joi.object({
    notifications: Joi.object({
      email_enabled: Joi.boolean().default(true),
      sms_enabled: Joi.boolean().default(true),
      push_enabled: Joi.boolean().default(true),
      ride_reminders: Joi.boolean().default(true),
      group_updates: Joi.boolean().default(true),
      rental_alerts: Joi.boolean().default(true),
      payment_confirmations: Joi.boolean().default(true)
    }).optional(),
    privacy: Joi.object({
      profile_visibility: Joi.string().valid('public', 'friends', 'private').default('public'),
      location_sharing: Joi.boolean().default(true),
      contact_visibility: Joi.boolean().default(false),
      ride_history_visible: Joi.boolean().default(true)
    }).optional(),
    preferences: Joi.object({
      default_currency: customValidators.currency().optional(),
      distance_unit: Joi.string().valid('km', 'miles').default('km'),
      time_format: Joi.string().valid('12h', '24h').default('24h'),
      language: Joi.string().length(2).default('en')
    }).optional()
  }),

  // Advanced search schema
  advancedSearch: Joi.object({
    query: Joi.string().min(1).max(100).optional(),
    filters: Joi.object({
      category: Joi.string().optional(),
      location: customValidators.location().optional(),
      radius: Joi.number().integer().min(1).max(200).default(50),
      price_range: Joi.object({
        min: customValidators.price().optional(),
        max: customValidators.price().optional()
      }).optional(),
      date_range: Joi.object({
        start: Joi.date().optional(),
        end: Joi.date().min(Joi.ref('start')).optional()
      }).optional(),
      rating_min: customValidators.rating().optional(),
      tags: Joi.array().items(Joi.string()).optional(),
      features: Joi.array().items(Joi.string()).optional()
    }).optional(),
    sort: Joi.object({
      field: Joi.string().valid('created_at', 'updated_at', 'price', 'rating', 'distance', 'name', 'date').default('created_at'),
      order: Joi.string().valid('ASC', 'DESC').default('DESC')
    }).optional(),
    pagination: customValidators.pagination().optional()
  })
};

// Validation helper functions
const validateRequest = (schema, data) => {
  const { error, value } = schema.validate(data, { abortEarly: false });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      code: detail.type
    }));
    return { isValid: false, errors, data: null };
  }
  
  return { isValid: true, errors: null, data: value };
};

const validateAsync = async (schema, data) => {
  try {
    const value = await schema.validateAsync(data, { abortEarly: false });
    return { isValid: true, errors: null, data: value };
  } catch (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      code: detail.type
    }));
    return { isValid: false, errors, data: null };
  }
};

// Sanitization helpers
const sanitizeString = (str, maxLength = 1000) => {
  if (typeof str !== 'string') return str;
  
  return str
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, maxLength);
};

const sanitizeObject = (obj, fieldsToSanitize = []) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = { ...obj };
  
  fieldsToSanitize.forEach(field => {
    if (sanitized[field] && typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeString(sanitized[field]);
    }
  });
  
  return sanitized;
};

module.exports = {
  customValidators,
  extendedSchemas,
  validateRequest,
  validateAsync,
  sanitizeString,
  sanitizeObject
};