const { Chat, User, Ride, Group, UserConnection } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { uploadToCloudinary } = require('../config/cloudinary');
const { getPagination, getPagingData } = require('../utils/helpers');
const { Op } = require('sequelize');

// Get user's chat list - includes rides, groups, and direct messages (FRIENDS ONLY)
const getChatList = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, type } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);
  const userId = req.userId;

  let allChats = [];

  // Get direct message conversations (ONLY WITH FRIENDS)
  if (!type || type === 'direct') {
    const connections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: userId },
          { connected_user_id: userId }
        ],
        status: 'accepted', // CRITICAL: Only accepted friends
        is_archived: false
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
          required: false
        },
        {
          model: User,
          as: 'connectedUser',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
          required: false
        }
      ],
      order: [['last_message_at', 'DESC']]
    });

    // Get last message for each friend connection
    for (const connection of connections) {
      const friendId = connection.user?.id === userId ? connection.connected_user_id : connection.user_id;
      const friend = connection.user?.id === userId ? connection.connectedUser : connection.user;

      if (!friend) continue;

      const lastMessage = await Chat.findOne({
        where: {
          chat_type: 'direct',
          [Op.or]: [
            { sender_id: userId, recipient_id: friendId },
            { sender_id: friendId, recipient_id: userId }
          ],
          is_deleted: false
        },
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }
        ],
        order: [['createdAt', 'DESC']]
      });

      // Get unread count
      const unreadCount = await Chat.count({
        where: {
          chat_type: 'direct',
          sender_id: friendId,
          recipient_id: userId,
          is_read: false,
          is_deleted: false
        }
      });

      allChats.push({
        id: friendId,
        type: 'direct',
        user: friend,
        lastMessage: lastMessage,
        unreadCount: unreadCount,
        updated_at: connection.last_message_at || connection.updatedAt,
        connection_status: connection.status,
        friendship_date: connection.accepted_at,
        conversation_id: Chat.getDirectConversationId ? Chat.getDirectConversationId(userId, friendId) : `${Math.min(userId, friendId)}-${Math.max(userId, friendId)}`
      });
    }
  }

  // Get rides where user is creator or participant
  if (!type || type === 'ride') {
    // First get rides where user is creator
    const createdRides = await Ride.findAll({
      where: {
        creator_id: userId
      },
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        },
        {
          model: User,
          as: 'participants',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
          through: { attributes: [] },
          required: false
        }
      ]
    });

    // Then get rides where user is participant
    const participatedRides = await Ride.findAll({
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        },
        {
          model: User,
          as: 'participants',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
          through: { attributes: [] },
          where: { id: userId },
          required: true
        }
      ]
    });

    // Combine and remove duplicates
    const allRides = [...createdRides, ...participatedRides];
    const uniqueRides = allRides.filter((ride, index, self) => 
      index === self.findIndex(r => r.id === ride.id)
    );

    // Get last message for each ride
    for (const ride of uniqueRides) {
      const lastMessage = await Chat.findOne({
        where: {
          ride_id: ride.id,
          chat_type: 'ride',
          is_deleted: false
        },
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }
        ],
        order: [['createdAt', 'DESC']]
      });

      // Get unread count for ride messages
      const unreadCount = await Chat.count({
        where: {
          ride_id: ride.id,
          chat_type: 'ride',
          sender_id: { [Op.ne]: userId },
          is_read: false,
          is_deleted: false
        }
      });

      allChats.push({
        id: ride.id,
        type: 'ride',
        title: ride.title,
        participants: ride.participants || [],
        creator: ride.creator,
        lastMessage: lastMessage,
        unreadCount: unreadCount,
        updated_at: ride.updatedAt,
        ride_date: ride.ride_date,
        status: ride.status
      });
    }
  }

  // Get groups where user is admin or member
  if (!type || type === 'group') {
    // First get groups where user is admin
    const adminGroups = await Group.findAll({
      where: {
        admin_id: userId
      },
      include: [
        {
          model: User,
          as: 'admin',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        },
        {
          model: User,
          as: 'members',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
          through: { attributes: [] },
          required: false
        }
      ]
    });

    // Then get groups where user is member
    const memberGroups = await Group.findAll({
      include: [
        {
          model: User,
          as: 'admin',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        },
        {
          model: User,
          as: 'members',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
          through: { attributes: [] },
          where: { id: userId },
          required: true
        }
      ]
    });

    // Combine and remove duplicates
    const allGroups = [...adminGroups, ...memberGroups];
    const uniqueGroups = allGroups.filter((group, index, self) => 
      index === self.findIndex(g => g.id === group.id)
    );

    // Get last message for each group
    for (const group of uniqueGroups) {
      const lastMessage = await Chat.findOne({
        where: {
          group_id: group.id,
          chat_type: 'group',
          is_deleted: false
        },
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }
        ],
        order: [['createdAt', 'DESC']]
      });

      // Get unread count for group messages
      const unreadCount = await Chat.count({
        where: {
          group_id: group.id,
          chat_type: 'group',
          sender_id: { [Op.ne]: userId },
          is_read: false,
          is_deleted: false
        }
      });

      allChats.push({
        id: group.id,
        type: 'group',
        name: group.name,
        avatar_url: group.cover_image,
        members: group.members || [],
        admin: group.admin,
        lastMessage: lastMessage,
        unreadCount: unreadCount,
        updated_at: group.updatedAt,
        is_private: group.is_private
      });
    }
  }

  // Sort by last message time (most recent first)
  allChats.sort((a, b) => {
    const timeA = a.lastMessage?.createdAt || a.updated_at;
    const timeB = b.lastMessage?.createdAt || b.updated_at;
    return new Date(timeB) - new Date(timeA);
  });

  // Apply pagination
  const total = allChats.length;
  const paginatedChats = allChats.slice(offset, offset + limitNum);

  const response = getPagingData({ rows: paginatedChats, count: total }, page - 1, limitNum);
  
  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Send message - handles direct, ride, and group messages (WITH FRIEND VALIDATION)
