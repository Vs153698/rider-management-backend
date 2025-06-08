const { Rental, User, Payment } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { uploadToCloudinary } = require('../config/cloudinary');
const { findNearbyRentals } = require('../services/locationService');
const { createPaymentOrder } = require('../services/paymentService');
const { sendRentalBookingConfirmation } = require('../services/notificationService');
const { getPagination, getPagingData } = require('../utils/helpers');
const { Op } = require('sequelize');

// Create a new rental
const createRental = catchAsync(async (req, res, next) => {
  const rentalData = {
    ...req.body,
    owner_id: req.userId
  };

  // Upload images if provided
  if (req.files && req.files.length > 0) {
    const uploadPromises = req.files.map(file => 
      uploadToCloudinary(file, 'rental-images')
    );
    
    const uploadResults = await Promise.all(uploadPromises);
    rentalData.images = uploadResults.map(result => result.secure_url);
  }

  const rental = await Rental.create(rentalData);

  // Include owner details in response
  const rentalWithOwner = await Rental.findByPk(rental.id, {
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  res.status(201).json({
    status: 'success',
    message: 'Rental created successfully',
    data: {
      rental: rentalWithOwner
    }
  });
});

// Get all rentals with filters
const getRentals = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    category,
    condition,
    min_price,
    max_price,
    search,
    is_available = true,
    sort = 'created_at',
    order = 'DESC'
  } = req.query;

  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  // Build where clause
  const whereClause = { is_available: is_available === 'true' };
  
  if (category) whereClause.category = category;
  if (condition) whereClause.condition = condition;
  if (min_price) whereClause.price_per_day = { [Op.gte]: min_price };
  if (max_price) {
    whereClause.price_per_day = {
      ...whereClause.price_per_day,
      [Op.lte]: max_price
    };
  }
  
  if (search) {
    whereClause[Op.or] = [
      { title: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const rentals = await Rental.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ],
    limit: limitNum,
    offset,
    order: [[sort, order]]
  });

  const response = getPagingData(rentals, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get nearby rentals
const getNearbyRentals = catchAsync(async (req, res, next) => {
  const { latitude, longitude, radius = 50, category, min_price, max_price } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const filters = {};
  if (category) filters.category = category;
  if (min_price) filters.min_price = min_price;
  if (max_price) filters.max_price = max_price;

  const rentals = await findNearbyRentals(
    parseFloat(latitude),
    parseFloat(longitude),
    parseInt(radius),
    filters
  );

  res.status(200).json({
    status: 'success',
    data: {
      rentals,
      count: rentals.length
    }
  });
});

// Get rental by ID
const getRentalById = catchAsync(async (req, res, next) => {
  const { rentalId } = req.params;

  const rental = await Rental.findByPk(rentalId, {
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
      }
    ]
  });

  if (!rental) {
    return next(new AppError('Rental not found', 404));
  }

  // Add user's ownership status
  const isOwner = rental.owner_id === req.userId;

  res.status(200).json({
    status: 'success',
    data: {
      rental: {
        ...rental.toJSON(),
        user_status: {
          is_owner: isOwner,
          can_book: rental.canBook() && !isOwner
        }
      }
    }
  });
});

// Update rental
const updateRental = catchAsync(async (req, res, next) => {
  const { rentalId } = req.params;

  const rental = await Rental.findByPk(rentalId);
  if (!rental) {
    return next(new AppError('Rental not found', 404));
  }

  if (!rental.canEdit(req.userId)) {
    return next(new AppError('You can only edit your own rentals', 403));
  }

  // Upload new images if provided
  let updateData = { ...req.body };
  if (req.files && req.files.length > 0) {
    const uploadPromises = req.files.map(file => 
      uploadToCloudinary(file, 'rental-images')
    );
    
    const uploadResults = await Promise.all(uploadPromises);
    updateData.images = [
      ...(rental.images || []),
      ...uploadResults.map(result => result.secure_url)
    ];
  }

  const updatedRental = await rental.update(updateData);

  res.status(200).json({
    status: 'success',
    message: 'Rental updated successfully',
    data: {
      rental: updatedRental
    }
  });
});

// Book rental
const bookRental = catchAsync(async (req, res, next) => {
  const { rentalId } = req.params;
  const { start_date, end_date, message } = req.body;

  const rental = await Rental.findByPk(rentalId, {
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'first_name', 'last_name', 'phone_number']
      }
    ]
  });

  if (!rental) {
    return next(new AppError('Rental not found', 404));
  }

  if (!rental.canBook()) {
    return next(new AppError('Rental is not available for booking', 400));
  }

  if (rental.owner_id === req.userId) {
    return next(new AppError('You cannot book your own rental', 400));
  }

  // Calculate rental duration and cost
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

  if (daysDiff < 1) {
    return next(new AppError('Rental duration must be at least 1 day', 400));
  }

  const totalCost = rental.calculatePrice(daysDiff);
  const securityDeposit = rental.security_deposit || 0;
  const totalAmount = totalCost + securityDeposit;

  // Create payment order
  const paymentOrder = await createPaymentOrder({
    user_id: req.userId,
    amount: totalAmount,
    payment_type: 'rental_payment',
    rental_id: rentalId,
    recipient_id: rental.owner_id,
    metadata: {
      start_date,
      end_date,
      days: daysDiff,
      rental_cost: totalCost,
      security_deposit: securityDeposit,
      message
    }
  });

  res.status(200).json({
    status: 'success',
    message: 'Payment required to complete booking',
    data: {
      booking_details: {
        rental_id: rentalId,
        start_date,
        end_date,
        days: daysDiff,
        rental_cost: totalCost,
        security_deposit: securityDeposit,
        total_amount: totalAmount
      },
      payment_order: paymentOrder
    }
  });
});

