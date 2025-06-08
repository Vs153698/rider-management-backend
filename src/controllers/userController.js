const { User, Ride, Group, Rental } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { cacheSet, cacheDel } = require('../config/redis');
const { sanitizeUser, getPagination, getPagingData } = require('../utils/helpers');

// Get current user profile
const getProfile = catchAsync(async (req, res, next) => {
  const user = await User.findByPk(req.userId, {
    include: [
      {
        model: Ride,
        as: 'createdRides',
        limit: 5,
        order: [['created_at', 'DESC']]
      },
      // {
      //   model: Group,
      //   as: 'joinedGroups',
      //   through: { attributes: [] },
      //   limit: 5
      // }
    ]
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: sanitizeUser(user.toJSON())
    }
  });
});

// Update user profile
const updateProfile = catchAsync(async (req, res, next) => {
  const {
    first_name,
    last_name,
    email,
    bio,
    location,
    emergency_contact,
    bike_info
  } = req.body;

  const user = await User.findByPk(req.userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Update basic info
  const updateData = {};
  if (first_name) updateData.first_name = first_name;
  if (last_name) updateData.last_name = last_name;
  if (email) updateData.email = email;
  if (bio) updateData.bio = bio;
  if (location) updateData.location = location;
  if (emergency_contact) updateData.emergency_contact = emergency_contact;
  if (bike_info) updateData.bike_info = bike_info;

  const updatedUser = await user.update(updateData);

  // Clear cache
  await cacheDel(`user:${user.id}`);

  res.status(200).json({
    status: 'success',
    message: 'Profile updated successfully',
    data: {
      user: sanitizeUser(updatedUser.toJSON())
    }
  });
});

// Upload profile picture
const uploadProfilePicture = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError('Please upload a profile picture', 400));
  }

  const user = await User.findByPk(req.userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  try {
    // Upload to Cloudinary
    const result = await uploadToCloudinary(req.file, 'profile-pictures');

    // Delete old profile picture if exists
    if (user.profile_picture) {
      const publicId = user.profile_picture.split('/').pop().split('.')[0];
      await deleteFromCloudinary(publicId);
    }

    // Update user profile picture
    const updatedUser = await user.update({
      profile_picture: result.secure_url
    });

    // Clear cache
    await cacheDel(`user:${user.id}`);

    res.status(200).json({
      status: 'success',
      message: 'Profile picture updated successfully',
      data: {
        profile_picture: result.secure_url
      }
    });
  } catch (error) {
    return next(new AppError('Failed to upload profile picture', 500));
  }
});

// Upload cover picture
const uploadCoverPicture = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError('Please upload a cover picture', 400));
  }

  const user = await User.findByPk(req.userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  try {
    // Upload to Cloudinary
    const result = await uploadToCloudinary(req.file, 'cover-pictures');

    // Delete old cover picture if exists
    if (user.cover_picture) {
      const publicId = user.cover_picture.split('/').pop().split('.')[0];
      await deleteFromCloudinary(publicId);
    }

    // Update user cover picture
    const updatedUser = await user.update({
      cover_picture: result.secure_url
    });

    // Clear cache
    await cacheDel(`user:${user.id}`);

    res.status(200).json({
      status: 'success',
      message: 'Cover picture updated successfully',
      data: {
        cover_picture: result.secure_url
      }
    });
  } catch (error) {
    return next(new AppError('Failed to upload cover picture', 500));
  }
});

// Get user by ID (public profile)
const getUserById = catchAsync(async (req, res, next) => {
  const { userId } = req.params;

  const user = await User.findByPk(userId, {
    attributes: [
      'id', 'first_name', 'last_name', 'profile_picture', 
      'cover_picture', 'bio', 'bike_info', 'created_at'
    ],
    include: [
      {
        model: Ride,
        as: 'createdRides',
        where: { status: 'upcoming' },
        required: false,
        limit: 3,
        order: [['ride_date', 'ASC']]
      }
    ]
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: user.toJSON()
    }
  });
});

// Search users
const searchUsers = catchAsync(async (req, res, next) => {
  const { q, page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  if (!q || q.length < 2) {
    return next(new AppError('Search query must be at least 2 characters', 400));
  }

  const users = await User.findAndCountAll({
    where: {
      [Op.or]: [
        { first_name: { [Op.iLike]: `%${q}%` } },
        { last_name: { [Op.iLike]: `%${q}%` } },
        { phone_number: { [Op.like]: `%${q}%` } }
      ],
      is_active: true,
      is_verified: true
    },
    attributes: [
      'id', 'first_name', 'last_name', 'profile_picture', 'bio'
    ],
    limit: limitNum,
    offset,
    order: [['first_name', 'ASC']]
  });

  const response = getPagingData(users, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get user's rides
const getUserRides = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { status = 'all', page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  const whereClause = { creator_id: userId };
  if (status !== 'all') {
    whereClause.status = status;
  }

  const rides = await Ride.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'participants',
        through: { attributes: [] },
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ],
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(rides, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get user's groups
const getUserGroups = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  const user = await User.findByPk(userId, {
    include: [
      {
        model: Group,
        as: 'joinedGroups',
        through: { attributes: [] },
        include: [
          {
            model: User,
            as: 'admin',
            attributes: ['id', 'first_name', 'last_name', 'profile_picture']
          }
        ]
      }
    ]
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const groups = user.joinedGroups || [];
  const total = groups.length;
  const paginatedGroups = groups.slice(offset, offset + limitNum);

  res.status(200).json({
    status: 'success',
    data: {
      groups: paginatedGroups,
      totalItems: total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: parseInt(page),
      hasNext: offset + limitNum < total,
      hasPrev: page > 1
    }
  });
});

// Get user's rentals
const getUserRentals = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { status = 'all', page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  const whereClause = { owner_id: userId };
  if (status !== 'all') {
    whereClause.status = status;
  }

  const rentals = await Rental.findAndCountAll({
    where: whereClause,
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(rentals, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Deactivate account
const deactivateAccount = catchAsync(async (req, res, next) => {
  const user = await User.findByPk(req.userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  await user.update({ is_active: false });

  // Clear cache
  await cacheDel(`user:${user.id}`);

  res.status(200).json({
    status: 'success',
    message: 'Account deactivated successfully'
  });
});

// Delete account
const deleteAccount = catchAsync(async (req, res, next) => {
  const { password } = req.body;
  
  const user = await User.findByPk(req.userId, {
    attributes: { include: ['password'] }
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Verify password
  if (!(await user.comparePassword(password))) {
    return next(new AppError('Incorrect password', 400));
  }

  // Soft delete - anonymize data instead of hard delete
  await user.update({
    first_name: 'Deleted',
    last_name: 'User',
    email: null,
    phone_number: `deleted_${user.id}`,
    profile_picture: null,
    cover_picture: null,
    bio: null,
    is_active: false,
    is_verified: false
  });

  // Clear cache
  await cacheDel(`user:${user.id}`);

  res.status(200).json({
    status: 'success',
    message: 'Account deleted successfully'
  });
});

module.exports = {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  uploadCoverPicture,
  getUserById,
  searchUsers,
  getUserRides,
  getUserGroups,
  getUserRentals,
  deactivateAccount,
  deleteAccount
};