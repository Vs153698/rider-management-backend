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
      }
    ]
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

  return Chat;
};