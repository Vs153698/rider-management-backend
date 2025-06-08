const { Payment, User, Ride, Group } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { createPaymentOrder, verifyPayment, handleWebhook } = require('../services/paymentService');
const { getPagination, getPagingData } = require('../utils/helpers');

// Verify payment status after React Native payment completion
const verifyPaymentStatus = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { cf_payment_id } = req.body; // Optional: payment ID from Cashfree SDK

  console.log('🔍 Verifying payment status:', { orderId, cf_payment_id, userId: req.userId });

  try {
    // Find payment by order ID
    const payment = await Payment.findOne({
      where: { 
        cashfree_order_id: orderId,
        user_id: req.userId // Ensure user can only verify their own payments
      },
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: ['id', 'title', 'creator_id']
        },
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    if (!payment) {
      return next(new AppError('Payment not found', 404));
    }

    // Verify payment with Cashfree
    const verifiedPayment = await verifyPayment(orderId);

    console.log('✅ Payment verification result:', {
      paymentId: verifiedPayment.id,
      status: verifiedPayment.status,
      amount: verifiedPayment.amount
    });

    // Return payment status
    return res.status(200).json({
      status: 'success',
      data: {
        payment: {
          id: verifiedPayment.id,
          order_id: verifiedPayment.cashfree_order_id,
          status: verifiedPayment.status,
          amount: verifiedPayment.amount,
          payment_type: verifiedPayment.payment_type,
          payment_method: verifiedPayment.payment_method,
          processed_at: verifiedPayment.processed_at,
          ride: verifiedPayment.ride,
          metadata: verifiedPayment.metadata
        }
      }
    });

  } catch (error) {
    console.error('❌ Payment verification failed:', error);
    return next(new AppError('Payment verification failed', 500));
  }
});

// Handle Cashfree webhook
const handlePaymentWebhook = catchAsync(async (req, res, next) => {
  console.log('📨 Received payment webhook:', req.body);

  try {
    // Process webhook
    const payment = await handleWebhook(req.body);

    if (payment) {
      console.log(`✅ Webhook processed successfully for payment: ${payment.id}`);
      res.status(200).json({ status: 'success', message: 'Webhook processed' });
    } else {
      console.log('⚠️ Webhook processed but no payment found');
      res.status(200).json({ status: 'success', message: 'Webhook received' });
    }

  } catch (error) {
    console.error('❌ Webhook processing failed:', error);
    res.status(500).json({ status: 'error', message: 'Webhook processing failed' });
  }
});

// Get payment by ID
const getPaymentById = catchAsync(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await Payment.findOne({
    where: { 
      id: paymentId,
      user_id: req.userId // Users can only view their own payments
    },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name', 'phone_number']
      },
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'first_name', 'last_name'],
        required: false
      },
      {
        model: Ride,
        as: 'ride',
        attributes: ['id', 'title', 'ride_date'],
        required: false
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name'],
        required: false
      }
    ]
  });

  if (!payment) {
    return next(new AppError('Payment not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      payment
    }
  });
});

