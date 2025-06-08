const { cashfreeAPI } = require('../config/cashfree');
const { Payment, User, Ride, Group, Rental } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');

// Helper function to safely extract payment method
const extractPaymentMethod = (paymentMethodData, paymentGroup = null) => {
  if (!paymentMethodData && !paymentGroup) {
    return null;
  }

  // If it's a string, use it directly
  if (typeof paymentMethodData === 'string') {
    return paymentMethodData.toLowerCase();
  }

  // If it's an object, extract the first key
  if (typeof paymentMethodData === 'object' && paymentMethodData !== null) {
    const methodKeys = Object.keys(paymentMethodData);
    if (methodKeys.length > 0) {
      return methodKeys[0].toLowerCase(); // e.g., 'upi' from {upi: {...}}
    }
  }

  // Fallback to payment_group
  if (paymentGroup) {
    return paymentGroup.toLowerCase();
  }

  return null;
};

// Create payment order with Cashfree for React Native SDK
const createPaymentOrder = async (paymentData) => {
  try {
    const {
      user_id,
      amount,
      payment_type,
      ride_id,
      group_id,
      rental_id,
      recipient_id,
      metadata = {}
    } = paymentData;

    // Validate required fields
    if (!user_id || !amount || !payment_type) {
      throw new AppError('Missing required payment fields', 400);
    }

    if (amount <= 0) {
      throw new AppError('Payment amount must be greater than 0', 400);
    }

    // Create payment record first
    const payment = await Payment.create({
      id: uuidv4(),
      user_id,
      amount,
      payment_type,
      ride_id,
      group_id,
      rental_id,
      recipient_id,
      status: 'pending',
      expires_at: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      metadata
    });

    // Get user details for Cashfree order
    const user = await User.findByPk(user_id);
    if (!user) {
      await payment.update({ status: 'failed', failure_reason: 'User not found' });
      throw new AppError('User not found', 404);
    }

    // Generate unique order ID (max 50 characters for Cashfree)
    const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
    const paymentIdShort = payment.id.replace(/-/g, '').slice(0, 8); // First 8 chars of UUID without hyphens
    const orderId = `RN${paymentIdShort}${timestamp}`; // Format: RN + 8 chars + 8 digits = 18 chars total

    // Format phone number for Cashfree (remove +91 if present)
    let phoneNumber = user.phone_number;
    if (phoneNumber.startsWith('+91')) {
      phoneNumber = phoneNumber.substring(3);
    }

    // Prepare Cashfree order data for React Native SDK
    const orderData = {
      order_id: orderId,
      order_amount: parseFloat(amount).toFixed(2),
      order_currency: 'INR',
      customer_details: {
        customer_id: user_id,
        customer_name: user.getFullName ? user.getFullName() : `${user.first_name} ${user.last_name}`,
        customer_email: user.email || `user${user_id}@riderapp.com`,
        customer_phone: phoneNumber
      },
      order_meta: {
        return_url: `${process.env.BASE_URL}/api/payments/success`,
        notify_url: `${process.env.BASE_URL}/api/payments/webhook`,
        payment_methods: 'cc,dc,upi,nb'
      },
      order_note: getPaymentDescription(payment_type, { ride_id, group_id, rental_id }),
      order_tags: {
        payment_type,
        user_id,
        internal_payment_id: payment.id,
        platform: 'react_native'
      }
    };

    console.log('Creating Cashfree order:', JSON.stringify(orderData, null, 2));

    // Create order with Cashfree
    const response = await cashfreeAPI.post('/orders', orderData);
    
    console.log('Cashfree order response:', response.data);

    if (response.data && response.data.order_id) {
      // Update payment with Cashfree order details
      await payment.update({
        cashfree_order_id: response.data.order_id,
        transaction_id: orderId,
        gateway_response: response.data
      });

      // Return data formatted for React Native SDK
      return {
        payment_id: payment.id,
        order_id: response.data.order_id,
        payment_session_id: response.data.payment_session_id,
        amount: parseFloat(amount),
        currency: 'INR',
        expires_at: payment.expires_at,
        cashfree_token: response.data.payment_session_id, // Required for RN SDK
        environment: process.env.CASHFREE_BASE_URL?.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION'
      };
    } else {
      await payment.update({ 
        status: 'failed', 
        failure_reason: 'Failed to create Cashfree order' 
      });
      throw new AppError('Payment order creation failed', 500);
    }

  } catch (error) {
    console.error('Payment order creation failed:', error);
    
    if (error instanceof AppError) {
      throw error;
    }
    
    // Handle Cashfree API errors
    if (error.response) {
      const errorMessage = error.response.data?.message || 'Payment gateway error';
      console.error('Cashfree API Error:', error.response.data);
      throw new AppError(`Payment service error: ${errorMessage}`, 500);
    }
    
    throw new AppError('Payment service temporarily unavailable', 500);
  }
};

