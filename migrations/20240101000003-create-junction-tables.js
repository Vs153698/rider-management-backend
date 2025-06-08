'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create ride_participants junction table
    await queryInterface.createTable('ride_participants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      ride_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rides',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
      joined_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      status: {
        type: Sequelize.ENUM('joined', 'confirmed', 'cancelled'),
        defaultValue: 'joined'
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

    // Create group_members junction table
    await queryInterface.createTable('group_members', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'groups',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
      joined_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      role: {
        type: Sequelize.ENUM('member', 'moderator'),
        defaultValue: 'member'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'banned'),
        defaultValue: 'active'
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

    // Create rental_bookings junction table
    await queryInterface.createTable('rental_bookings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      rental_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'rentals',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
      start_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      end_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      total_cost: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      security_deposit: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0
      },
      status: {
        type: Sequelize.ENUM('pending', 'confirmed', 'active', 'completed', 'cancelled'),
        defaultValue: 'pending'
      },
      pickup_method: {
        type: Sequelize.ENUM('pickup', 'delivery', 'meet_location'),
        defaultValue: 'pickup'
      },
      pickup_address: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      return_address: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
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

    // Add unique constraints and indexes
    await queryInterface.addIndex('ride_participants', ['ride_id', 'user_id'], {
      unique: true,
      name: 'ride_participants_unique'
    });
    await queryInterface.addIndex('ride_participants', ['ride_id']);
    await queryInterface.addIndex('ride_participants', ['user_id']);

    await queryInterface.addIndex('group_members', ['group_id', 'user_id'], {
      unique: true,
      name: 'group_members_unique'
    });
    await queryInterface.addIndex('group_members', ['group_id']);
    await queryInterface.addIndex('group_members', ['user_id']);

    await queryInterface.addIndex('rental_bookings', ['rental_id']);
    await queryInterface.addIndex('rental_bookings', ['user_id']);
    await queryInterface.addIndex('rental_bookings', ['start_date']);
    await queryInterface.addIndex('rental_bookings', ['end_date']);
    await queryInterface.addIndex('rental_bookings', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('rental_bookings');
    await queryInterface.dropTable('group_members');
    await queryInterface.dropTable('ride_participants');
  }
};