const sendMessage = catchAsync(async (req, res, next) => {
  const {
    message,
    message_type = 'text',
    chat_type = 'direct',
    recipient_id,
    ride_id,
    group_id,
    reply_to_id,
    metadata = {}
  } = req.body;

  // Validate message data
  if (!message && message_type === 'text') {
    return next(new AppError('Message content required', 400));
  }

  // Validate chat context based on type
  if (chat_type === 'direct' && !recipient_id) {
    return next(new AppError('Recipient ID required for direct messages', 400));
  }
  if (chat_type === 'ride' && !ride_id) {
    return next(new AppError('Ride ID required for ride messages', 400));
  }
  if (chat_type === 'group' && !group_id) {
    return next(new AppError('Group ID required for group messages', 400));
  }

  // Handle direct message permissions - MUST BE FRIENDS
  if (chat_type === 'direct') {
    if (recipient_id === req.userId) {
      return next(new AppError('Cannot send message to yourself', 400));
    }

    // Check if recipient exists
    const recipient = await User.findByPk(recipient_id);
    if (!recipient) {
      return next(new AppError('Recipient not found', 404));
    }

    // CRITICAL: Check if users are friends
    const areFriends = await UserConnection.areFriends(req.userId, recipient_id);
    if (!areFriends) {
      return next(new AppError('You can only send messages to friends. Send a friend request first.', 403));
    }

    // Check if either user has blocked the other
    const isBlocked = await UserConnection.isBlocked(req.userId, recipient_id);
    if (isBlocked) {
      return next(new AppError('Cannot send message to this user', 403));
    }
  }

  // Validate ride access
  if (chat_type === 'ride') {
    const ride = await Ride.findByPk(ride_id, {
      include: [{
        model: User,
        as: 'participants',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!ride) {
      return next(new AppError('Ride not found', 404));
    }

    const isParticipant = ride.participants?.some(p => p.id === req.userId);
    const isCreator = ride.creator_id === req.userId;

    if (!isParticipant && !isCreator) {
      return next(new AppError('Access denied to ride chat', 403));
    }
  }

  // Validate group access
  if (chat_type === 'group') {
    const group = await Group.findByPk(group_id, {
      include: [{
        model: User,
        as: 'members',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!group) {
      return next(new AppError('Group not found', 404));
    }

    const isMember = group.members?.some(m => m.id === req.userId);
    const isAdmin = group.admin_id === req.userId;

    if (!isMember && !isAdmin) {
      return next(new AppError('Access denied to group chat', 403));
    }
  }

  // Handle file upload for attachments
  let attachment_url = null;
  let attachment_type = null;

  if (req.file) {
    const result = await uploadToCloudinary(req.file, 'chat-attachments');
    attachment_url = result.secure_url;
    attachment_type = req.file.mimetype;
  }

  // Create chat message
  const chat = await Chat.create({
    message,
    message_type,
    chat_type,
    attachment_url,
    attachment_type,
    sender_id: req.userId,
    recipient_id,
    ride_id,
    group_id,
    reply_to_id,
    metadata
  });

  // Update connection last message time for direct messages
  if (chat_type === 'direct') {
    await UserConnection.update(
      { last_message_at: new Date() },
      {
        where: {
          [Op.or]: [
            { user_id: req.userId, connected_user_id: recipient_id },
            { user_id: recipient_id, connected_user_id: req.userId }
          ],
          status: 'accepted'
        }
      }
    );
  }

  // Include sender and recipient information with reply context
  const chatWithUsers = await Chat.findByPk(chat.id, {
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
        required: false
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [{
          model: User,
          as: 'sender',
          attributes: ['id', 'first_name', 'last_name']
        }]
      }
    ]
  });

  res.status(201).json({
    status: 'success',
    message: 'Message sent successfully',
    data: {
      chat: chatWithUsers
    }
  });
});

// Get direct messages between two users (FRIENDS ONLY)
const getDirectMessages = catchAsync(async (req, res, next) => {
  const { userId: otherUserId } = req.params;
  const { page = 1, limit = 50, before_message_id } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  // CRITICAL: Check if users are friends
  const areFriends = await UserConnection.areFriends(req.userId, otherUserId);
  if (!areFriends) {
    return next(new AppError('You can only view conversations with friends', 403));
  }

  // Check if connection exists and is not blocked
  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: otherUserId },
        { user_id: otherUserId, connected_user_id: req.userId }
      ],
      status: 'accepted'
    }
  });

  if (!connection) {
    return next(new AppError('No active conversation found with this user', 404));
  }

  // Build where clause with pagination support
  let whereClause = {
    chat_type: 'direct',
    [Op.or]: [
      { sender_id: req.userId, recipient_id: otherUserId },
      { sender_id: otherUserId, recipient_id: req.userId }
    ],
    is_deleted: false
  };

  // Add pagination with before_message_id if provided
  if (before_message_id) {
    const beforeMessage = await Chat.findByPk(before_message_id);
    if (beforeMessage) {
      whereClause.createdAt = { [Op.lt]: beforeMessage.createdAt };
    }
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ],
    limit: limitNum,
    offset,
    order: [['createdAt', 'DESC']]
  });

  // Mark messages as read (messages sent by the other user)
  await Chat.update(
    { is_read: true, read_at: new Date() },
    {
      where: {
        chat_type: 'direct',
        sender_id: otherUserId,
        recipient_id: req.userId,
        is_read: false,
        is_deleted: false
      }
    }
  );

  const response = getPagingData(messages, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: {
      ...response,
      conversation_id: Chat.getDirectConversationId ? Chat.getDirectConversationId(req.userId, otherUserId) : `${Math.min(req.userId, otherUserId)}-${Math.max(req.userId, otherUserId)}`
    }
  });
});