// Verify payment status with Cashfree
const verifyPayment = async (orderId) => {
  try {
    console.log('Verifying payment for order:', orderId);

    const payment = await Payment.findOne({
      where: { 
        [Op.or]: [
          { cashfree_order_id: orderId },
          { transaction_id: orderId }
        ]
      },
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: ['id', 'title', 'creator_id'],
          required: false
        }
      ]
    });

    if (!payment) {
      throw new AppError('Payment not found', 404);
    }

    // Get payment status from Cashfree
    const response = await cashfreeAPI.get(`/orders/${payment.cashfree_order_id}/payments`);
    
    console.log('Cashfree payment verification response:', response.data);

    if (response.data && response.data.length > 0) {
      const paymentData = response.data[0];
      
      // Map Cashfree status to our status
      let status = 'pending';
      switch (paymentData.payment_status) {
        case 'SUCCESS':
          status = 'success';
          break;
        case 'FAILED':
          status = 'failed';
          break;
        case 'PENDING':
        case 'USER_DROPPED':
          status = 'pending';
          break;
        case 'CANCELLED':
          status = 'cancelled';
          break;
        default:
          status = 'processing';
      }

      // Extract payment method safely
      const paymentMethod = extractPaymentMethod(paymentData.payment_method, paymentData.payment_group);

      // Update payment record
      await payment.update({
        cashfree_payment_id: paymentData.cf_payment_id,
        status,
        payment_method: paymentMethod,
        gateway_response: {
          ...payment.gateway_response,
          payment_details: paymentData
        },
        processed_at: status === 'success' ? new Date() : null,
        failure_reason: status === 'failed' ? paymentData.payment_message : null
      });

      // Process post-payment actions for successful payments
      if (status === 'success') {
        await processPostPaymentActions(payment);
      }

      return payment;
    } else {
      throw new AppError('Payment details not found', 404);
    }

  } catch (error) {
    console.error('Payment verification failed:', error);
    
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError('Payment verification failed', 500);
  }
};