// Get rental bookings (for owners)
const getRentalBookings = catchAsync(async (req, res, next) => {
  const { rentalId } = req.params;
  const { status, page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  const rental = await Rental.findByPk(rentalId);
  if (!rental) {
    return next(new AppError('Rental not found', 404));
  }

  if (rental.owner_id !== req.userId) {
    return next(new AppError('Access denied', 403));
  }

  const whereClause = { rental_id: rentalId };
  if (status) whereClause.status = status;

  const bookings = await Payment.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
      }
    ],
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(bookings, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get user's rental bookings
const getUserBookings = catchAsync(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  const whereClause = { 
    user_id: req.userId,
    payment_type: 'rental_payment'
  };
  if (status) whereClause.status = status;

  const bookings = await Payment.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: Rental,
        as: 'rental',
        include: [
          {
            model: User,
            as: 'owner',
            attributes: ['id', 'first_name', 'last_name', 'phone_number']
          }
        ]
      }
    ],
    limit: limitNum,
    offset,
    order: [['created_at', 'DESC']]
  });

  const response = getPagingData(bookings, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Search rentals
const searchRentals = catchAsync(async (req, res, next) => {
  const { q, category, latitude, longitude, radius = 50, page = 1, limit = 20 } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  if (!q || q.length < 2) {
    return next(new AppError('Search query must be at least 2 characters', 400));
  }

  const whereClause = {
    is_available: true,
    status: 'active',
    [Op.or]: [
      { title: { [Op.iLike]: `%${q}%` } },
      { description: { [Op.iLike]: `%${q}%` } }
    ]
  };

  if (category) whereClause.category = category;

  const rentals = await Rental.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ],
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

// Rate rental
const rateRental = catchAsync(async (req, res, next) => {
  const { rentalId } = req.params;
  const { rating, review } = req.body;

  if (rating < 1 || rating > 5) {
    return next(new AppError('Rating must be between 1 and 5', 400));
  }

  // Check if user has booked this rental
  const booking = await Payment.findOne({
    where: {
      user_id: req.userId,
      rental_id: rentalId,
      payment_type: 'rental_payment',
      status: 'success'
    }
  });

  if (!booking) {
    return next(new AppError('You can only rate rentals you have booked', 403));
  }

  const rental = await Rental.findByPk(rentalId);
  if (!rental) {
    return next(new AppError('Rental not found', 404));
  }

  // Calculate new rating
  const totalRatings = rental.total_ratings + 1;
  const newRating = ((rental.rating * rental.total_ratings) + rating) / totalRatings;

  await rental.update({
    rating: Math.round(newRating * 100) / 100,
    total_ratings: totalRatings
  });

  res.status(200).json({
    status: 'success',
    message: 'Rating submitted successfully',
    data: {
      new_rating: newRating,
      total_ratings: totalRatings
    }
  });
});

// Delete rental
const deleteRental = catchAsync(async (req, res, next) => {
  const { rentalId } = req.params;

  const rental = await Rental.findByPk(rentalId);
  if (!rental) {
    return next(new AppError('Rental not found', 404));
  }

  if (rental.owner_id !== req.userId) {
    return next(new AppError('You can only delete your own rentals', 403));
  }

  if (rental.status === 'rented') {
    return next(new AppError('Cannot delete rental that is currently rented', 400));
  }

  await rental.update({ status: 'inactive', is_available: false });

  res.status(200).json({
    status: 'success',
    message: 'Rental deleted successfully'
  });
});

// Get rental categories
const getCategories = catchAsync(async (req, res, next) => {
  const categories = [
    { value: 'bike_gear', label: 'Bike Gear' },
    { value: 'camping', label: 'Camping' },
    { value: 'electronics', label: 'Electronics' },
    { value: 'tools', label: 'Tools' },
    { value: 'clothing', label: 'Clothing' },
    { value: 'accessories', label: 'Accessories' },
    { value: 'safety_gear', label: 'Safety Gear' },
    { value: 'other', label: 'Other' }
  ];

  res.status(200).json({
    status: 'success',
    data: {
      categories
    }
  });
});

module.exports = {
  createRental,
  getRentals,
  getNearbyRentals,
  getRentalById,
  updateRental,
  bookRental,
  getRentalBookings,
  getUserBookings,
  searchRentals,
  rateRental,
  deleteRental,
  getCategories
};