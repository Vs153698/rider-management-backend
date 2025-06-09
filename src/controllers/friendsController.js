const { User, UserConnection } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { getPagination, getPagingData } = require('../utils/helpers');
const { Op } = require('sequelize');

// Send friend request
const sendFriendRequest = catchAsync(async (req, res, next) => {
  const { user_id } = req.body;

  if (!user_id) {
    return next(new AppError('User ID required', 400));
  }

  if (user_id === req.userId) {
    return next(new AppError('Cannot send friend request to yourself', 400));
  }

  // Check if target user exists
  const targetUser = await User.findByPk(user_id, {
    attributes: ['id', 'first_name', 'last_name', 'profile_picture']
  });

  if (!targetUser) {
    return next(new AppError('User not found', 404));
  }

  // Check if connection already exists
  const existingConnection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: user_id },
        { user_id: user_id, connected_user_id: req.userId }
      ]
    }
  });

  if (existingConnection) {
    let message = '';
    switch (existingConnection.status) {
      case 'pending':
        if (existingConnection.initiated_by === req.userId) {
          message = 'Friend request already sent';
        } else {
          message = 'This user has already sent you a friend request';
        }
        break;
      case 'accepted':
        message = 'You are already friends with this user';
        break;
      case 'blocked':
        message = 'Cannot send friend request to this user';
        break;
      case 'rejected':
        message = 'Friend request was previously rejected';
        break;
    }
    return next(new AppError(message, 400));
  }

  // Create friend request
  const connection = await UserConnection.create({
    user_id: req.userId,
    connected_user_id: user_id,
    initiated_by: req.userId,
    status: 'pending'
  });

  res.status(201).json({
    status: 'success',
    message: 'Friend request sent successfully',
    data: {
      user: targetUser,
      connection_id: connection.id,
      request_status: 'sent'
    }
  });
});

// Accept friend request
const acceptFriendRequest = catchAsync(async (req, res, next) => {
  const { user_id } = req.body;

  // Find the pending friend request
  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { 
          user_id: user_id, 
          connected_user_id: req.userId,
          status: 'pending'
        },
        { 
          user_id: req.userId, 
          connected_user_id: user_id,
          status: 'pending'
        }
      ]
    },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'connectedUser',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  if (!connection) {
    return next(new AppError('No pending friend request found', 404));
  }

  // Only the recipient of the request can accept it
  if (connection.initiated_by === req.userId) {
    return next(new AppError('Cannot accept your own friend request', 400));
  }

  // Accept the request
  await connection.update({
    status: 'accepted',
    accepted_at: new Date()
  });

  const friend = connection.user.id === req.userId ? connection.connectedUser : connection.user;

  res.status(200).json({
    status: 'success',
    message: 'Friend request accepted',
    data: {
      friend,
      connection_id: connection.id
    }
  });
});

// Reject friend request
const rejectFriendRequest = catchAsync(async (req, res, next) => {
  const { user_id } = req.body;

  // Find the pending friend request
  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { 
          user_id: user_id, 
          connected_user_id: req.userId,
          status: 'pending'
        },
        { 
          user_id: req.userId, 
          connected_user_id: user_id,
          status: 'pending'
        }
      ]
    }
  });

  if (!connection) {
    return next(new AppError('No pending friend request found', 404));
  }

  // Only the recipient of the request can reject it
  if (connection.initiated_by === req.userId) {
    return next(new AppError('Cannot reject your own friend request', 400));
  }

  // Reject the request
  await connection.update({
    status: 'rejected',
    rejected_at: new Date()
  });

  res.status(200).json({
    status: 'success',
    message: 'Friend request rejected'
  });
});

// Remove friend (unfriend)
const removeFriend = catchAsync(async (req, res, next) => {
  const { userId: friendId } = req.params;

  // Find the friendship
  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: friendId },
        { user_id: friendId, connected_user_id: req.userId }
      ],
      status: 'accepted'
    }
  });

  if (!connection) {
    return next(new AppError('Friendship not found', 404));
  }

  // Delete the connection
  await connection.destroy();

  res.status(200).json({
    status: 'success',
    message: 'Friend removed successfully'
  });
});

// Block user
const blockUser = catchAsync(async (req, res, next) => {
  const { user_id } = req.body;

  if (user_id === req.userId) {
    return next(new AppError('Cannot block yourself', 400));
  }

  // Check if target user exists
  const targetUser = await User.findByPk(user_id);
  if (!targetUser) {
    return next(new AppError('User not found', 404));
  }

  // Find or create connection
  let connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: user_id },
        { user_id: user_id, connected_user_id: req.userId }
      ]
    }
  });

  if (connection) {
    // Update existing connection to blocked
    await connection.update({
      status: 'blocked',
      blocked_at: new Date()
    });
  } else {
    // Create new blocked connection
    connection = await UserConnection.create({
      user_id: req.userId,
      connected_user_id: user_id,
      initiated_by: req.userId,
      status: 'blocked',
      blocked_at: new Date()
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'User blocked successfully'
  });
});