// Handle Cashfree webhook for React Native payments
const handleWebhook = async (webhookData) => {
  try {
    console.log('Processing webhook:', webhookData);

    // Extract data from webhook - handle both old and new structures
    let orderId = null;
    let paymentStatus = null;
    let cfPaymentId = null;
    let paymentMethodData = null;
    let paymentGroup = null;
    let paymentAmount = null;
    let paymentCurrency = null;
    let paymentTime = null;
    let paymentMessage = null;
    let signature = null;

    if (webhookData.data) {
      // New webhook structure (nested data)
      orderId = webhookData.data.order?.order_id;
      paymentStatus = webhookData.data.payment?.payment_status;
      cfPaymentId = webhookData.data.payment?.cf_payment_id;
      paymentMethodData = webhookData.data.payment?.payment_method;
      paymentGroup = webhookData.data.payment?.payment_group;
      paymentAmount = webhookData.data.payment?.payment_amount;
      paymentCurrency = webhookData.data.payment?.payment_currency;
      paymentTime = webhookData.data.payment?.payment_time;
      paymentMessage = webhookData.data.payment?.payment_message;
    } else {
      // Legacy webhook structure (flat)
      orderId = webhookData.order_id;
      paymentStatus = webhookData.payment_status;
      cfPaymentId = webhookData.cf_payment_id;
      paymentMethodData = webhookData.payment_method;
      paymentGroup = webhookData.payment_group;
      paymentAmount = webhookData.payment_amount;
      paymentCurrency = webhookData.payment_currency;
      paymentTime = webhookData.payment_time;
      paymentMessage = webhookData.payment_message;
      signature = webhookData.signature;
    }

    if (!orderId) {
      console.error('Webhook missing order_id', { webhookData });
      return null;
    }

    console.log(`Processing webhook for order_id: ${orderId}, status: ${paymentStatus}`);

    // Verify webhook signature if configured
    if (process.env.CASHFREE_WEBHOOK_SECRET && signature) {
      const crypto = require('crypto');
      const payload = JSON.stringify(webhookData);
      const expectedSignature = crypto
        .createHmac('sha256', process.env.CASHFREE_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

      if (signature !== expectedSignature) {
        console.error('Invalid webhook signature');
        return null;
      }
    }

    const payment = await Payment.findOne({
      where: { 
        [Op.or]: [
          { cashfree_order_id: orderId },
          { transaction_id: orderId }
        ]
      }
    });

    if (!payment) {
      console.error('Payment not found for webhook order_id:', orderId);
      return null;
    }

    console.log(`Found payment ${payment.id} for order ${orderId}`);

    // Map payment status
    let status = 'pending';
    switch (paymentStatus) {
      case 'SUCCESS':
        status = 'success';
        break;
      case 'FAILED':
        status = 'failed';
        break;
      case 'CANCELLED':
        status = 'cancelled';
        break;
      default:
        status = 'processing';
    }

    // Extract payment method safely
    const paymentMethod = extractPaymentMethod(paymentMethodData, paymentGroup);

    // Update payment record
    await payment.update({
      cashfree_payment_id: cfPaymentId,
      status,
      payment_method: paymentMethod,
      gateway_response: {
        ...payment.gateway_response,
        webhook_data: webhookData
      },
      processed_at: status === 'success' ? new Date(paymentTime) : null,
      failure_reason: status === 'failed' ? paymentMessage : null
    });

    // Process post-payment actions for successful payments
    if (status === 'success') {
      await processPostPaymentActions(payment);
    }

    console.log(`✅ Payment ${payment.id} updated to status: ${status}`);
    return payment;

  } catch (error) {
    console.error('Webhook processing error:', error);
    throw error;
  }
};

// Process actions after successful payment
const processPostPaymentActions = async (payment) => {
  if (payment.status !== 'success') {
    return;
  }

  try {
    console.log(`Processing post-payment actions for payment: ${payment.id}`);

    switch (payment.payment_type) {
      case 'ride_fee':
        await handleRidePaymentSuccess(payment);
        break;

      case 'group_membership':
        await handleGroupMembershipSuccess(payment);
        break;

      case 'rental_payment':
        await handleRentalPaymentSuccess(payment);
        break;

      case 'security_deposit':
        await handleSecurityDepositSuccess(payment);
        break;

      default:
        console.log('Unknown payment type:', payment.payment_type);
    }

    // Send success notification to user
    await sendPaymentSuccessNotification(payment);

  } catch (error) {
    console.error('Post-payment actions failed:', error);
    // Don't throw error here to avoid affecting payment status
  }
};

// Handle successful ride payment
const handleRidePaymentSuccess = async (payment) => {
  if (!payment.ride_id) return;

  try {
    const ride = await Ride.findByPk(payment.ride_id);
    if (!ride) {
      console.error('Ride not found for payment:', payment.id);
      return;
    }

    // Check if ride is still joinable
    if (ride.current_participants >= ride.max_participants) {
      console.error('Ride is full, cannot add participant');
      // Handle refund logic here
      return;
    }

    // Add user to ride participants
    const user = await User.findByPk(payment.user_id);
    if (user) {
      // Check if user is not already a participant
      const existingParticipants = await ride.getParticipants({
        where: { id: payment.user_id }
      });

      if (existingParticipants.length === 0) {
        await ride.addParticipant(user);
        await ride.increment('current_participants');
        console.log(`✅ User ${user.id} added to ride ${ride.id} after payment success`);
      } else {
        console.log(`ℹ️ User ${user.id} already participant of ride ${ride.id}`);
      }
    }
  } catch (error) {
    console.error('Error handling ride payment success:', error);
  }
};

// Handle successful group membership payment
const handleGroupMembershipSuccess = async (payment) => {
  if (!payment.group_id) return;

  try {
    const group = await Group.findByPk(payment.group_id);
    if (!group) {
      console.error('Group not found for payment:', payment.id);
      return;
    }

    // Add user to group members
    const user = await User.findByPk(payment.user_id);
    if (user) {
      const existingMembers = await group.getMembers({
        where: { id: payment.user_id }
      });

      if (existingMembers.length === 0) {
        await group.addMember(user);
        await group.increment('current_members');
        console.log(`✅ User ${user.id} added to group ${group.id} after payment success`);
      }
    }
  } catch (error) {
    console.error('Error handling group membership payment success:', error);
  }
};

// Handle successful rental payment
const handleRentalPaymentSuccess = async (payment) => {
  if (!payment.rental_id) return;

  try {
    const rental = await Rental.findByPk(payment.rental_id);
    if (!rental) {
      console.error('Rental not found for payment:', payment.id);
      return;
    }

    await rental.increment('total_bookings');
    console.log(`✅ Rental booking processed for rental ${rental.id}`);
  } catch (error) {
    console.error('Error handling rental payment success:', error);
  }
};

// Handle successful security deposit
const handleSecurityDepositSuccess = async (payment) => {
  console.log(`✅ Security deposit processed for payment: ${payment.id}`);
};

// Send payment success notification
const sendPaymentSuccessNotification = async (payment) => {
  try {
    const user = await User.findByPk(payment.user_id);
    if (!user) return;

    // Import notification service if available
    try {
      const { sendPaymentConfirmation } = require('./notificationService');
      
      let itemDetails = 'Payment';
      
      if (payment.ride_id) {
        const ride = await Ride.findByPk(payment.ride_id);
        itemDetails = `ride "${ride?.title}"`;
      } else if (payment.group_id) {
        const group = await Group.findByPk(payment.group_id);
        itemDetails = `group membership for "${group?.name}"`;
      } else if (payment.rental_id) {
        const rental = await Rental.findByPk(payment.rental_id);
        itemDetails = `rental "${rental?.title}"`;
      }

      await sendPaymentConfirmation(user, payment, itemDetails);
      console.log(`✅ Payment confirmation sent to user ${user.id}`);
    } catch (notificationError) {
      console.log('ℹ️ Notification service not available, skipping notification');
    }

  } catch (error) {
    console.error('Failed to send payment notification:', error);
  }
};

// Helper function to get payment description
const getPaymentDescription = (paymentType, context) => {
  switch (paymentType) {
    case 'ride_fee':
      return 'Payment for ride participation';
    case 'group_membership':
      return 'Group membership fee';
    case 'rental_payment':
      return 'Rental booking payment';
    case 'security_deposit':
      return 'Security deposit';
    default:
      return 'Payment';
  }
};

module.exports = {
  createPaymentOrder,
  verifyPayment,
  handleWebhook,
  processPostPaymentActions
};