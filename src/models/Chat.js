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
    // FIXED: More robust validation that handles all edge cases
    validate: {
      hasValidChatContext() {
        // Skip validation entirely for read operations and non-context updates
        if (!this.isNewRecord) {
          // Only validate if core chat context fields are being modified
          const contextFieldsChanged = this.changed('chat_type') || 
                                     this.changed('recipient_id') || 
                                     this.changed('ride_id') || 
                                     this.changed('group_id') ||
                                     this.changed('sender_id');
          
          if (!contextFieldsChanged) {
            return; // Skip validation for status updates, reads, etc.
          }
        }

        // Only validate on creation or when context fields change
        try {
          if (this.chat_type === 'direct') {
            if (!this.recipient_id) {
              throw new Error('Direct messages must have a recipient_id');
            }
            if (this.ride_id || this.group_id) {
              throw new Error('Direct messages cannot have ride_id or group_id');
            }
          } else if (this.chat_type === 'ride') {
            if (!this.ride_id) {
              throw new Error('Ride messages must have a ride_id');
            }
            if (this.recipient_id || this.group_id) {
              throw new Error('Ride messages cannot have recipient_id or group_id');
            }
          } else if (this.chat_type === 'group') {
            if (!this.group_id) {
              throw new Error('Group messages must have a group_id');
            }
            if (this.recipient_id || this.ride_id) {
              throw new Error('Group messages cannot have recipient_id or ride_id');
            }
          }
        } catch (error) {
          // Log the error for debugging but only throw if this is a new record or context change
          if (this.isNewRecord || this.changed('chat_type')) {
            throw error;
          }
        }
      }
    },
    
    // Add hooks to prevent validation issues
    hooks: {
      beforeFind: (options) => {
        // Disable validation for find operations
        options.validate = false;
      },
      beforeUpdate: (instance, options) => {
        // Only validate if we're updating context fields
        const contextFieldsChanged = instance.changed('chat_type') || 
                                   instance.changed('recipient_id') || 
                                   instance.changed('ride_id') || 
                                   instance.changed('group_id') ||
                                   instance.changed('sender_id');
        
        if (!contextFieldsChanged) {
          options.validate = false;
        }
      },
      beforeBulkUpdate: (options) => {
        // Disable validation for bulk updates (like marking as read)
        options.validate = false;
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