// Get ride messages
const getRideMessages = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;
  const { page = 1, limit = 50, before_message_id } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  // Check if user is participant or creator
  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'participants',
        where: { id: req.userId },
        required: false
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  const isParticipant = ride.participants?.some(p => p.id === req.userId);
  const isCreator = ride.creator_id === req.userId;

  if (!isParticipant && !isCreator) {
    return next(new AppError('Access denied to ride messages', 403));
  }

  // Build where clause with pagination support
  let whereClause = {
    ride_id: rideId,
    chat_type: 'ride',
    is_deleted: false
  };

  // Add pagination with before_message_id if provided
  if (before_message_id) {
    const beforeMessage = await Chat.findByPk(before_message_id);
    if (beforeMessage) {
      whereClause.createdAt = { [Op.lt]: beforeMessage.createdAt };
    }
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ],
    limit: limitNum,
    offset,
    order: [['createdAt', 'DESC']]
  });

  // Mark ride messages as read for this user
  await Chat.update(
    { is_read: true, read_at: new Date() },
    {
      where: {
        ride_id: rideId,
        chat_type: 'ride',
        sender_id: { [Op.ne]: req.userId },
        is_read: false,
        is_deleted: false
      }
    }
  );

  const response = getPagingData(messages, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get group messages
const getGroupMessages = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;
  const { page = 1, limit = 50, before_message_id } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  // Check if user is member or admin
  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'members',
        where: { id: req.userId },
        required: false
      }
    ]
  });

  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  const isMember = group.members?.some(m => m.id === req.userId);
  const isAdmin = group.admin_id === req.userId;

  if (!isMember && !isAdmin) {
    return next(new AppError('Access denied to group messages', 403));
  }

  // Build where clause with pagination support
  let whereClause = {
    group_id: groupId,
    chat_type: 'group',
    is_deleted: false
  };

  // Add pagination with before_message_id if provided
  if (before_message_id) {
    const beforeMessage = await Chat.findByPk(before_message_id);
    if (beforeMessage) {
      whereClause.createdAt = { [Op.lt]: beforeMessage.createdAt };
    }
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ],
    limit: limitNum,
    offset,
    order: [['createdAt', 'DESC']]
  });

  // Mark group messages as read for this user
  await Chat.update(
    { is_read: true, read_at: new Date() },
    {
      where: {
        group_id: groupId,
        chat_type: 'group',
        sender_id: { [Op.ne]: req.userId },
        is_read: false,
        is_deleted: false
      }
    }
  );

  const response = getPagingData(messages, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Start conversation with a user (WITH FRIEND REQUEST SYSTEM)
const startConversation = catchAsync(async (req, res, next) => {
  const { user_id, initial_message } = req.body;

  if (!user_id) {
    return next(new AppError('User ID required', 400));
  }

  if (user_id === req.userId) {
    return next(new AppError('Cannot start conversation with yourself', 400));
  }

  // Check if user exists
  const user = await User.findByPk(user_id, {
    attributes: ['id', 'first_name', 'last_name', 'profile_picture']
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if users are already friends
  const areFriends = await UserConnection.areFriends(req.userId, user_id);
  
  if (!areFriends) {
    // Check if there's a pending friend request
    const existingRequest = await UserConnection.findOne({
      where: {
        [Op.or]: [
          { user_id: req.userId, connected_user_id: user_id },
          { user_id: user_id, connected_user_id: req.userId }
        ],
        status: 'pending'
      }
    });

    if (existingRequest) {
      return next(new AppError('Friend request already sent. Wait for response to start chatting.', 400));
    }

    return next(new AppError('You must be friends to start a conversation. Send a friend request first.', 403));
  }

  // Get or update connection
  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: user_id },
        { user_id: user_id, connected_user_id: req.userId }
      ],
      status: 'accepted'
    }
  });

  if (!connection) {
    return next(new AppError('Friend connection not found', 404));
  }

  // Reactivate if archived
  if (connection.is_archived) {
    await connection.update({ is_archived: false });
  }

  // Send initial message if provided
  let initialChat = null;
  if (initial_message && initial_message.trim()) {
    initialChat = await Chat.create({
      message: initial_message.trim(),
      message_type: 'text',
      chat_type: 'direct',
      sender_id: req.userId,
      recipient_id: user_id
    });

    // Update connection last message time
    await connection.update({ last_message_at: new Date() });

    // Include sender information
    initialChat = await Chat.findByPk(initialChat.id, {
      include: [{
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }]
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'Conversation started successfully',
    data: {
      user: user,
      connection_id: connection.id,
      conversation_id: Chat.getDirectConversationId ? Chat.getDirectConversationId(req.userId, user_id) : `${Math.min(req.userId, user_id)}-${Math.max(req.userId, user_id)}`,
      initial_message: initialChat
    }
  });
});

