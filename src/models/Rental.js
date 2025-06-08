const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Rental = sequelize.define('Rental', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: [3, 100]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    category: {
      type: DataTypes.ENUM(
        'bike_gear', 'camping', 'electronics', 'tools', 
        'clothing', 'accessories', 'safety_gear', 'other'
      ),
      allowNull: false
    },
    subcategory: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    images: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: []
    },
    condition: {
      type: DataTypes.ENUM('new', 'like_new', 'good', 'fair', 'poor'),
      allowNull: false
    },
    price_per_day: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    price_per_week: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    price_per_month: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'INR'
    },
    security_deposit: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false
      // Remove references - handle through associations in index file
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: false,
      validate: {
        isValidLocation(value) {
          if (!value.latitude || !value.longitude || !value.address) {
            throw new Error('Location must have latitude, longitude, and address');
          }
        }
      }
    },
    availability: {
      type: DataTypes.JSONB,
      defaultValue: {
        available_from: null,
        available_until: null,
        blocked_dates: [],
        min_rental_days: 1,
        max_rental_days: 30
      }
    },
    specifications: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    rental_terms: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    pickup_options: {
      type: DataTypes.JSONB,
      defaultValue: ['pickup'],
      validate: {
        isValidPickupOptions(value) {
          if (!Array.isArray(value)) {
            throw new Error('Pickup options must be an array');
          }
          const validOptions = ['pickup', 'delivery', 'meet_location'];
          const invalidOptions = value.filter(option => !validOptions.includes(option));
          if (invalidOptions.length > 0) {
            throw new Error(`Invalid pickup options: ${invalidOptions.join(', ')}`);
          }
        }
      }
    },
    delivery_radius_km: {
      type: DataTypes.INTEGER,
      defaultValue: 10,
      validate: {
        min: 0,
        max: 100
      }
    },
    delivery_fee: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    is_available: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'rented', 'maintenance'),
      defaultValue: 'active'
    },
    rating: {
      type: DataTypes.DECIMAL(3, 2),
      defaultValue: 0,
      validate: {
        min: 0,
        max: 5
      }
    },
    total_ratings: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    total_bookings: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  }, {
    tableName: 'rentals',
    indexes: [
      {
        fields: ['owner_id']
      },
      {
        fields: ['category']
      },
      {
        fields: ['status']
      },
      {
        fields: ['is_available']
      },
      {
        fields: ['location'],
        using: 'gin'
      },
      {
        fields: ['price_per_day']
      },
      {
        fields: ['rating']
      }
    ]
  });

  // Instance methods
  Rental.prototype.canEdit = function(userId) {
    return this.owner_id === userId;
  };

  Rental.prototype.canBook = function() {
    return this.is_available && this.status === 'active';
  };

  Rental.prototype.calculatePrice = function(days) {
    if (days >= 30 && this.price_per_month) {
      const months = Math.floor(days / 30);
      const remainingDays = days % 30;
      return (months * this.price_per_month) + (remainingDays * this.price_per_day);
    } else if (days >= 7 && this.price_per_week) {
      const weeks = Math.floor(days / 7);
      const remainingDays = days % 7;
      return (weeks * this.price_per_week) + (remainingDays * this.price_per_day);
    } else {
      return days * this.price_per_day;
    }
  };

  // Helper method to check if a pickup option is available
  Rental.prototype.hasPickupOption = function(option) {
    return this.pickup_options && this.pickup_options.includes(option);
  };

  // Helper method to add a pickup option
  Rental.prototype.addPickupOption = function(option) {
    const validOptions = ['pickup', 'delivery', 'meet_location'];
    if (!validOptions.includes(option)) {
      throw new Error(`Invalid pickup option: ${option}`);
    }
    if (!this.pickup_options) {
      this.pickup_options = [];
    }
    if (!this.pickup_options.includes(option)) {
      this.pickup_options.push(option);
    }
  };

  // Helper method to remove a pickup option
  Rental.prototype.removePickupOption = function(option) {
    if (this.pickup_options) {
      this.pickup_options = this.pickup_options.filter(opt => opt !== option);
    }
  };

  return Rental;
};