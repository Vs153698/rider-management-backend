const { Ride, User, Group, Payment } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { uploadToCloudinary } = require('../config/cloudinary');
const { findVisibleRides, calculateDistance } = require('../services/locationService');
const { createPaymentOrder } = require('../services/paymentService');
const { sendRideInvitation, notifyRideParticipants } = require('../services/notificationService');
const { getPagination, getPagingData } = require('../utils/helpers');
const { Op } = require('sequelize');

// Helper function to build visibility where clause based on user access
const buildVisibilityWhereClause = async (userId) => {
  if (!userId) {
    return { visibility: 'public' };
  }

  const userGroups = await User.findByPk(userId, {
    include: [{
      model: Group,
      as: 'groups',
      through: { attributes: [] },
      attributes: ['id']
    }]
  });

  const userGroupIds = userGroups?.groups?.map(group => group.id) || [];

  const visibilityConditions = [
    { visibility: 'public' },
    { visibility: 'private', creator_id: userId }
  ];

  if (userGroupIds.length > 0) {
    visibilityConditions.push({
      visibility: 'group_only',
      group_id: { [Op.in]: userGroupIds }
    });
  }

  return { [Op.or]: visibilityConditions };
};

// Helper function to check if user can access a specific ride
const canUserAccessRide = async (ride, userId) => {
  if (!ride) return false;

  if (ride.visibility === 'public') return true;

  if (!userId) return false;

  if (ride.visibility === 'private') {
    return ride.creator_id === userId;
  }

  if (ride.visibility === 'group_only' && ride.group_id) {
    const userWithGroups = await User.findByPk(userId, {
      include: [{
        model: Group,
        as: 'groups',
        where: { id: ride.group_id },
        through: { attributes: [] },
        required: false
      }]
    });
    
    return userWithGroups?.groups?.length > 0;
  }

  return false;
};

// Create a new ride
const createRide = catchAsync(async (req, res, next) => {
  const rideData = {
    ...req.body,
    creator_id: req.userId
  };

  // Validate group access for group_only rides
  if (rideData.visibility === 'group_only' && rideData.group_id) {
    const userWithGroup = await User.findByPk(req.userId, {
      include: [{
        model: Group,
        as: 'groups',
        where: { id: rideData.group_id },
        through: { attributes: [] },
        required: false
      }]
    });

    if (!userWithGroup?.groups?.length) {
      return next(new AppError('You are not a member of this group', 403));
    }
  }

  // Upload cover image if provided
  if (req.file) {
    const result = await uploadToCloudinary(req.file, 'ride-covers');
    rideData.cover_image = result.secure_url;
  }

  const ride = await Ride.create(rideData);

  // Include creator details in response
  const rideWithCreator = await Ride.findByPk(ride.id, {
    include: [
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  res.status(201).json({
    status: 'success',
    message: 'Ride created successfully',
    data: {
      ride: rideWithCreator
    }
  });
});

// Get all rides with proper visibility filtering
const getRides = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status = 'upcoming',
    is_paid,
    group_id,
    creator_id,
    date_from,
    date_to,
    sort = 'ride_date',
    order = 'ASC'
  } = req.query;

  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  const whereClause = { 
    status,
    ...(await buildVisibilityWhereClause(req.userId))
  };
  
  if (is_paid !== undefined) whereClause.is_paid = is_paid === 'true';
  if (creator_id) whereClause.creator_id = creator_id;
  
  if (group_id) {
    if (req.userId) {
      const userWithGroup = await User.findByPk(req.userId, {
        include: [{
          model: Group,
          as: 'groups',
          where: { id: group_id },
          through: { attributes: [] },
          required: false
        }]
      });
      
      if (userWithGroup?.groups?.length > 0) {
        whereClause.group_id = group_id;
      } else {
        whereClause.group_id = group_id;
        whereClause.visibility = 'public';
      }
    } else {
      whereClause.group_id = group_id;
      whereClause.visibility = 'public';
    }
  }
  
  if (date_from || date_to) {
    whereClause.ride_date = {};
    if (date_from) whereClause.ride_date[Op.gte] = new Date(date_from);
    if (date_to) whereClause.ride_date[Op.lte] = new Date(date_to);
  }

  const rides = await Ride.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'participants',
        through: { attributes: [] },
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name', 'group_type'],
        required: false
      }
    ],
    limit: limitNum,
    offset,
    order: [[sort, order]]
  });

  const response = getPagingData(rides, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get nearby rides with proper visibility filtering
const getNearbyRides = catchAsync(async (req, res, next) => {
  const { latitude, longitude, radius = 50 } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const visibilityClause = await buildVisibilityWhereClause(req.userId);

  const rides = await Ride.findAll({
    where: {
      status: 'upcoming',
      start_location: { [Op.ne]: null },
      ...visibilityClause
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
        through: { attributes: [] },
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name', 'group_type'],
        required: false
      }
    ]
  });

  const userLat = parseFloat(latitude);
  const userLng = parseFloat(longitude);
  const maxRadius = parseInt(radius);

  const nearbyRides = rides.filter(ride => {
    if (!ride.start_location?.latitude || !ride.start_location?.longitude) {
      return false;
    }

    const distance = calculateDistance(
      userLat,
      userLng,
      ride.start_location.latitude,
      ride.start_location.longitude
    );

    return distance <= maxRadius;
  });

  res.status(200).json({
    status: 'success',
    data: {
      rides: nearbyRides,
      count: nearbyRides.length
    }
  });
});