// Block/Unblock user (ENHANCED)
const toggleBlockUser = catchAsync(async (req, res, next) => {
  const { user_id } = req.params;
  const { action } = req.body; // 'block' or 'unblock'

  if (!['block', 'unblock'].includes(action)) {
    return next(new AppError('Action must be "block" or "unblock"', 400));
  }

  // Find existing connection
  let connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: user_id },
        { user_id: user_id, connected_user_id: req.userId }
      ]
    }
  });

  if (action === 'block') {
    if (connection) {
      await connection.update({
        status: 'blocked',
        blocked_at: new Date(),
        blocked_by: req.userId
      });
    } else {
      // Create new connection in blocked state
      connection = await UserConnection.create({
        user_id: req.userId,
        connected_user_id: user_id,
        initiated_by: req.userId,
        status: 'blocked',
        blocked_at: new Date(),
        blocked_by: req.userId
      });
    }
  } else if (action === 'unblock') {
    if (!connection) {
      return next(new AppError('No connection found with this user', 404));
    }

    if (connection.status !== 'blocked') {
      return next(new AppError('User is not blocked', 400));
    }

    // Remove the connection entirely when unblocking
    await connection.destroy();
    connection = null;
  }

  res.status(200).json({
    status: 'success',
    message: `User ${action}ed successfully`,
    data: {
      connection_status: action === 'block' ? 'blocked' : 'none',
      action
    }
  });
});

// Archive/Unarchive conversation
const toggleArchiveConversation = catchAsync(async (req, res, next) => {
  const { user_id } = req.params;
  const { is_archived = true } = req.body;

  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: user_id },
        { user_id: user_id, connected_user_id: req.userId }
      ],
      status: 'accepted'
    }
  });

  if (!connection) {
    return next(new AppError('No active conversation found with this user', 404));
  }

  await connection.update({ 
    is_archived,
    archived_at: is_archived ? new Date() : null
  });

  res.status(200).json({
    status: 'success',
    message: `Conversation ${is_archived ? 'archived' : 'unarchived'} successfully`
  });
});

// Edit message (ENHANCED)
const editMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const { message } = req.body;

  if (!message || !message.trim()) {
    return next(new AppError('Message content required', 400));
  }

  const chat = await Chat.findByPk(messageId, {
    include: [{
      model: User,
      as: 'sender',
      attributes: ['id', 'first_name', 'last_name', 'profile_picture']
    }]
  });

  if (!chat) {
    return next(new AppError('Message not found', 404));
  }

  if (chat.sender_id !== req.userId) {
    return next(new AppError('You can only edit your own messages', 403));
  }

  // Check if message is too old to edit (24 hours)
  const messageAge = Date.now() - new Date(chat.createdAt).getTime();
  const maxEditTime = 24 * 60 * 60 * 1000; // 24 hours
  
  if (messageAge > maxEditTime) {
    return next(new AppError('Cannot edit messages older than 24 hours', 403));
  }

  if (chat.is_deleted) {
    return next(new AppError('Cannot edit deleted messages', 403));
  }

  const updatedChat = await chat.update({
    message: message.trim(),
    is_edited: true,
    edited_at: new Date()
  });

  res.status(200).json({
    status: 'success',
    message: 'Message updated successfully',
    data: {
      chat: updatedChat
    }
  });
});

