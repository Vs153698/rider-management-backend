const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Chat = sequelize.define('Chat', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    message_type: {
      type: DataTypes.ENUM('text', 'image', 'location', 'file', 'voice'),
      defaultValue: 'text'
    },
    chat_type: {
      type: DataTypes.ENUM('ride', 'group', 'direct'),
      allowNull: false,
      defaultValue: 'direct'
    },
    attachment_url: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    attachment_type: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    sender_id: {
      type: DataTypes.UUID,
      allowNull: false
      // Remove references - handle through associations in index file
    },
    recipient_id: {
      type: DataTypes.UUID,
      allowNull: true
      // For direct messages - who is receiving the message
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
    reply_to_id: {
      type: DataTypes.UUID,
      allowNull: true
      // Remove references - handle through associations in index file
    },
    is_edited: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    edited_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'chats',
    indexes: [
      {
        fields: ['sender_id']
      },
      {
        fields: ['recipient_id']
      },
      {
        fields: ['ride_id']
      },
      {
        fields: ['group_id']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['reply_to_id']
      },
      {
        fields: ['chat_type']
      },
      {
        fields: ['is_read']
      },
      // Composite index for direct message conversations
      {
        fields: ['sender_id', 'recipient_id', 'chat_type']
      }
    ],
    // Add validation to ensure proper chat context
    validate: {
      hasValidChatContext() {
        if (this.chat_type === 'direct' && !this.recipient_id) {
          throw new Error('Direct messages must have a recipient_id');
        }
        if (this.chat_type === 'ride' && !this.ride_id) {
          throw new Error('Ride messages must have a ride_id');
        }
        if (this.chat_type === 'group' && !this.group_id) {
          throw new Error('Group messages must have a group_id');
        }
        if (this.chat_type === 'direct' && (this.ride_id || this.group_id)) {
          throw new Error('Direct messages cannot have ride_id or group_id');
        }
      }
    }
  });

  // Instance methods
  Chat.prototype.canEdit = function(userId) {
    return this.sender_id === userId && !this.is_deleted;
  };

  Chat.prototype.canDelete = function(userId) {
    return this.sender_id === userId && !this.is_deleted;
  };

  Chat.prototype.softDelete = function() {
    this.is_deleted = true;
    this.deleted_at = new Date();
    this.message = null;
    this.attachment_url = null;
  };

  Chat.prototype.markAsRead = function() {
    this.is_read = true;
    this.read_at = new Date();
  };

  // Static method to get conversation ID for direct messages
  Chat.getDirectConversationId = function(userId1, userId2) {
    // Create a consistent conversation ID regardless of order
    const sortedIds = [userId1, userId2].sort();
    return `${sortedIds[0]}_${sortedIds[1]}`;
  };

  return Chat;
};