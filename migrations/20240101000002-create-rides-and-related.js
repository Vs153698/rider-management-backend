'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create Rides table
    await queryInterface.createTable('rides', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      title: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      cover_image: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      start_location: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      end_location: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      waypoints: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      },
      ride_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      ride_time: {
        type: Sequelize.TIME,
        allowNull: false
      },
      max_participants: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 10,
        validate: {
          min: 1,
          max: 100
        }
      },
      current_participants: {
        type: Sequelize.INTEGER,
        defaultValue: 1,
        validate: {
          min: 0
        }
      },
      is_paid: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'INR'
      },
      status: {
        type: Sequelize.ENUM('upcoming', 'ongoing', 'completed', 'cancelled'),
        defaultValue: 'upcoming'
      },
      visibility: {
        type: Sequelize.ENUM('public', 'group_only', 'private'),
        defaultValue: 'public'
      },
      creator_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'groups',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      requirements: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {}
      },
      rules: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      emergency_contacts: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      },
      weather_conditions: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      distance_km: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      estimated_duration_hours: {
        type: Sequelize.DECIMAL(4, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Create Rentals table
    await queryInterface.createTable('rentals', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      title: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      category: {
        type: Sequelize.ENUM('bike_gear', 'camping', 'electronics', 'tools', 'clothing', 'accessories', 'safety_gear', 'other'),
        allowNull: false
      },
      subcategory: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      images: {
        type: Sequelize.ARRAY(Sequelize.TEXT),
        defaultValue: []
      },
      condition: {
        type: Sequelize.ENUM('new', 'like_new', 'good', 'fair', 'poor'),
        allowNull: false
      },
      price_per_day: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0
        }
      },
      price_per_week: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      price_per_month: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'INR'
      },
      security_deposit: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        validate: {
          min: 0
        }
      },
      owner_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      location: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      availability: {
        type: Sequelize.JSONB,
        defaultValue: {
          available_from: null,
          available_until: null,
          blocked_dates: [],
          min_rental_days: 1,
          max_rental_days: 30
        }
      },
      specifications: {
        type: Sequelize.JSONB,
        defaultValue: {}
      },
      rental_terms: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      pickup_options: {
        type: Sequelize.ARRAY(Sequelize.ENUM('pickup', 'delivery', 'meet_location')),
        defaultValue: ['pickup']
      },
      delivery_radius_km: {
        type: Sequelize.INTEGER,
        defaultValue: 10,
        validate: {
          min: 0,
          max: 100
        }
      },
      delivery_fee: {
        type: Sequelize.DECIMAL(8, 2),
        defaultValue: 0,
        validate: {
          min: 0
        }
      },
      is_available: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'rented', 'maintenance'),
        defaultValue: 'active'
      },
      rating: {
        type: Sequelize.DECIMAL(3, 2),
        defaultValue: 0,
        validate: {
          min: 0,
          max: 5
        }
      },
      total_ratings: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        validate: {
          min: 0
        }
      },
      total_bookings: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        validate: {
          min: 0
        }
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Create Payments table
    await queryInterface.createTable('payments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      transaction_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
        unique: true
      },
      cashfree_order_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
        unique: true
      },
      cashfree_payment_id: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0
        }
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'INR'
      },
      payment_type: {
        type: Sequelize.ENUM('ride_fee', 'group_membership', 'rental_payment', 'security_deposit'),
        allowNull: false
      },
      payment_method: {
        type: Sequelize.ENUM('card', 'upi', 'netbanking', 'wallet'),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'success', 'failed', 'cancelled', 'refunded'),
        defaultValue: 'pending'
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      ride_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'rides',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'groups',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      rental_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'rentals',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      recipient_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      gateway_response: {
        type: Sequelize.JSONB,
        defaultValue: {}
      },
      failure_reason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      refund_amount: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        validate: {
          min: 0
        }
      },
      refund_reason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      refunded_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      processed_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {}
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Create Chats table
    await queryInterface.createTable('chats', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      message_type: {
        type: Sequelize.ENUM('text', 'image', 'location', 'file', 'voice'),
        defaultValue: 'text'
      },
      attachment_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      attachment_type: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      sender_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      ride_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'rides',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'groups',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      reply_to_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'chats',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      is_edited: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      edited_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {}
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Add comprehensive indexes for performance
    console.log('Creating indexes for rides table...');
    await queryInterface.addIndex('rides', ['creator_id'], { name: 'rides_creator_id_idx' });
    await queryInterface.addIndex('rides', ['group_id'], { name: 'rides_group_id_idx' });
    await queryInterface.addIndex('rides', ['ride_date'], { name: 'rides_ride_date_idx' });
    await queryInterface.addIndex('rides', ['status'], { name: 'rides_status_idx' });
    await queryInterface.addIndex('rides', ['visibility'], { name: 'rides_visibility_idx' });
    await queryInterface.addIndex('rides', ['is_paid'], { name: 'rides_is_paid_idx' });
    await queryInterface.addIndex('rides', ['created_at'], { name: 'rides_created_at_idx' });
    await queryInterface.addIndex('rides', ['start_location'], { 
      using: 'gin',
      name: 'rides_start_location_gin_idx'
    });
    await queryInterface.addIndex('rides', ['end_location'], { 
      using: 'gin',
      name: 'rides_end_location_gin_idx'
    });
    await queryInterface.addIndex('rides', ['waypoints'], { 
      using: 'gin',
      name: 'rides_waypoints_gin_idx'
    });

    console.log('Creating indexes for rentals table...');
    await queryInterface.addIndex('rentals', ['owner_id'], { name: 'rentals_owner_id_idx' });
    await queryInterface.addIndex('rentals', ['category'], { name: 'rentals_category_idx' });
    await queryInterface.addIndex('rentals', ['status'], { name: 'rentals_status_idx' });
    await queryInterface.addIndex('rentals', ['is_available'], { name: 'rentals_is_available_idx' });
    await queryInterface.addIndex('rentals', ['price_per_day'], { name: 'rentals_price_per_day_idx' });
    await queryInterface.addIndex('rentals', ['rating'], { name: 'rentals_rating_idx' });
    await queryInterface.addIndex('rentals', ['created_at'], { name: 'rentals_created_at_idx' });
    await queryInterface.addIndex('rentals', ['location'], { 
      using: 'gin',
      name: 'rentals_location_gin_idx'
    });

    console.log('Creating indexes for payments table...');
    await queryInterface.addIndex('payments', ['user_id'], { name: 'payments_user_id_idx' });
    await queryInterface.addIndex('payments', ['ride_id'], { name: 'payments_ride_id_idx' });
    await queryInterface.addIndex('payments', ['group_id'], { name: 'payments_group_id_idx' });
    await queryInterface.addIndex('payments', ['rental_id'], { name: 'payments_rental_id_idx' });
    await queryInterface.addIndex('payments', ['recipient_id'], { name: 'payments_recipient_id_idx' });
    await queryInterface.addIndex('payments', ['status'], { name: 'payments_status_idx' });
    await queryInterface.addIndex('payments', ['payment_type'], { name: 'payments_payment_type_idx' });
    await queryInterface.addIndex('payments', ['transaction_id'], { name: 'payments_transaction_id_idx' });
    await queryInterface.addIndex('payments', ['cashfree_order_id'], { name: 'payments_cashfree_order_id_idx' });
    await queryInterface.addIndex('payments', ['created_at'], { name: 'payments_created_at_idx' });

    console.log('Creating indexes for chats table...');
    await queryInterface.addIndex('chats', ['sender_id'], { name: 'chats_sender_id_idx' });
    await queryInterface.addIndex('chats', ['ride_id'], { name: 'chats_ride_id_idx' });
    await queryInterface.addIndex('chats', ['group_id'], { name: 'chats_group_id_idx' });
    await queryInterface.addIndex('chats', ['reply_to_id'], { name: 'chats_reply_to_id_idx' });
    await queryInterface.addIndex('chats', ['created_at'], { name: 'chats_created_at_idx' });
    await queryInterface.addIndex('chats', ['is_deleted'], { name: 'chats_is_deleted_idx' });
    await queryInterface.addIndex('chats', ['message_type'], { name: 'chats_message_type_idx' });

    // Create composite indexes for common query patterns
    await queryInterface.addIndex('rides', ['status', 'ride_date'], { name: 'rides_status_date_idx' });
    await queryInterface.addIndex('rides', ['creator_id', 'status'], { name: 'rides_creator_status_idx' });
    await queryInterface.addIndex('rentals', ['category', 'is_available'], { name: 'rentals_category_available_idx' });
    await queryInterface.addIndex('payments', ['user_id', 'status'], { name: 'payments_user_status_idx' });
    await queryInterface.addIndex('chats', ['ride_id', 'created_at'], { name: 'chats_ride_created_idx' });
    await queryInterface.addIndex('chats', ['group_id', 'created_at'], { name: 'chats_group_created_idx' });

    console.log('All tables and indexes created successfully!');
  },

  async down(queryInterface, Sequelize) {
    console.log('Dropping tables...');
    await queryInterface.dropTable('chats');
    await queryInterface.dropTable('payments');
    await queryInterface.dropTable('rentals');
    await queryInterface.dropTable('rides');
    console.log('Tables dropped successfully!');
  }
};