const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    phone_number: {
      type: DataTypes.STRING(15),
      allowNull: false,
      unique: true,
      validate: {
        isNumeric: true,
        len: [10, 15]
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [6, 100]
      }
    },
    first_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    last_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    profile_picture: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    cover_picture: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    totalRides: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    totalDistance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    safetyScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    avg_rating: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    emergency_contact: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    bike_info: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    last_active: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    verification_code: {
      type: DataTypes.STRING(6),
      allowNull: true
    },
    verification_expires: {
      type: DataTypes.DATE,
      allowNull: true
    },
    reset_password_token: {
      type: DataTypes.STRING,
      allowNull: true
    },
    reset_password_expires: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          user.password = await bcrypt.hash(user.password, 12);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          user.password = await bcrypt.hash(user.password, 12);
        }
      }
    },
    tableName: 'users',
    indexes: [
      {
        fields: ['phone_number']
      },
      {
        fields: ['email']
      },
      {
        fields: ['location'],
        using: 'gin'
      },
      {
        fields: ['last_active']
      },
      {
        fields: ['is_active']
      },
      // For search functionality
      {
        fields: ['first_name', 'last_name']
      }
    ]
  });

  // Instance methods
  User.prototype.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
  };

  User.prototype.toJSON = function() {
    const values = { ...this.get() };
    delete values.password;
    delete values.verification_code;
    delete values.reset_password_token;
    return values;
  };

  User.prototype.getFullName = function() {
    return `${this.first_name} ${this.last_name}`;
  };

  User.prototype.isOnline = function() {
    // Consider user online if last active within 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return this.last_active > fiveMinutesAgo;
  };

  User.prototype.getPublicProfile = function() {
    return {
      id: this.id,
      first_name: this.first_name,
      last_name: this.last_name,
      profile_picture: this.profile_picture,
      bio: this.bio,
      totalRides: this.totalRides,
      totalDistance: this.totalDistance,
      avg_rating: this.avg_rating,
      last_active: this.last_active,
      is_online: this.isOnline()
    };
  };

  return User;
};