// Get user's payment history
const getUserPayments = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    payment_type,
    status,
    date_from,
    date_to
  } = req.query;

  const { limit: limitNum, offset } = getPagination(page - 1, limit);
  const whereClause = { user_id: req.userId };

  // Apply filters
  if (payment_type) whereClause.payment_type = payment_type;
  if (status) whereClause.status = status;
  
  if (date_from || date_to) {
    whereClause.created_at = {};
    if (date_from) whereClause.created_at[Op.gte] = new Date(date_from);
    if (date_to) whereClause.created_at[Op.lte] = new Date(date_to);
  }

  const payments = await Payment.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'recipient',
        attributes: ['id', 'first_name', 'last_name'],
        required: false
      },
      {
        model: Ride,
        as: 'ride',
        attributes: ['id', 'title', 'ride_date'],
        required: false
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name'],
        required: false
      }
    ],
    order: [['created_at', 'DESC']],
    limit: limitNum,
    offset
  });

  const response = getPagingData(payments, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get payments received by user
const getReceivedPayments = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    payment_type,
    status = 'success', // Only show successful payments by default
    date_from,
    date_to
  } = req.query;

  const { limit: limitNum, offset } = getPagination(page - 1, limit);
  const whereClause = { recipient_id: req.userId };

  // Apply filters
  if (payment_type) whereClause.payment_type = payment_type;
  if (status) whereClause.status = status;
  
  if (date_from || date_to) {
    whereClause.created_at = {};
    if (date_from) whereClause.created_at[Op.gte] = new Date(date_from);
    if (date_to) whereClause.created_at[Op.lte] = new Date(date_to);
  }

  const payments = await Payment.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name', 'phone_number']
      },
      {
        model: Ride,
        as: 'ride',
        attributes: ['id', 'title', 'ride_date'],
        required: false
      },
      {
        model: Group,
        as: 'group',
        attributes: ['id', 'name'],
        required: false
      }
    ],
    order: [['created_at', 'DESC']],
    limit: limitNum,
    offset
  });

  const response = getPagingData(payments, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get payment statistics
const getPaymentStats = catchAsync(async (req, res, next) => {
  const { period = '30d' } = req.query;

  let dateFilter = {};
  const now = new Date();

  // Set date filter based on period
  switch (period) {
    case '7d':
      dateFilter = { [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
      break;
    case '30d':
      dateFilter = { [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
      break;
    case '90d':
      dateFilter = { [Op.gte]: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) };
      break;
    case '1y':
      dateFilter = { [Op.gte]: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) };
      break;
    default:
      dateFilter = { [Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
  }

  // Get payment statistics
  const stats = await Payment.findAll({
    where: {
      user_id: req.userId,
      created_at: dateFilter
    },
    attributes: [
      'payment_type',
      'status',
      [Payment.sequelize.fn('COUNT', Payment.sequelize.col('id')), 'count'],
      [Payment.sequelize.fn('SUM', Payment.sequelize.col('amount')), 'total_amount']
    ],
    group: ['payment_type', 'status'],
    raw: true
  });

  // Get received payments
  const receivedStats = await Payment.findAll({
    where: {
      recipient_id: req.userId,
      status: 'success',
      created_at: dateFilter
    },
    attributes: [
      'payment_type',
      [Payment.sequelize.fn('COUNT', Payment.sequelize.col('id')), 'count'],
      [Payment.sequelize.fn('SUM', Payment.sequelize.col('amount')), 'total_amount']
    ],
    group: ['payment_type'],
    raw: true
  });

  res.status(200).json({
    status: 'success',
    data: {
      period,
      payments_made: stats,
      payments_received: receivedStats
    }
  });
});

// Cancel payment (if still pending)
const cancelPayment = catchAsync(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await Payment.findOne({
    where: { 
      id: paymentId,
      user_id: req.userId
    }
  });

  if (!payment) {
    return next(new AppError('Payment not found', 404));
  }

  if (payment.status !== 'pending') {
    return next(new AppError('Only pending payments can be cancelled', 400));
  }

  // Check if payment hasn't expired
  if (payment.expires_at && new Date() > payment.expires_at) {
    await payment.update({ status: 'expired' });
    return next(new AppError('Payment has already expired', 400));
  }

  await payment.update({ 
    status: 'cancelled',
    cancelled_at: new Date()
  });

  res.status(200).json({
    status: 'success',
    message: 'Payment cancelled successfully'
  });
});

// Get available payment methods
const getPaymentMethods = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: 'success',
    data: {
      payment_methods: [
        {
          type: 'upi',
          name: 'UPI',
          enabled: true,
          description: 'Pay using any UPI app'
        },
        {
          type: 'card',
          name: 'Credit/Debit Card',
          enabled: true,
          description: 'Pay using your credit or debit card'
        },
        {
          type: 'netbanking',
          name: 'Net Banking',
          enabled: true,
          description: 'Pay using your bank account'
        },
        {
          type: 'wallet',
          name: 'Wallet',
          enabled: true,
          description: 'Pay using digital wallets'
        }
      ]
    }
  });
});

// Create payment (if needed for other use cases)
const createPayment = catchAsync(async (req, res, next) => {
  const {
    amount,
    payment_type,
    ride_id,
    group_id,
    rental_id,
    recipient_id,
    metadata
  } = req.body;

  try {
    const paymentOrder = await createPaymentOrder({
      user_id: req.userId,
      amount,
      payment_type,
      ride_id,
      group_id,
      rental_id,
      recipient_id,
      metadata
    });

    res.status(201).json({
      status: 'success',
      message: 'Payment order created successfully',
      data: {
        payment_order: paymentOrder
      }
    });

  } catch (error) {
    console.error('Payment creation failed:', error);
    return next(new AppError('Failed to create payment order', 500));
  }
});

// Request refund
const requestRefund = catchAsync(async (req, res, next) => {
  const { paymentId } = req.params;
  const { refund_amount, reason } = req.body;

  const payment = await Payment.findOne({
    where: { 
      id: paymentId,
      user_id: req.userId
    }
  });

  if (!payment) {
    return next(new AppError('Payment not found', 404));
  }

  if (payment.status !== 'success') {
    return next(new AppError('Only successful payments can be refunded', 400));
  }

  // Check if refund is allowed based on business rules
  const availableRefund = payment.amount - (payment.refund_amount || 0);
  const requestedRefund = refund_amount || availableRefund;

  if (requestedRefund > availableRefund) {
    return next(new AppError('Refund amount exceeds available balance', 400));
  }

  // For now, just mark as refund requested
  // In production, integrate with Cashfree refund API
  await payment.update({
    refund_requested: true,
    refund_request_amount: requestedRefund,
    refund_reason: reason,
    refund_requested_at: new Date()
  });

  res.status(200).json({
    status: 'success',
    message: 'Refund request submitted successfully'
  });
});

module.exports = {
  createPayment,
  verifyPaymentStatus,
  getPaymentById,
  getUserPayments,
  getReceivedPayments,
  getPaymentStats,
  handlePaymentWebhook,
  cancelPayment,
  getPaymentMethods,
  requestRefund
};