const Joi = require('joi');

const validate = (schema) => {
  return (req, res, next) => {
    console.log('Validating request body:', req.body);
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors
      });
    }
    
    next();
  };
};

const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.query, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        status: 'error',
        message: 'Query validation failed',
        errors
      });
    }
    
    next();
  };
};

// Common validation schemas
const schemas = {
  // User schemas
  userRegistration: Joi.object({
    phone_number: Joi.string().pattern(/^\d{10,15}$/).required(),
    email: Joi.string().email().optional(),
    password: Joi.string().min(6).max(100).required(),
    first_name: Joi.string().min(2).max(50).required(),
    last_name: Joi.string().min(2).max(50).required(),
    verification_code: Joi.string().length(6).required()
  }),

  userLogin: Joi.object({
    phone_number: Joi.string().pattern(/^\d{10,15}$/).required(),
    password: Joi.string().required()
  }),

  phoneVerification: Joi.object({
    phone_number: Joi.string().pattern(/^\d{10,15}$/).required()
  }),
  
  otpVerification: Joi.object({
    phone_number: Joi.string().pattern(/^\d{10,15}$/).required(),
    code: Joi.string().length(6).required()
  }),

  updateProfile: Joi.object({
    first_name: Joi.string().min(2).max(50).optional(),
    last_name: Joi.string().min(2).max(50).optional(),
    email: Joi.string().email().optional(),
    phone_number: Joi.string().pattern(/^\d{10,15}$/).optional(),
    bio: Joi.string().max(500).optional(),
    profile_picture: Joi.string().uri().optional().allow(null),
    cover_picture: Joi.string().uri().optional().allow(null),
    location: Joi.object({
      city: Joi.string().max(100).optional(),
      state: Joi.string().max(100).optional(),
      country: Joi.string().max(100).optional()
    }).optional(),
    bike_info: Joi.object({
      bike_name: Joi.string().max(100).optional(),
      making: Joi.string().max(100).optional(),
      cc: Joi.string().pattern(/^\d+$/).optional(),
      year: Joi.string().pattern(/^\d{4}$/).optional(),
      color: Joi.string().max(50).optional(),
      licenseNumber: Joi.string().max(20).optional(),
    }).optional(),
    emergency_contact: Joi.object({
      contact_number: Joi.string().pattern(/^\d{10,15}$/).optional(),
      blood_group: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-').optional(),
      email: Joi.string().email().optional().allow(''),
      address: Joi.string().max(500).optional().allow(''),
    }).optional()
  }),

  // Ride schemas - COMPLETE VERSION WITH ALL COMPONENT FIELDS
  createRide: Joi.object({
    // Basic Information
    title: Joi.string().min(3).max(100).required().messages({
      'string.min': 'Title must be at least 3 characters long',
      'string.max': 'Title cannot exceed 100 characters',
      'any.required': 'Title is required'
    }),
    
    description: Joi.string().max(1000).optional().allow('').messages({
      'string.max': 'Description cannot exceed 1000 characters'
    }),

    // Location Information
    start_location: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      address: Joi.string().min(1).required()
    }).required().messages({
      'any.required': 'Start location is required'
    }),

    end_location: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      address: Joi.string().min(1).required()
    }).required().messages({
      'any.required': 'End location is required'
    }),

    waypoints: Joi.array().items(Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      address: Joi.string().min(1).required()
    })).optional().default([]),

    // Distance and Duration (auto-calculated but can be manually set)
    distance_km: Joi.alternatives().try(
      Joi.number().min(0).max(10000),
      Joi.string().allow('')
    ).optional().messages({
      'number.min': 'Distance cannot be negative',
      'number.max': 'Distance cannot exceed 10,000 km'
    }),

    estimated_duration_hours: Joi.alternatives().try(
      Joi.number().min(0).max(168),
      Joi.string().allow('')
    ).optional().messages({
      'number.min': 'Duration cannot be negative',
      'number.max': 'Duration cannot exceed 168 hours (1 week)'
    }),

    // Schedule
    ride_date: Joi.date().greater('now').required().messages({
      'date.greater': 'Ride date must be in the future',
      'any.required': 'Ride date is required'
    }),

    ride_time: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required().messages({
      'string.pattern.base': 'Time must be in HH:MM format',
      'any.required': 'Ride time is required'
    }),

    // Participants and Pricing
    max_participants: Joi.alternatives().try(
      Joi.number().integer().min(1).max(100),
      Joi.string().pattern(/^\d+$/).custom((value, helpers) => {
        const num = parseInt(value);
        if (num < 1 || num > 100) {
          return helpers.error('number.range');
        }
        return num;
      })
    ).required().messages({
      'number.min': 'At least 1 participant is required',
      'number.max': 'Maximum 100 participants allowed',
      'number.range': 'Participants must be between 1 and 100',
      'any.required': 'Maximum participants count is required'
    }),

    is_paid: Joi.boolean().optional().default(false),

    price: Joi.alternatives().try(
      Joi.number().min(0),
      Joi.string().allow('').custom((value, helpers) => {
        if (value === '') return value;
        const num = parseFloat(value);
        if (isNaN(num) || num < 0) {
          return helpers.error('number.invalid');
        }
        return num;
      })
    ).when('is_paid', {
      is: true,
      then: Joi.alternatives().conditional('pricing_options', {
        is: Joi.object().keys({
          with_bike: Joi.alternatives().try(Joi.number().min(0), Joi.string().allow('')),
          without_bike: Joi.alternatives().try(Joi.number().min(0), Joi.string().allow(''))
        }).or('with_bike', 'without_bike'),
        then: Joi.optional(),
        otherwise: Joi.required()
      }),
      otherwise: Joi.optional()
    }).messages({
      'number.min': 'Price cannot be negative',
      'number.invalid': 'Invalid price format',
      'any.required': 'Price is required for paid rides (or use pricing options)'
    }),

    pricing_options: Joi.object({
      with_bike: Joi.alternatives().try(
        Joi.number().min(0),
        Joi.string().allow('').custom((value, helpers) => {
          if (value === '') return value;
          const num = parseFloat(value);
          if (isNaN(num) || num < 0) {
            return helpers.error('number.invalid');
          }
          return num;
        })
      ).optional().messages({
        'number.min': 'Price with bike cannot be negative',
        'number.invalid': 'Invalid price format for with bike'
      }),
      without_bike: Joi.alternatives().try(
        Joi.number().min(0),
        Joi.string().allow('').custom((value, helpers) => {
          if (value === '') return value;
          const num = parseFloat(value);
          if (isNaN(num) || num < 0) {
            return helpers.error('number.invalid');
          }
          return num;
        })
      ).optional().messages({
        'number.min': 'Price without bike cannot be negative',
        'number.invalid': 'Invalid price format for without bike'
      })
    }).optional().default({}),

    currency: Joi.string().valid('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD').optional().default('INR').messages({
      'any.only': 'Currency must be one of INR, USD, EUR, GBP, JPY, CAD, AUD'
    }),

    // Group Selection (Optional)
    group_id: Joi.alternatives().try(
      Joi.string().uuid(),
      Joi.allow(null)
    ).optional().messages({
      'string.guid': 'Group ID must be a valid UUID'
    }),

    // Visibility
    visibility: Joi.string().valid('public', 'group_only', 'private').optional().default('public').messages({
      'any.only': 'Visibility must be public, group_only, or private'
    }),

    // Requirements
    requirements: Joi.object({
      min_age: Joi.alternatives().try(
        Joi.number().integer().min(0).max(120),
        Joi.string().allow('').custom((value, helpers) => {
          if (value === '') return null;
          const num = parseInt(value);
          if (isNaN(num) || num < 0 || num > 120) {
            return helpers.error('number.range');
          }
          return num;
        })
      ).optional().messages({
        'number.min': 'Minimum age cannot be negative',
        'number.max': 'Minimum age cannot exceed 120',
        'number.range': 'Minimum age must be between 0 and 120'
      }),
      max_age: Joi.alternatives().try(
        Joi.number().integer().min(0).max(120),
        Joi.string().allow('').custom((value, helpers) => {
          if (value === '') return null;
          const num = parseInt(value);
          if (isNaN(num) || num < 0 || num > 120) {
            return helpers.error('number.range');
          }
          return num;
        })
      ).optional().messages({
        'number.min': 'Maximum age cannot be negative',
        'number.max': 'Maximum age cannot exceed 120',
        'number.range': 'Maximum age must be between 0 and 120'
      }),
      experience_level: Joi.string().valid('Beginner', 'Intermediate', 'Advanced', 'Expert').optional().allow('').messages({
        'any.only': 'Experience level must be Beginner, Intermediate, Advanced, or Expert'
      }),
      fitness_level: Joi.string().valid('Low', 'Moderate', 'High', 'Extreme').optional().allow('').messages({
        'any.only': 'Fitness level must be Low, Moderate, High, or Extreme'
      }),
      bike_type: Joi.string().valid('Any', 'Cruiser', 'Sport', 'Touring', 'Adventure', 'Scooter', 'Electric').optional().allow('').messages({
        'any.only': 'Bike type must be Any, Cruiser, Sport, Touring, Adventure, Scooter, or Electric'
      }),
      license_required: Joi.boolean().optional().default(false),
      helmet_required: Joi.boolean().optional().default(true),
      insurance_required: Joi.boolean().optional().default(false)
    }).optional().default({
      min_age: null,
      max_age: null,
      experience_level: null,
      fitness_level: null,
      bike_type: null,
      license_required: false,
      helmet_required: true,
      insurance_required: false
    }).custom((value, helpers) => {
      // Custom validation: min_age should be less than max_age
      if (value.min_age && value.max_age && parseInt(value.min_age) > parseInt(value.max_age)) {
        return helpers.error('custom.ageRange');
      }
      return value;
    }).messages({
      'custom.ageRange': 'Minimum age cannot be greater than maximum age'
    }),

    // Emergency Contacts
    emergency_contacts: Joi.array().items(Joi.object({
      name: Joi.string().min(1).max(100).required().messages({
        'string.min': 'Contact name is required',
        'string.max': 'Contact name cannot exceed 100 characters',
        'any.required': 'Contact name is required'
      }),
      phone: Joi.string().pattern(/^[\+]?[1-9][\d\s\-\(\)]{8,15}$/).required().messages({
        'string.pattern.base': 'Invalid phone number format',
        'any.required': 'Contact phone is required'
      }),
      relation: Joi.string().max(50).optional().allow('').messages({
        'string.max': 'Relation cannot exceed 50 characters'
      })
    })).optional().default([]),

    // Amenities
    amenities: Joi.array().items(
      Joi.string().valid('parking', 'food', 'fuel', 'mechanic', 'restroom', 'medical', 'photography', 'camping', 'wifi', 'charging').messages({
        'any.only': 'Invalid amenity type'
      })
    ).unique().optional().default([]).messages({
      'array.unique': 'Duplicate amenities are not allowed'
    }),

    // Rules and Guidelines
    rules: Joi.string().max(1000).optional().allow('').messages({
      'string.max': 'Rules cannot exceed 1000 characters'
    })

    // Note: cover_image is handled separately through multer middleware
    // Note: creator_id is set from authenticated user token
    // Note: current_participants, status, id are auto-generated
  }).custom((value, helpers) => {
    // Custom validation for paid rides
    if (value.is_paid) {
      const hasGeneralPrice = value.price && parseFloat(value.price) > 0;
      const hasPricingOptions = value.pricing_options && 
        (parseFloat(value.pricing_options.with_bike) > 0 || parseFloat(value.pricing_options.without_bike) > 0);
      
      if (!hasGeneralPrice && !hasPricingOptions) {
        return helpers.error('custom.paidRidePrice');
      }
    }
    return value;
  }).messages({
    'custom.paidRidePrice': 'Paid rides must have either a general price or specific pricing options'
  }),

  updateRide: Joi.object({
    title: Joi.string().min(3).max(100).optional(),
    description: Joi.string().max(1000).optional(),
    ride_date: Joi.date().greater('now').optional(),
    ride_time: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    max_participants: Joi.number().integer().min(1).max(100).optional(),
    price: Joi.number().min(0).optional(),
    visibility: Joi.string().valid('public', 'group_only', 'private').optional(),
    requirements: Joi.object().optional(),
    rules: Joi.string().max(1000).optional()
  }),

  // Group schemas
  createGroup: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(1000).optional(),
    cover_image: Joi.string().uri().optional().allow(null),
    group_type: Joi.string().valid('public', 'private', 'invite_only').optional(),
    is_paid: Joi.boolean().optional(),
    membership_fee: Joi.when('is_paid', {
      is: true,
      then: Joi.number().min(0).required(),
      otherwise: Joi.optional()
    }),
    max_members: Joi.number().integer().min(1).max(1000).optional(),
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      address: Joi.string().required()
    }).optional(),
    rules: Joi.string().max(2000).optional(),
    tags: Joi.array().items(Joi.string()).optional()
  }),

  // Rental schemas
  createRental: Joi.object({
    title: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(1000).optional(),
    category: Joi.string().valid(
      'bike_gear', 'camping', 'electronics', 'tools', 
      'clothing', 'accessories', 'safety_gear', 'other'
    ).required(),
    subcategory: Joi.string().max(50).optional(),
    condition: Joi.string().valid('new', 'like_new', 'good', 'fair', 'poor').required(),
    price_per_day: Joi.number().min(0).required(),
    price_per_week: Joi.number().min(0).optional(),
    price_per_month: Joi.number().min(0).optional(),
    security_deposit: Joi.number().min(0).optional(),
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      address: Joi.string().required()
    }).required(),
    availability: Joi.object({
      available_from: Joi.date().optional(),
      available_until: Joi.date().optional(),
      min_rental_days: Joi.number().integer().min(1).optional(),
      max_rental_days: Joi.number().integer().min(1).optional()
    }).optional(),
    specifications: Joi.object().optional(),
    rental_terms: Joi.string().max(2000).optional(),
    pickup_options: Joi.array().items(
      Joi.string().valid('pickup', 'delivery', 'meet_location')
    ).optional(),
    delivery_radius_km: Joi.number().integer().min(0).max(100).optional(),
    delivery_fee: Joi.number().min(0).optional()
  }),

  // Chat schemas
  sendMessage: Joi.object({
    message: Joi.string().max(2000).optional(),
    message_type: Joi.string().valid('text', 'image', 'location', 'file', 'voice').optional(),
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional(),
    reply_to_id: Joi.string().uuid().optional(),
    metadata: Joi.object().optional()
  }).or('message', 'attachment_url'),

  // Payment schemas
  createPayment: Joi.object({
    amount: Joi.number().min(0).required(),
    payment_type: Joi.string().valid('ride_fee', 'group_membership', 'rental_payment', 'security_deposit').required(),
    ride_id: Joi.string().uuid().optional(),
    group_id: Joi.string().uuid().optional(),
    rental_id: Joi.string().uuid().optional(),
    recipient_id: Joi.string().uuid().optional()
  }),

  // Query schemas
  paginationQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().optional(),
    order: Joi.string().valid('ASC', 'DESC').default('DESC')
  }),

  locationQuery: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    radius: Joi.number().min(1).max(100).default(50)
  }),

  searchQuery: Joi.object({
    q: Joi.string().min(1).max(100).optional(),
    category: Joi.string().optional(),
    status: Joi.string().optional(),
    is_paid: Joi.boolean().optional(),
    min_price: Joi.number().min(0).optional(),
    max_price: Joi.number().min(0).optional(),
    date_from: Joi.date().optional(),
    date_to: Joi.date().optional()
  })
};

module.exports = {
  validate,
  validateQuery,
  schemas
};