// Get ride by ID with access control
const getRideById = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
      },
      {
        model: User,
        as: 'participants',
        through: { attributes: [] },
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name', 'group_type'],
        required: false
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  const canAccess = await canUserAccessRide(ride, req.userId);
  if (!canAccess) {
    return next(new AppError('You do not have permission to view this ride', 403));
  }

  let userStatus = {
    is_creator: false,
    is_participant: false,
    can_join: false
  };

  if (req.userId) {
    const isParticipant = ride.participants?.some(p => p.id === req.userId) || false;
    const isCreator = ride.creator_id === req.userId;

    userStatus = {
      is_creator: isCreator,
      is_participant: isParticipant,
      can_join: ride.canJoin() && !isParticipant && !isCreator
    };
  }

  res.status(200).json({
    status: 'success',
    data: {
      ride: {
        ...ride.toJSON(),
        user_status: userStatus
      }
    }
  });
});

// Update ride
const updateRide = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findByPk(rideId);
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (!ride.canEdit(req.userId)) {
    return next(new AppError('You can only edit your own upcoming rides', 403));
  }

  const updateData = { ...req.body };
  if (updateData.visibility === 'group_only' && updateData.group_id) {
    const userWithGroup = await User.findByPk(req.userId, {
      include: [{
        model: Group,
        as: 'groups',
        where: { id: updateData.group_id },
        through: { attributes: [] },
        required: false
      }]
    });

    if (!userWithGroup?.groups?.length) {
      return next(new AppError('You are not a member of this group', 403));
    }
  }

  if (req.file) {
    const result = await uploadToCloudinary(req.file, 'ride-covers');
    updateData.cover_image = result.secure_url;
  }

  const updatedRide = await ride.update(updateData);

  const participants = await User.findAll({
    include: [{
      model: Ride,
      as: 'joinedRides',
      where: { id: rideId },
      through: { attributes: [] }
    }]
  });

  if (participants.length > 0) {
    const message = `Ride "${ride.title}" has been updated. Check the app for details.`;
    await notifyRideParticipants(participants, message);
  }

  res.status(200).json({
    status: 'success',
    message: 'Ride updated successfully',
    data: {
      ride: updatedRide
    }
  });
});

