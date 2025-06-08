const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Group = sequelize.define('Group', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
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
    cover_image: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    group_type: {
      type: DataTypes.ENUM('public', 'private', 'invite_only'),
      defaultValue: 'public'
    },
    is_paid: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    membership_fee: {
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
    max_members: {
      type: DataTypes.INTEGER,
      defaultValue: 100,
      validate: {
        min: 1,
        max: 1000
      }
    },
    current_members: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      validate: {
        min: 0
      }
    },
    admin_id: {
      type: DataTypes.UUID,
      allowNull: false
      // Remove references - handle through associations in index file
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    rules: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {
        allow_member_invite: true,
        require_approval: false,
        auto_approve_rides: false
      }
    }
  }, {
    tableName: 'groups',
    indexes: [
      {
        fields: ['admin_id']
      },
      {
        fields: ['group_type']
      },
      {
        fields: ['is_paid']
      },
      {
        fields: ['location'],
        using: 'gin'
      },
      {
        fields: ['tags'],
        using: 'gin'
      }
    ]
  });

  // Instance methods
  Group.prototype.canJoin = function() {
    return this.current_members < this.max_members && 
           this.is_active;
  };

  Group.prototype.isFull = function() {
    return this.current_members >= this.max_members;
  };

  Group.prototype.canEdit = function(userId) {
    return this.admin_id === userId;
  };

  Group.prototype.requiresPayment = function() {
    return this.is_paid && this.membership_fee > 0;
  };

  return Group;
};