// Delete message (ENHANCED)
const deleteMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const { delete_for_everyone = false } = req.body;

  const chat = await Chat.findByPk(messageId, {
    include: [{
      model: User,
      as: 'sender',
      attributes: ['id', 'first_name', 'last_name', 'profile_picture']
    }]
  });

  if (!chat) {
    return next(new AppError('Message not found', 404));
  }

  if (chat.sender_id !== req.userId) {
    return next(new AppError('You can only delete your own messages', 403));
  }

  if (chat.is_deleted) {
    return next(new AppError('Message already deleted', 400));
  }

  // For delete for everyone, check time limit (1 hour)
  if (delete_for_everyone) {
    const messageAge = Date.now() - new Date(chat.createdAt).getTime();
    const maxDeleteTime = 60 * 60 * 1000; // 1 hour
    
    if (messageAge > maxDeleteTime) {
      return next(new AppError('Can only delete for everyone within 1 hour of sending', 403));
    }
  }

  await chat.update({
    is_deleted: true,
    deleted_at: new Date(),
    deleted_by: req.userId,
    deleted_for_everyone
  });

  res.status(200).json({
    status: 'success',
    message: delete_for_everyone ? 'Message deleted for everyone' : 'Message deleted for you'
  });
});

// Get message by ID
const getMessageById = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;

  const chat = await Chat.findByPk(messageId, {
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
        required: false
      },
      {
        model: Chat,
        as: 'replyTo',
        required: false,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ]
  });

  if (!chat) {
    return next(new AppError('Message not found', 404));
  }

  // Check if user has access to this message
  if (chat.chat_type === 'direct') {
    if (chat.sender_id !== req.userId && chat.recipient_id !== req.userId) {
      return next(new AppError('Access denied', 403));
    }

    // Check if users are friends for direct messages
    const otherUserId = chat.sender_id === req.userId ? chat.recipient_id : chat.sender_id;
    const areFriends = await UserConnection.areFriends(req.userId, otherUserId);
    if (!areFriends) {
      return next(new AppError('Access denied', 403));
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      chat
    }
  });
});

// Search messages (ENHANCED)
const searchMessages = catchAsync(async (req, res, next) => {
  const { 
    q, 
    chat_type, 
    user_id, 
    ride_id, 
    group_id, 
    message_type, 
    date_from,
    date_to,
    page = 1, 
    limit = 20 
  } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  if (!q || q.length < 2) {
    return next(new AppError('Search query must be at least 2 characters', 400));
  }

  const whereClause = {
    message: { [Op.iLike]: `%${q}%` },
    is_deleted: false
  };

  // Filter by chat type
  if (chat_type) whereClause.chat_type = chat_type;
  if (message_type) whereClause.message_type = message_type;

  // Date range filter
  if (date_from || date_to) {
    whereClause.createdAt = {};
    if (date_from) whereClause.createdAt[Op.gte] = new Date(date_from);
    if (date_to) whereClause.createdAt[Op.lte] = new Date(date_to);
  }

  // For direct messages, ensure user has access and users are friends
  if (chat_type === 'direct' && user_id) {
    // Check if users are friends
    const areFriends = await UserConnection.areFriends(req.userId, user_id);
    if (!areFriends) {
      return next(new AppError('Access denied', 403));
    }

    whereClause[Op.or] = [
      { sender_id: req.userId, recipient_id: user_id },
      { sender_id: user_id, recipient_id: req.userId }
    ];
  } else if (chat_type === 'direct') {
    // Search all direct messages for the user (only with friends)
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: req.userId },
          { connected_user_id: req.userId }
        ],
        status: 'accepted'
      }
    });

    const friendIds = friendConnections.map(conn => 
      conn.user_id === req.userId ? conn.connected_user_id : conn.user_id
    );

    whereClause[Op.or] = [
      { sender_id: req.userId, recipient_id: { [Op.in]: friendIds } },
      { sender_id: { [Op.in]: friendIds }, recipient_id: req.userId }
    ];
  }

  if (ride_id) {
    // Verify user has access to ride
    const ride = await Ride.findByPk(ride_id, {
      include: [{
        model: User,
        as: 'participants',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!ride) {
      return next(new AppError('Ride not found', 404));
    }

    const isParticipant = ride.participants?.some(p => p.id === req.userId);
    const isCreator = ride.creator_id === req.userId;

    if (!isParticipant && !isCreator) {
      return next(new AppError('Access denied to ride messages', 403));
    }

    whereClause.ride_id = ride_id;
  }

  if (group_id) {
    // Verify user has access to group
    const group = await Group.findByPk(group_id, {
      include: [{
        model: User,
        as: 'members',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!group) {
      return next(new AppError('Group not found', 404));
    }

    const isMember = group.members?.some(m => m.id === req.userId);
    const isAdmin = group.admin_id === req.userId;

    if (!isMember && !isAdmin) {
      return next(new AppError('Access denied to group messages', 403));
    }

    whereClause.group_id = group_id;
  }

  const messages = await Chat.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
        required: false
      },
      {
        model: Ride,
        as: 'ride',
        attributes: ['id', 'title'],
        required: false
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name'],
        required: false
      }
    ],
    limit: limitNum,
    offset,
    order: [['createdAt', 'DESC']]
  });

  const response = getPagingData(messages, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: {
      ...response,
      search_query: q,
      filters: {
        chat_type,
        user_id,
        ride_id,
        group_id,
        message_type,
        date_from,
        date_to
      }
    }
  });
});