// Join ride with proper payment handling for React Native
const joinRide = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;
  const { pricing_option } = req.body;

  console.log('🚀 Join ride request:', { rideId, pricing_option, userId: req.userId });

  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'first_name', 'last_name']
      },
      {
        model: User,
        as: 'participants',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  // Check access permissions
  const canAccess = await canUserAccessRide(ride, req.userId);
  if (!canAccess) {
    return next(new AppError('You do not have permission to join this ride', 403));
  }

  // Validation checks
  if (ride.creator_id === req.userId) {
    return next(new AppError('Ride creators cannot join their own rides', 400));
  }

  const isAlreadyParticipant = ride.participants?.some(p => p.id === req.userId);
  if (isAlreadyParticipant) {
    return next(new AppError('You have already joined this ride', 400));
  }

  if (ride.current_participants >= ride.max_participants) {
    return next(new AppError('This ride is currently full', 400));
  }

  // Handle pricing for paid rides
  let selectedPrice = 0;
  let finalPricingOption = pricing_option;

  if (ride.is_paid) {
    console.log('💰 Processing paid ride pricing...');
    
    const pricingOptions = typeof ride.pricing_options === 'string' 
      ? JSON.parse(ride.pricing_options) 
      : ride.pricing_options || {};

    console.log('📋 Available pricing options:', pricingOptions);

    // Extract pricing options
    const withBikePrice = pricingOptions.with_bike ? parseFloat(pricingOptions.with_bike) : null;
    const withoutBikePrice = pricingOptions.without_bike ? parseFloat(pricingOptions.without_bike) : null;
    const basePrice = ride.price ? parseFloat(ride.price) : null;

    // Determine available options
    const availableOptions = [];
    if (withBikePrice && withBikePrice > 0) availableOptions.push('with_bike');
    if (withoutBikePrice && withoutBikePrice > 0) availableOptions.push('without_bike');

    console.log('✅ Available options:', availableOptions);

    if (availableOptions.length > 1) {
      // Multiple options - user must select
      if (!pricing_option || !availableOptions.includes(pricing_option)) {
        return res.status(400).json({
          status: 'error',
          message: 'Please select a pricing option',
          data: {
            available_options: availableOptions.map(option => ({
              option,
              price: pricingOptions[option],
              label: option === 'with_bike' ? 'With Bike' : 'Without Bike'
            })),
            requires_selection: true
          }
        });
      }
      selectedPrice = pricingOptions[pricing_option];
      finalPricingOption = pricing_option;
    } else if (availableOptions.length === 1) {
      // Single option - auto-select
      const onlyOption = availableOptions[0];
      selectedPrice = pricingOptions[onlyOption];
      finalPricingOption = onlyOption;
    } else if (basePrice && basePrice > 0) {
      // Fallback to base price
      selectedPrice = basePrice;
      finalPricingOption = 'base_price';
    } else {
      return next(new AppError('Invalid pricing configuration for this ride', 500));
    }

    // Validate price
    if (!selectedPrice || selectedPrice <= 0) {
      return next(new AppError('Invalid price calculated', 500));
    }

    console.log('💵 Final pricing:', { selectedPrice, finalPricingOption });
  }

  // Handle payment for paid rides
  if (ride.is_paid && selectedPrice > 0) {
    console.log('🔄 Creating Cashfree payment order for React Native...');
    
    try {
      const paymentOrder = await createPaymentOrder({
        user_id: req.userId,
        amount: selectedPrice,
        payment_type: 'ride_fee',
        ride_id: rideId,
        recipient_id: ride.creator_id,
        metadata: {
          pricing_option: finalPricingOption,
          ride_title: ride.title,
          selected_price: selectedPrice
        }
      });

      console.log('✅ Cashfree payment order created successfully');

      return res.status(200).json({
        status: 'success',
        message: 'Payment required to join ride',
        data: {
          payment_required: true,
          payment_order: {
            order_id: paymentOrder.order_id,
            payment_session_id: paymentOrder.payment_session_id,
            cashfree_token: paymentOrder.cashfree_token,
            amount: paymentOrder.amount,
            currency: paymentOrder.currency,
            pricing_option: finalPricingOption,
            expires_at: paymentOrder.expires_at,
            environment: paymentOrder.environment
          },
          ride_id: rideId
        }
      });

    } catch (error) {
      console.error('❌ Cashfree payment order creation failed:', error);
      return next(new AppError('Failed to create payment order. Please try again.', 500));
    }
  }

  // Free ride - add participant directly
  console.log('🆓 Processing free ride join...');
  
  try {
    const user = await User.findByPk(req.userId);
    
    // Add user to ride participants
    await ride.addParticipant(user);
    await ride.increment('current_participants');

    console.log('✅ Successfully joined free ride');

    return res.status(200).json({
      status: 'success',
      message: 'Successfully joined the ride',
      data: {
        participant_id: user.id,
        ride_id: rideId,
        pricing_option: finalPricingOption,
        amount_paid: selectedPrice,
        payment_required: false,
        joined_at: new Date()
      }
    });
  } catch (error) {
    console.error('❌ Failed to join free ride:', error);
    return next(new AppError('Failed to join ride. Please try again.', 500));
  }
});

// Leave ride
const leaveRide = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'participants',
        through: { attributes: [] }
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (ride.creator_id === req.userId) {
    return next(new AppError('Ride creator cannot leave the ride', 400));
  }

  const isParticipant = ride.participants?.some(p => p.id === req.userId);
  if (!isParticipant) {
    return next(new AppError('You are not a participant of this ride', 400));
  }

  // Remove user from ride participants
  const user = await User.findByPk(req.userId);
  await ride.removeParticipant(user);
  await ride.decrement('current_participants');

  // Handle refund for paid rides (if applicable)
  if (ride.is_paid) {
    // Check for payment and process refund logic here
    const payment = await Payment.findOne({
      where: {
        user_id: req.userId,
        ride_id: rideId,
        status: 'success'
      }
    });

    if (payment) {
      console.log('Processing refund for leaving paid ride:', payment.id);
      // Implement refund logic based on your business rules
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Successfully left the ride'
  });
});

