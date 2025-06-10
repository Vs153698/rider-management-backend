const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserConnection = sequelize.define('UserConnection', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    connected_user_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'accepted', 'blocked', 'rejected'),
      defaultValue: 'pending'
    },
    initiated_by: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Who sent the friend request'
    },
    is_archived: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    last_message_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    accepted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rejected_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    blocked_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'user_connections',
    indexes: [
      {
        fields: ['user_id']
      },
      {
        fields: ['connected_user_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['initiated_by']
      },
      // Composite index for checking existing connections
      {
        fields: ['user_id', 'connected_user_id'],
        unique: true
      },
      // Index for finding pending requests
      {
        fields: ['connected_user_id', 'status']
      }
    ],
    validate: {
      cannotConnectToSelf() {
        if (this.user_id === this.connected_user_id) {
          throw new Error('Cannot create connection with yourself');
        }
      }
    }
  });

  // Instance methods
  UserConnection.prototype.accept = function() {
    this.status = 'accepted';
    this.accepted_at = new Date();
    return this.save();
  };

  UserConnection.prototype.reject = function() {
    this.status = 'rejected';
    this.rejected_at = new Date();
    return this.save();
  };

  UserConnection.prototype.block = function() {
    this.status = 'blocked';
    this.blocked_at = new Date();
    return this.save();
  };

  UserConnection.prototype.unblock = function() {
    this.status = 'accepted';
    this.blocked_at = null;
    return this.save();
  };

  UserConnection.prototype.archive = function() {
    this.is_archived = true;
    return this.save();
  };

  UserConnection.prototype.unarchive = function() {
    this.is_archived = false;
    return this.save();
  };

  // Static methods
  UserConnection.findOrCreateConnection = async function(userId1, userId2, initiatedBy) {
    // CRITICAL FIX: Validate self-connection BEFORE any database operations
    if (userId1 === userId2) {
      throw new Error('Cannot create connection with yourself');
    }

    // Check if any connection exists
    const existingConnection = await UserConnection.findOne({
      where: {
        [sequelize.Sequelize.Op.or]: [
          { user_id: userId1, connected_user_id: userId2 },
          { user_id: userId2, connected_user_id: userId1 }
        ]
      }
    });

    if (existingConnection) {
      return existingConnection;
    }

    // Create new connection (friend request)
    // The model validation will also run as a backup
    return await UserConnection.create({
      user_id: userId1,
      connected_user_id: userId2,
      initiated_by: initiatedBy,
      status: 'pending'
    });
  };

  UserConnection.areFriends = async function(userId1, userId2) {
    // Add self-check validation
    if (userId1 === userId2) {
      return false; // You can't be friends with yourself
    }

    const connection = await UserConnection.findOne({
      where: {
        [sequelize.Sequelize.Op.or]: [
          { user_id: userId1, connected_user_id: userId2 },
          { user_id: userId2, connected_user_id: userId1 }
        ],
        status: 'accepted'
      }
    });

    return !!connection;
  };

  UserConnection.getConnectionStatus = async function(userId1, userId2) {
    // Add self-check validation
    if (userId1 === userId2) {
      return { 
        status: 'self', 
        connection: null, 
        canChat: false 
      };
    }

    const connection = await UserConnection.findOne({
      where: {
        [sequelize.Sequelize.Op.or]: [
          { user_id: userId1, connected_user_id: userId2 },
          { user_id: userId2, connected_user_id: userId1 }
        ]
      }
    });

    if (!connection) {
      return { status: 'none', connection: null };
    }

    // Determine the relationship from userId1's perspective
    let perspective = 'none';
    if (connection.status === 'pending') {
      if (connection.initiated_by === userId1) {
        perspective = 'sent'; // userId1 sent the request
      } else {
        perspective = 'received'; // userId1 received the request
      }
    } else {
      perspective = connection.status; // accepted, blocked, rejected
    }

    return { 
      status: perspective, 
      connection,
      canChat: connection.status === 'accepted'
    };
  };

  UserConnection.isBlocked = async function(userId1, userId2) {
    // Add self-check validation
    if (userId1 === userId2) {
      return false; // You can't block yourself
    }

    const connection = await UserConnection.findOne({
      where: {
        [sequelize.Sequelize.Op.or]: [
          { user_id: userId1, connected_user_id: userId2 },
          { user_id: userId2, connected_user_id: userId1 }
        ],
        status: 'blocked'
      }
    });

    return !!connection;
  };

  return UserConnection;
};