// Get chat statistics (ENHANCED)
const getChatStats = catchAsync(async (req, res, next) => {
  const { chat_type, user_id, ride_id, group_id, days = 30 } = req.query;

  const whereClause = { 
    is_deleted: false,
    createdAt: {
      [Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    }
  };
  
  if (chat_type) whereClause.chat_type = chat_type;
  if (ride_id) whereClause.ride_id = ride_id;
  if (group_id) whereClause.group_id = group_id;
  
  // For direct messages, ensure access and friendship
  if (chat_type === 'direct' && user_id) {
    const areFriends = await UserConnection.areFriends(req.userId, user_id);
    if (!areFriends) {
      return next(new AppError('Access denied', 403));
    }

    whereClause[Op.or] = [
      { sender_id: req.userId, recipient_id: user_id },
      { sender_id: user_id, recipient_id: req.userId }
    ];
  } else if (chat_type === 'direct') {
    const friendConnections = await UserConnection.findAll({
      where: {
        [Op.or]: [
          { user_id: req.userId },
          { connected_user_id: req.userId }
        ],
        status: 'accepted'
      }
    });

    const friendIds = friendConnections.map(conn => 
      conn.user_id === req.userId ? conn.connected_user_id : conn.user_id
    );

    whereClause[Op.or] = [
      { sender_id: req.userId, recipient_id: { [Op.in]: friendIds } },
      { sender_id: { [Op.in]: friendIds }, recipient_id: req.userId }
    ];
  }

  const [messageTypeStats, totalMessages, dailyStats] = await Promise.all([
    // Message type distribution
    Chat.findAll({
      where: whereClause,
      attributes: [
        'message_type',
        [Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'count']
      ],
      group: ['message_type']
    }),

    // Total message count
    Chat.count({ where: whereClause }),

    // Daily message count for trend analysis
    Chat.findAll({
      where: whereClause,
      attributes: [
        [Chat.sequelize.fn('DATE', Chat.sequelize.col('createdAt')), 'date'],
        [Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'count']
      ],
      group: [Chat.sequelize.fn('DATE', Chat.sequelize.col('createdAt'))],
      order: [[Chat.sequelize.fn('DATE', Chat.sequelize.col('createdAt')), 'ASC']]
    })
  ]);

  // Get most active users in the chat context
  let activeUsers = [];
  if (!chat_type || chat_type === 'direct') {
    activeUsers = await Chat.findAll({
      where: {
        ...whereClause,
        [Op.or]: [
          { sender_id: req.userId },
          { recipient_id: req.userId }
        ]
      },
      attributes: [
        'sender_id',
        [Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'message_count']
      ],
      group: ['sender_id'],
      order: [[Chat.sequelize.fn('COUNT', Chat.sequelize.col('id')), 'DESC']],
      limit: 10,
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'first_name', 'last_name', 'profile_picture']
        }
      ]
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      period_days: days,
      total_messages: totalMessages,
      message_types: messageTypeStats,
      daily_stats: dailyStats,
      active_users: activeUsers,
      chat_context: {
        chat_type,
        user_id,
        ride_id,
        group_id
      }
    }
  });
});

