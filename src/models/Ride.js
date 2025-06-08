const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Ride = sequelize.define('Ride', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: [3, 100],
        notEmpty: true
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    cover_image: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    start_location: {
      type: DataTypes.JSONB,
      allowNull: false,
      validate: {
        isValidLocation(value) {
          if (!value || typeof value !== 'object') {
            throw new Error('Start location must be an object');
          }
          if (!value.latitude || !value.longitude || !value.address) {
            throw new Error('Start location must have latitude, longitude, and address');
          }
          // Validate latitude and longitude ranges
          const lat = parseFloat(value.latitude);
          const lng = parseFloat(value.longitude);
          if (lat < -90 || lat > 90) {
            throw new Error('Invalid latitude for start location');
          }
          if (lng < -180 || lng > 180) {
            throw new Error('Invalid longitude for start location');
          }
        }
      }
    },
    end_location: {
      type: DataTypes.JSONB,
      allowNull: false,
      validate: {
        isValidLocation(value) {
          if (!value || typeof value !== 'object') {
            throw new Error('End location must be an object');
          }
          if (!value.latitude || !value.longitude || !value.address) {
            throw new Error('End location must have latitude, longitude, and address');
          }
          // Validate latitude and longitude ranges
          const lat = parseFloat(value.latitude);
          const lng = parseFloat(value.longitude);
          if (lat < -90 || lat > 90) {
            throw new Error('Invalid latitude for end location');
          }
          if (lng < -180 || lng > 180) {
            throw new Error('Invalid longitude for end location');
          }
        }
      }
    },
    waypoints: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      validate: {
        isValidWaypoints(value) {
          if (value && Array.isArray(value)) {
            value.forEach((waypoint, index) => {
              if (!waypoint.latitude || !waypoint.longitude || !waypoint.address) {
                throw new Error(`Waypoint ${index + 1} must have latitude, longitude, and address`);
              }
              const lat = parseFloat(waypoint.latitude);
              const lng = parseFloat(waypoint.longitude);
              if (lat < -90 || lat > 90) {
                throw new Error(`Invalid latitude for waypoint ${index + 1}`);
              }
              if (lng < -180 || lng > 180) {
                throw new Error(`Invalid longitude for waypoint ${index + 1}`);
              }
            });
          }
        }
      }
    },
    ride_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      validate: {
        isDate: true,
        isAfterToday(value) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const rideDate = new Date(value);
          rideDate.setHours(0, 0, 0, 0);
          if (rideDate < today) {
            throw new Error('Ride date must be today or in the future');
          }
        }
      }
    },
    ride_time: {
      type: DataTypes.TIME,
      allowNull: false,
      validate: {
        isValidTime(value) {
          const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
          if (!timeRegex.test(value)) {
            throw new Error('Invalid time format. Use HH:MM format');
          }
        }
      }
    },
    max_participants: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10,
      validate: {
        min: 1,
        max: 100,
        isInt: true
      }
    },
    current_participants: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      validate: {
        min: 0,
        isInt: true,
        notExceedMax(value) {
          if (this.max_participants && value > this.max_participants) {
            throw new Error('Current participants cannot exceed maximum participants');
          }
        }
      }
    },
    is_paid: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
        // Removed the isValidPrice validation as it causes circular reference issues
      }
    },
    pricing_options: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      validate: {
        isValidPricingOptions(value) {
          if (value && typeof value === 'object') {
            const { with_bike, without_bike } = value;
            if (with_bike !== undefined && with_bike !== null && with_bike !== '') {
              const withBikePrice = parseFloat(with_bike);
              if (isNaN(withBikePrice) || withBikePrice < 0) {
                throw new Error('Invalid price for with_bike option');
              }
            }
            if (without_bike !== undefined && without_bike !== null && without_bike !== '') {
              const withoutBikePrice = parseFloat(without_bike);
              if (isNaN(withoutBikePrice) || withoutBikePrice < 0) {
                throw new Error('Invalid price for without_bike option');
              }
            }
          }
        }
      }
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'INR',
      validate: {
        isIn: [['INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']]
      }
    },
    status: {
      type: DataTypes.ENUM('upcoming', 'ongoing', 'completed', 'cancelled'),
      defaultValue: 'upcoming'
    },
    visibility: {
      type: DataTypes.ENUM('public', 'group_only', 'private'),
      defaultValue: 'public'
    },
    creator_id: {
      type: DataTypes.UUID,
      allowNull: false,
      validate: {
        isUUID: 4
      }
    },
    group_id: {
      type: DataTypes.UUID,
      allowNull: true,
      validate: {
        isUUID: 4
      }
    },
    requirements: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {
        min_age: null,
        max_age: null,
        experience_level: null,
        fitness_level: null,
        bike_type: null,
        license_required: false,
        helmet_required: true,
        insurance_required: false
      },
      validate: {
        isValidRequirements(value) {
          if (value && typeof value === 'object') {
            const { min_age, max_age, experience_level, fitness_level, bike_type } = value;
            
            if (min_age !== null && min_age !== undefined && min_age !== '') {
              const minAge = parseInt(min_age);
              if (isNaN(minAge) || minAge < 0 || minAge > 120) {
                throw new Error('Invalid minimum age');
              }
            }
            
            if (max_age !== null && max_age !== undefined && max_age !== '') {
              const maxAge = parseInt(max_age);
              if (isNaN(maxAge) || maxAge < 0 || maxAge > 120) {
                throw new Error('Invalid maximum age');
              }
            }
            
            if (min_age && max_age && parseInt(min_age) > parseInt(max_age)) {
              throw new Error('Minimum age cannot be greater than maximum age');
            }
            
            const validExperienceLevels = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
            if (experience_level && experience_level !== '' && !validExperienceLevels.includes(experience_level)) {
              throw new Error('Invalid experience level');
            }
            
            const validFitnessLevels = ['Low', 'Moderate', 'High', 'Extreme'];
            if (fitness_level && fitness_level !== '' && !validFitnessLevels.includes(fitness_level)) {
              throw new Error('Invalid fitness level');
            }
            
            const validBikeTypes = ['Any', 'Cruiser', 'Sport', 'Touring', 'Adventure', 'Scooter', 'Electric'];
            if (bike_type && bike_type !== '' && !validBikeTypes.includes(bike_type)) {
              throw new Error('Invalid bike type');
            }
          }
        }
      }
    },
    rules: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 2000]
      }
    },
    emergency_contacts: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      validate: {
        isValidEmergencyContacts(value) {
          if (value && Array.isArray(value)) {
            value.forEach((contact, index) => {
              if (!contact.name || !contact.phone) {
                throw new Error(`Emergency contact ${index + 1} must have name and phone`);
              }
              // More flexible phone validation
              const phoneRegex = /^[\+]?[1-9][\d\s\-\(\)]{8,15}$/;
              if (!phoneRegex.test(contact.phone)) {
                throw new Error(`Invalid phone number for emergency contact ${index + 1}`);
              }
            });
          }
        }
      }
    },
    amenities: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      validate: {
        isValidAmenities(value) {
          if (value && Array.isArray(value)) {
            const validAmenities = [
              'parking', 'food', 'fuel', 'mechanic', 'restroom', 
              'medical', 'photography', 'camping', 'wifi', 'charging'
            ];
            const invalidAmenities = value.filter(amenity => !validAmenities.includes(amenity));
            if (invalidAmenities.length > 0) {
              throw new Error(`Invalid amenities: ${invalidAmenities.join(', ')}`);
            }
          }
        }
      }
    },
    weather_conditions: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    distance_km: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      validate: {
        min: 0,
        max: 10000
      }
    },
    estimated_duration_hours: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      validate: {
        min: 0,
        max: 168
      }
    },
    route_polyline: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encoded polyline for route visualization'
    }
  }, {
    tableName: 'rides',
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        fields: ['creator_id']
      },
      {
        fields: ['group_id']
      },
      {
        fields: ['ride_date']
      },
      {
        fields: ['status']
      },
      {
        fields: ['visibility']
      },
      {
        fields: ['is_paid']
      },
      {
        fields: ['ride_date', 'status']
      },
      {
        fields: ['start_location'],
        using: 'gin'
      },
      {
        fields: ['end_location'],
        using: 'gin'
      },
      {
        fields: ['waypoints'],
        using: 'gin'
      },
      {
        fields: ['requirements'],
        using: 'gin'
      },
      {
        fields: ['amenities'],
        using: 'gin'
      }
    ],
    hooks: {
      beforeValidate: (ride, options) => {
        if (ride.isNewRecord && !ride.current_participants) {
          ride.current_participants = 1;
        }
        
        // Additional validation for paid rides
        if (ride.is_paid) {
          const hasGeneralPrice = ride.price && parseFloat(ride.price) > 0;
          const hasPricingOptions = ride.pricing_options && 
            (parseFloat(ride.pricing_options.with_bike) > 0 || parseFloat(ride.pricing_options.without_bike) > 0);
          
          if (!hasGeneralPrice && !hasPricingOptions) {
            throw new Error('Paid rides must have either a general price or specific pricing options');
          }
        }
      },
      beforeUpdate: (ride, options) => {
        if (ride.status !== 'upcoming' && ride.changed()) {
          const allowedChanges = ['status', 'current_participants'];
          const changedFields = ride.changed();
          const unauthorizedChanges = changedFields.filter(field => !allowedChanges.includes(field));
          
          if (unauthorizedChanges.length > 0) {
            throw new Error(`Cannot modify ${unauthorizedChanges.join(', ')} for ${ride.status} rides`);
          }
        }
      }
    }
  });

  // Instance methods
  Ride.prototype.canJoin = function() {
    return this.current_participants < this.max_participants && 
           this.status === 'upcoming' &&
           new Date(this.ride_date) >= new Date().toDateString();
  };

  Ride.prototype.isFull = function() {
    return this.current_participants >= this.max_participants;
  };

  Ride.prototype.canEdit = function(userId) {
    return this.creator_id === userId && 
           this.status === 'upcoming' &&
           new Date(this.ride_date) >= new Date().toDateString();
  };

  Ride.prototype.canCancel = function(userId) {
    return this.creator_id === userId && 
           this.status === 'upcoming' &&
           new Date(this.ride_date) >= new Date().toDateString();
  };

  Ride.prototype.getParticipationRate = function() {
    return (this.current_participants / this.max_participants * 100).toFixed(2);
  };

  Ride.prototype.getRemainingSlots = function() {
    return this.max_participants - this.current_participants;
  };

  Ride.prototype.isUpcoming = function() {
    const now = new Date();
    const rideDateTime = new Date(`${this.ride_date}T${this.ride_time}`);
    return rideDateTime > now && this.status === 'upcoming';
  };

  Ride.prototype.isPastDue = function() {
    const now = new Date();
    const rideDateTime = new Date(`${this.ride_date}T${this.ride_time}`);
    return rideDateTime < now;
  };

  Ride.prototype.getFormattedPrice = function() {
    if (!this.is_paid) return 'Free';
    
    const currencySymbols = {
      'INR': '₹',
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥',
      'CAD': 'C$',
      'AUD': 'A$'
    };
    
    const symbol = currencySymbols[this.currency] || this.currency;
    
    if (this.pricing_options && (this.pricing_options.with_bike || this.pricing_options.without_bike)) {
      let priceText = '';
      if (this.pricing_options.with_bike) {
        priceText += `${symbol}${this.pricing_options.with_bike} (with bike)`;
      }
      if (this.pricing_options.without_bike) {
        if (priceText) priceText += ' / ';
        priceText += `${symbol}${this.pricing_options.without_bike} (without bike)`;
      }
      return priceText;
    }
    
    return this.price ? `${symbol}${this.price}` : 'Price on request';
  };

  // Class methods
  Ride.findUpcoming = function(limit = 10) {
    const today = new Date().toISOString().split('T')[0];
    return this.findAll({
      where: {
        ride_date: {
          [sequelize.Sequelize.Op.gte]: today
        },
        status: 'upcoming'
      },
      order: [['ride_date', 'ASC'], ['ride_time', 'ASC']],
      limit
    });
  };

  Ride.findByLocation = function(latitude, longitude, radiusKm = 50) {
    return this.findAll({
      where: {
        status: 'upcoming'
      }
    });
  };

  return Ride;
};