// Unblock user
const unblockUser = catchAsync(async (req, res, next) => {
  const { user_id } = req.body;

  // Find the blocked connection
  const connection = await UserConnection.findOne({
    where: {
      [Op.or]: [
        { user_id: req.userId, connected_user_id: user_id },
        { user_id: user_id, connected_user_id: req.userId }
      ],
      status: 'blocked'
    }
  });

  if (!connection) {
    return next(new AppError('No blocked connection found', 404));
  }

  // Remove the connection entirely (unblock)
  await connection.destroy();

  res.status(200).json({
    status: 'success',
    message: 'User unblocked successfully'
  });
});

// Get friend requests (sent or received)
const getFriendRequests = catchAsync(async (req, res, next) => {
  const { type = 'received', page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  let whereClause = { status: 'pending' };
  let includeClause;

  if (type === 'received') {
    // Requests received by current user
    whereClause.connected_user_id = req.userId;
    includeClause = {
      model: User,
      as: 'user', // The person who sent the request
      attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'bio']
    };
  } else {
    // Requests sent by current user
    whereClause.user_id = req.userId;
    includeClause = {
      model: User,
      as: 'connectedUser', // The person who received the request
      attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'bio']
    };
  }

  const requests = await UserConnection.findAndCountAll({
    where: whereClause,
    include: [includeClause],
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(requests, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: {
      ...response,
      type
    }
  });
});

// Get friends list
const getFriendsList = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, search, online_only = false } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  let whereClause = {
    [Op.or]: [
      { user_id: req.userId },
      { connected_user_id: req.userId }
    ],
    status: 'accepted',
    is_archived: false
  };

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

  // Add search filter
  if (search) {
    includeOptions[0].where = {
      [Op.or]: [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } }
      ]
    };
    includeOptions[1].where = {
      [Op.or]: [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } }
      ]
    };
  }

  const connections = await UserConnection.findAndCountAll({
    where: whereClause,
    include: includeOptions,
    limit: limitNum,
    offset,
    order: [['last_message_at', 'DESC']]
  });

  // Extract friend information and filter for online status if needed
  const friends = connections.rows.map(conn => {
    const friend = conn.user?.id === req.userId ? conn.connectedUser : conn.user;
    if (!friend) return null;

    const isOnline = friend.last_active && 
      new Date(friend.last_active) > new Date(Date.now() - 5 * 60 * 1000);

    return {
      ...friend.toJSON(),
      is_online: isOnline,
      last_message_at: conn.last_message_at,
      friendship_date: conn.accepted_at
    };
  }).filter(friend => {
    if (!friend) return false;
    if (online_only) return friend.is_online;
    return true;
  });

  const response = getPagingData({ 
    rows: friends, 
    count: online_only ? friends.length : connections.count 
  }, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Search friends
const searchFriends = catchAsync(async (req, res, next) => {
  const { q, page = 1, limit = 10 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  if (!q || q.length < 2) {
    return next(new AppError('Search query must be at least 2 characters', 400));
  }

  const connections = await UserConnection.findAndCountAll({
    where: {
      [Op.or]: [
        { user_id: req.userId },
        { connected_user_id: req.userId }
      ],
      status: 'accepted'
    },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
        where: {
          [Op.or]: [
            { first_name: { [Op.iLike]: `%${q}%` } },
            { last_name: { [Op.iLike]: `%${q}%` } }
          ]
        },
        required: false
      },
      {
        model: User,
        as: 'connectedUser',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
        where: {
          [Op.or]: [
            { first_name: { [Op.iLike]: `%${q}%` } },
            { last_name: { [Op.iLike]: `%${q}%` } }
          ]
        },
        required: false
      }
    ],
    limit: limitNum,
    offset
  });

  // Extract friends that match the search
  const friends = connections.rows.map(conn => {
    const friend = conn.user?.id === req.userId ? conn.connectedUser : conn.user;
    return friend;
  }).filter(friend => friend);

  const response = getPagingData({ 
    rows: friends, 
    count: connections.count 
  }, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get friendship status with specific user
const getFriendStatus = catchAsync(async (req, res, next) => {
  const { userId: otherUserId } = req.params;

  if (otherUserId === req.userId) {
    return res.status(200).json({
      status: 'success',
      data: {
        user_id: otherUserId,
        relationship: 'self',
        can_chat: false,
        can_send_request: false
      }
    });
  }

  const { status, connection, canChat } = await UserConnection.getConnectionStatus(req.userId, otherUserId);

  let canSendRequest = false;
  if (status === 'none' || status === 'rejected') {
    canSendRequest = true;
  }

  res.status(200).json({
    status: 'success',
    data: {
      user_id: otherUserId,
      relationship: status,
      can_chat: canChat,
      can_send_request: canSendRequest,
      connection_date: connection?.accepted_at || null,
      request_date: connection?.created_at || null
    }
  });
});

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  getFriendRequests,
  getFriendsList,
  searchFriends,
  getFriendStatus
};