// Mark messages as read (ENHANCED)
const markAsRead = catchAsync(async (req, res, next) => {
  const { message_ids, user_id, chat_type, ride_id, group_id } = req.body;

  let updateResult;

  if (message_ids && Array.isArray(message_ids)) {
    // Mark specific messages as read
    updateResult = await Chat.update(
      { is_read: true, read_at: new Date() },
      {
        where: {
          id: { [Op.in]: message_ids },
          [Op.or]: [
            { recipient_id: req.userId }, // Direct messages
            { sender_id: { [Op.ne]: req.userId } } // Group/ride messages
          ],
          is_read: false,
          is_deleted: false
        }
      }
    );
  } else if (user_id && chat_type === 'direct') {
    // Check friendship before marking as read
    const areFriends = await UserConnection.areFriends(req.userId, user_id);
    if (!areFriends) {
      return next(new AppError('Access denied', 403));
    }

    // Mark all messages from a specific user as read
    updateResult = await Chat.update(
      { is_read: true, read_at: new Date() },
      {
        where: {
          chat_type: 'direct',
          sender_id: user_id,
          recipient_id: req.userId,
          is_read: false,
          is_deleted: false
        }
      }
    );
  } else if (ride_id && chat_type === 'ride') {
    // Verify ride access
    const ride = await Ride.findByPk(ride_id, {
      include: [{
        model: User,
        as: 'participants',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!ride) {
      return next(new AppError('Ride not found', 404));
    }

    const isParticipant = ride.participants?.some(p => p.id === req.userId);
    const isCreator = ride.creator_id === req.userId;

    if (!isParticipant && !isCreator) {
      return next(new AppError('Access denied', 403));
    }

    updateResult = await Chat.update(
      { is_read: true, read_at: new Date() },
      {
        where: {
          chat_type: 'ride',
          ride_id: ride_id,
          sender_id: { [Op.ne]: req.userId },
          is_read: false,
          is_deleted: false
        }
      }
    );
  } else if (group_id && chat_type === 'group') {
    // Verify group access
    const group = await Group.findByPk(group_id, {
      include: [{
        model: User,
        as: 'members',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!group) {
      return next(new AppError('Group not found', 404));
    }

    const isMember = group.members?.some(m => m.id === req.userId);
    const isAdmin = group.admin_id === req.userId;

    if (!isMember && !isAdmin) {
      return next(new AppError('Access denied', 403));
    }

    updateResult = await Chat.update(
      { is_read: true, read_at: new Date() },
      {
        where: {
          chat_type: 'group',
          group_id: group_id,
          sender_id: { [Op.ne]: req.userId },
          is_read: false,
          is_deleted: false
        }
      }
    );
  } else {
    return next(new AppError('Invalid parameters. Provide message_ids or user_id/ride_id/group_id with chat_type', 400));
  }

  res.status(200).json({
    status: 'success',
    message: 'Messages marked as read',
    data: {
      updated_count: updateResult[0]
    }
  });
});

// Get unread message count (ENHANCED)
const getUnreadCount = catchAsync(async (req, res, next) => {
  const { chat_type, user_id, ride_id, group_id } = req.query;

  const whereClause = {
    is_read: false,
    is_deleted: false,
    sender_id: { [Op.ne]: req.userId }
  };

  if (chat_type) whereClause.chat_type = chat_type;

  if (chat_type === 'direct' && user_id) {
    // Check friendship
    const areFriends = await UserConnection.areFriends(req.userId, user_id);
    if (!areFriends) {
      return next(new AppError('Access denied', 403));
    }

    whereClause.sender_id = user_id;
    whereClause.recipient_id = req.userId;
  } else if (chat_type === 'direct') {
    whereClause.recipient_id = req.userId;
  }

  if (ride_id) {
    // Verify ride access
    const ride = await Ride.findByPk(ride_id, {
      include: [{
        model: User,
        as: 'participants',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!ride) {
      return next(new AppError('Ride not found', 404));
    }

    const isParticipant = ride.participants?.some(p => p.id === req.userId);
    const isCreator = ride.creator_id === req.userId;

    if (!isParticipant && !isCreator) {
      return next(new AppError('Access denied', 403));
    }

    whereClause.ride_id = ride_id;
  }

  if (group_id) {
    // Verify group access
    const group = await Group.findByPk(group_id, {
      include: [{
        model: User,
        as: 'members',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!group) {
      return next(new AppError('Group not found', 404));
    }

    const isMember = group.members?.some(m => m.id === req.userId);
    const isAdmin = group.admin_id === req.userId;

    if (!isMember && !isAdmin) {
      return next(new AppError('Access denied', 403));
    }

    whereClause.group_id = group_id;
  }

  const unreadCount = await Chat.count({ where: whereClause });

  // Get breakdown by chat type if no specific type requested
  let breakdown = null;
  if (!chat_type) {
    const directCount = await Chat.count({
      where: {
        ...whereClause,
        chat_type: 'direct'
      }
    });

    const rideCount = await Chat.count({
      where: {
        ...whereClause,
        chat_type: 'ride'
      }
    });

    const groupCount = await Chat.count({
      where: {
        ...whereClause,
        chat_type: 'group'
      }
    });

    breakdown = {
      direct: directCount,
      ride: rideCount,
      group: groupCount
    };
  }

  res.status(200).json({
    status: 'success',
    data: {
      unread_count: unreadCount,
      breakdown,
      context: {
        chat_type,
        user_id,
        ride_id,
        group_id
      }
    }
  });
});

// Get user connections (friends list) - ENHANCED
const getUserConnections = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, status = 'accepted', search } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  let whereClause = {
    [Op.or]: [
      { user_id: req.userId },
      { connected_user_id: req.userId }
    ],
    status,
    is_archived: false
  };

  // Include user search in the query
  const includeOptions = [
    {
      model: User,
      as: 'user',
      attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
      required: false
    },
    {
      model: User,
      as: 'connectedUser',
      attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active'],
      required: false
    }
  ];

  // Add search filter if provided
  if (search && search.trim()) {
    const searchTerm = search.trim();
    includeOptions.forEach(include => {
      include.where = {
        [Op.or]: [
          { first_name: { [Op.iLike]: `%${searchTerm}%` } },
          { last_name: { [Op.iLike]: `%${searchTerm}%` } }
        ]
      };
      include.required = true;
    });
  }

  const connections = await UserConnection.findAndCountAll({
    where: whereClause,
    include: includeOptions,
    limit: limitNum,
    offset,
    order: [
      ['last_message_at', 'DESC'],
      ['accepted_at', 'DESC']
    ]
  });

  // Format the response to always show the "other" user
  const formattedConnections = {
    ...connections,
    rows: connections.rows.map(conn => {
      const otherUser = conn.user?.id === req.userId ? conn.connectedUser : conn.user;
      return {
        ...conn.toJSON(),
        friend: otherUser,
        friendship_duration: conn.accepted_at ? 
          Math.floor((Date.now() - new Date(conn.accepted_at).getTime()) / (1000 * 60 * 60 * 24)) : 0
      };
    })
  };

  const response = getPagingData(formattedConnections, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: {
      ...response,
      filters: {
        status,
        search
      }
    }
  });
});

// Get online friends
const getOnlineFriends = catchAsync(async (req, res, next) => {
  const { limit = 50 } = req.query;

  const connections = await UserConnection.findAll({
    where: {
      [Op.or]: [
        { user_id: req.userId },
        { connected_user_id: req.userId }
      ],
      status: 'accepted',
      is_archived: false
    },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active', 'is_online'],
        required: false
      },
      {
        model: User,
        as: 'connectedUser',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'last_active', 'is_online'],
        required: false
      }
    ],
    limit: parseInt(limit),
    order: [['last_message_at', 'DESC']]
  });

  // Filter and format online friends
  const onlineFriends = connections
    .map(conn => {
      const friend = conn.user?.id === req.userId ? conn.connectedUser : conn.user;
      return friend;
    })
    .filter(friend => friend && (friend.is_online || 
      (friend.last_active && Date.now() - new Date(friend.last_active).getTime() < 5 * 60 * 1000))) // 5 minutes
    .slice(0, limit);

  res.status(200).json({
    status: 'success',
    data: {
      online_friends: onlineFriends,
      total_online: onlineFriends.length
    }
  });
});

// React to message (NEW FEATURE)
const reactToMessage = catchAsync(async (req, res, next) => {
  const { messageId } = req.params;
  const { reaction } = req.body; // emoji or reaction type

  if (!reaction) {
    return next(new AppError('Reaction is required', 400));
  }

  const chat = await Chat.findByPk(messageId);

  if (!chat) {
    return next(new AppError('Message not found', 404));
  }

  // Verify user has access to this message
  if (chat.chat_type === 'direct') {
    if (chat.sender_id !== req.userId && chat.recipient_id !== req.userId) {
      return next(new AppError('Access denied', 403));
    }

    // Check friendship for direct messages
    const otherUserId = chat.sender_id === req.userId ? chat.recipient_id : chat.sender_id;
    const areFriends = await UserConnection.areFriends(req.userId, otherUserId);
    if (!areFriends) {
      return next(new AppError('Access denied', 403));
    }
  }

  // Initialize reactions object if it doesn't exist
  let reactions = chat.metadata?.reactions || {};
  
  // Toggle reaction
  if (reactions[reaction] && reactions[reaction].includes(req.userId)) {
    // Remove reaction
    reactions[reaction] = reactions[reaction].filter(userId => userId !== req.userId);
    if (reactions[reaction].length === 0) {
      delete reactions[reaction];
    }
  } else {
    // Add reaction
    if (!reactions[reaction]) {
      reactions[reaction] = [];
    }
    reactions[reaction].push(req.userId);
  }

  // Update message metadata
  await chat.update({
    metadata: {
      ...chat.metadata,
      reactions
    }
  });

  res.status(200).json({
    status: 'success',
    message: 'Reaction updated successfully',
    data: {
      reactions,
      user_reaction: reaction
    }
  });
});

module.exports = {
  sendMessage,
  getDirectMessages,
  getRideMessages,
  getGroupMessages,
  startConversation,
  toggleBlockUser,
  toggleArchiveConversation,
  editMessage,
  deleteMessage,
  getMessageById,
  searchMessages,
  getChatStats,
  markAsRead,
  getUnreadCount,
  getChatList,
  getUserConnections,
  getOnlineFriends,
  reactToMessage
};