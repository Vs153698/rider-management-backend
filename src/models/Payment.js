const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Payment = sequelize.define('Payment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    transaction_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true
    },
    cashfree_order_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true
    },
    cashfree_payment_id: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'INR'
    },
    payment_type: {
      type: DataTypes.ENUM('ride_fee', 'group_membership', 'rental_payment', 'security_deposit'),
      allowNull: false
    },
    payment_method: {
      type: DataTypes.ENUM('card', 'upi', 'netbanking', 'wallet'),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'success', 'failed', 'cancelled', 'refunded'),
      defaultValue: 'pending'
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false
      // Remove references - handle through associations in index file
    },
    ride_id: {
      type: DataTypes.UUID,
      allowNull: true
      // Remove references - handle through associations in index file
    },
    group_id: {
      type: DataTypes.UUID,
      allowNull: true
      // Remove references - handle through associations in index file
    },
    rental_id: {
      type: DataTypes.UUID,
      allowNull: true
      // Remove references - handle through associations in index file
    },
    recipient_id: {
      type: DataTypes.UUID,
      allowNull: true
      // Remove references - handle through associations in index file
    },
    gateway_response: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    failure_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    refund_amount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    refund_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    refunded_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'payments',
    indexes: [
      {
        fields: ['user_id']
      },
      {
        fields: ['ride_id']
      },
      {
        fields: ['group_id']
      },
      {
        fields: ['rental_id']
      },
      {
        fields: ['recipient_id']
      },
      {
        fields: ['transaction_id']
      },
      {
        fields: ['cashfree_order_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['payment_type']
      },
      {
        fields: ['created_at']
      }
    ]
  });

  // Instance methods
  Payment.prototype.canRefund = function() {
    return this.status === 'success' && this.refund_amount < this.amount;
  };

  Payment.prototype.isExpired = function() {
    return this.expires_at && new Date() > new Date(this.expires_at);
  };

  Payment.prototype.canCancel = function() {
    return ['pending', 'processing'].includes(this.status) && !this.isExpired();
  };

  Payment.prototype.markAsProcessed = function() {
    this.status = 'success';
    this.processed_at = new Date();
  };

  Payment.prototype.markAsFailed = function(reason) {
    this.status = 'failed';
    this.failure_reason = reason;
  };

  return Payment;
};