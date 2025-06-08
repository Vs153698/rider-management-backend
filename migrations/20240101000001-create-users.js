'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create Users table
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      phone_number: {
        type: Sequelize.STRING(15),
        allowNull: false,
        unique: true
      },
      email: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true
      },
      password: {
        type: Sequelize.STRING,
        allowNull: false
      },
      first_name: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      last_name: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      profile_picture: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      cover_picture: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      bio: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      location: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      emergency_contact: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      bike_info: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      is_verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      last_active: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      verification_code: {
        type: Sequelize.STRING(6),
        allowNull: true
      },
      verification_expires: {
        type: Sequelize.DATE,
        allowNull: true
      },
      reset_password_token: {
        type: Sequelize.STRING,
        allowNull: true
      },
      reset_password_expires: {
        type: Sequelize.DATE,
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

    // Add indexes for users
    await queryInterface.addIndex('users', ['phone_number']);
    await queryInterface.addIndex('users', ['email']);
    await queryInterface.addIndex('users', ['location'], { using: 'gin' });

    // Create Groups table
    await queryInterface.createTable('groups', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      name: {
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
      group_type: {
        type: Sequelize.ENUM('public', 'private', 'invite_only'),
        defaultValue: 'public'
      },
      is_paid: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      membership_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'INR'
      },
      max_members: {
        type: Sequelize.INTEGER,
        defaultValue: 100
      },
      current_members: {
        type: Sequelize.INTEGER,
        defaultValue: 1
      },
      admin_id: {
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
        allowNull: true
      },
      rules: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      tags: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: []
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      settings: {
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

    // Add indexes for groups
    await queryInterface.addIndex('groups', ['admin_id']);
    await queryInterface.addIndex('groups', ['group_type']);
    await queryInterface.addIndex('groups', ['location'], { using: 'gin' });
    await queryInterface.addIndex('groups', ['tags'], { using: 'gin' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('groups');
    await queryInterface.dropTable('users');
  }
};