// Cancel ride
const cancelRide = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;
  const { reason } = req.body;

  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'participants',
        through: { attributes: [] }
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (!ride.canCancel(req.userId)) {
    return next(new AppError('You can only cancel your own upcoming rides', 403));
  }

  // Update ride status
  await ride.update({
    status: 'cancelled',
    metadata: {
      ...ride.metadata,
      cancellation_reason: reason,
      cancelled_at: new Date()
    }
  });

  // Notify all participants
  if (ride.participants?.length > 0) {
    const message = `Ride "${ride.title}" has been cancelled. ${reason ? `Reason: ${reason}` : ''}`;
    await notifyRideParticipants(ride.participants, message);
  }

  // Process refunds for paid rides
  if (ride.is_paid && ride.participants?.length > 0) {
    console.log('Processing refunds for cancelled ride:', rideId);
    // Implement refund logic for all participants
  }

  res.status(200).json({
    status: 'success',
    message: 'Ride cancelled successfully'
  });
});

// Invite users to ride
const inviteToRide = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;
  const { user_ids, phone_numbers } = req.body;

  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'first_name', 'last_name']
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (ride.creator_id !== req.userId) {
    return next(new AppError('Only ride creator can send invitations', 403));
  }

  const invitations = [];

  // Invite by user IDs
  if (user_ids && user_ids.length > 0) {
    const users = await User.findAll({
      where: { id: { [Op.in]: user_ids } }
    });

    for (const user of users) {
      try {
        await sendRideInvitation(user, ride, ride.creator.getFullName());
        invitations.push({ user_id: user.id, status: 'sent' });
      } catch (error) {
        invitations.push({ user_id: user.id, status: 'failed', error: error.message });
      }
    }
  }

  // Invite by phone numbers
  if (phone_numbers && phone_numbers.length > 0) {
    const users = await User.findAll({
      where: { phone_number: { [Op.in]: phone_numbers } }
    });

    for (const user of users) {
      try {
        await sendRideInvitation(user, ride, ride.creator.getFullName());
        invitations.push({ phone_number: user.phone_number, status: 'sent' });
      } catch (error) {
        invitations.push({ phone_number: user.phone_number, status: 'failed', error: error.message });
      }
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Invitations sent',
    data: {
      invitations
    }
  });
});

// Get ride participants with access control
const getRideParticipants = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
      },
      {
        model: User,
        as: 'participants',
        through: { attributes: [] },
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
      }
    ]
  });

  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  const canAccess = await canUserAccessRide(ride, req.userId);
  if (!canAccess) {
    return next(new AppError('You do not have permission to view this ride', 403));
  }

  res.status(200).json({
    status: 'success',
    data: {
      creator: ride.creator,
      participants: ride.participants || [],
      total_participants: (ride.participants?.length || 0) + 1
    }
  });
});

// Delete ride
const deleteRide = catchAsync(async (req, res, next) => {
  const { rideId } = req.params;

  const ride = await Ride.findByPk(rideId);
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  }

  if (ride.creator_id !== req.userId) {
    return next(new AppError('You can only delete your own rides', 403));
  }

  if (ride.status !== 'upcoming') {
    return next(new AppError('Only upcoming rides can be deleted', 400));
  }

  await ride.destroy();

  res.status(200).json({
    status: 'success',
    message: 'Ride deleted successfully'
  });
});

const checkUserAlreadyJoined = async (req, res, next) => {
  const { rideId } = req.params;
  
  const ride = await Ride.findByPk(rideId, {
    include: [
      {
        model: User,
        as: 'participants',
        through: { attributes: [] },
        attributes: ['id']
      }
    ]
  });
  
  if (!ride) {
    return next(new AppError('Ride not found', 404));
  } 
  
  const userAlreadyJoined = ride.participants.some(participant => participant.id === req.userId);
  
  res.status(200).json({
    status: 'success',
    data: {
      already_joined: userAlreadyJoined,
      is_creator: ride.creator_id === req.userId
    }
  });
};


module.exports = {
  createRide,
  getRides,
  getNearbyRides,
  getRideById,
  updateRide,
  joinRide,
  leaveRide,
  cancelRide,
  inviteToRide,
  getRideParticipants,
  deleteRide,
  checkUserAlreadyJoined
};