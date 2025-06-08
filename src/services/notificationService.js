const twilio = require('twilio');
const { Resend } = require('resend');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Send SMS
const sendSMS = async (phoneNumber, message) => {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID) {
      console.log('SMS simulation:', { phoneNumber, message });
      return { success: true, simulation: true };
    }

    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`
    });

    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('SMS sending failed:', error);
    throw new Error(`SMS delivery failed: ${error.message}`);
  }
};

// Send email
const sendEmail = async (to, subject, html, text = null) => {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.log('Email simulation:', { to, subject, html });
      return { success: true, simulation: true };
    }

    const emailData = {
      from: 'onboarding@resend.dev',
      to:'roamvaibhav@gmail.com',
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, '') // Strip HTML for text version
    };

    const result = await resend.emails.send(emailData);
    return { success: true, messageId: result.data?.id };
  } catch (error) {
    console.error('Email sending failed:', error);
    throw new Error(`Email delivery failed: ${error.message}`);
  }
};

// Send ride invitation
const sendRideInvitation = async (user, ride, inviterName) => {
  const message = `Hi ${user.first_name}! ${inviterName} invited you to join ride "${ride.title}" on ${new Date(ride.ride_date).toLocaleDateString()}. Check the app for details.`;
  
  try {
    // await sendSMS(user.phone_number, message);
    
    if (user.email) {
      const emailHtml = `
        <h2>Ride Invitation</h2>
        <p>Hi ${user.first_name}!</p>
        <p>${inviterName} has invited you to join the ride:</p>
        <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0;">
          <h3>${ride.title}</h3>
          <p><strong>Date:</strong> ${new Date(ride.ride_date).toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${ride.ride_time}</p>
          <p><strong>From:</strong> ${ride.start_location.address}</p>
          <p><strong>To:</strong> ${ride.end_location.address}</p>
          ${ride.is_paid ? `<p><strong>Fee:</strong> ₹${ride.price}</p>` : ''}
        </div>
        <p>Open the Rider App to accept or decline this invitation.</p>
      `;
      
      // await sendEmail(user.email, `Ride Invitation: ${ride.title}`, emailHtml);
    }
    
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// Send group invitation
const sendGroupInvitation = async (user, group, inviterName) => {
  const message = `Hi ${user.first_name}! ${inviterName} invited you to join the group "${group.name}". Check the app to accept.`;
  
  try {
    // await sendSMS(user.phone_number, message);
    
    if (user.email) {
      const emailHtml = `
        <h2>Group Invitation</h2>
        <p>Hi ${user.first_name}!</p>
        <p>${inviterName} has invited you to join the group:</p>
        <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0;">
          <h3>${group.name}</h3>
          <p>${group.description}</p>
          ${group.is_paid ? `<p><strong>Membership Fee:</strong> ₹${group.membership_fee}</p>` : ''}
        </div>
        <p>Open the Rider App to accept or decline this invitation.</p>
      `;
      
      // await sendEmail(user.email, `Group Invitation: ${group.name}`, emailHtml);
    }
    
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// Send ride reminder
const sendRideReminder = async (user, ride, hoursBeforeRide) => {
  const message = `Reminder: Your ride "${ride.title}" starts in ${hoursBeforeRide} hours. Meeting point: ${ride.start_location.address}`;
  
  try {
    // await sendSMS(user.phone_number, message);
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// Send payment confirmation
const sendPaymentConfirmation = async (user, payment, itemDetails) => {
  const message = `Payment confirmed! ₹${payment.amount} paid for ${itemDetails}. Transaction ID: ${payment.transaction_id}`;
  
  try {
    // await sendSMS(user.phone_number, message);
    
    if (user.email) {
      const emailHtml = `
        <h2>Payment Confirmation</h2>
        <p>Hi ${user.first_name}!</p>
        <p>Your payment has been successfully processed:</p>
        <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0;">
          <p><strong>Amount:</strong> ₹${payment.amount}</p>
          <p><strong>For:</strong> ${itemDetails}</p>
          <p><strong>Transaction ID:</strong> ${payment.transaction_id}</p>
          <p><strong>Date:</strong> ${new Date(payment.created_at).toLocaleString()}</p>
        </div>
        <p>Thank you for using Rider App!</p>
      `;
      
      // await sendEmail(user.email, 'Payment Confirmation', emailHtml);
    }
    
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// Send rental booking confirmation
const sendRentalBookingConfirmation = async (renter, owner, rental, bookingDetails) => {
  // Message to renter
  const renterMessage = `Booking confirmed! You've booked "${rental.title}" from ${bookingDetails.start_date} to ${bookingDetails.end_date}. Contact ${owner.first_name}: ${owner.phone_number}`;
  
  // Message to owner
  const ownerMessage = `New booking! ${renter.first_name} booked your "${rental.title}" from ${bookingDetails.start_date} to ${bookingDetails.end_date}. Contact: ${renter.phone_number}`;
  
  try {
    // await Promise.all([
    //   sendSMS(renter.phone_number, renterMessage),
    //   sendSMS(owner.phone_number, ownerMessage)
    // ]);
    
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// Send emergency alert
const sendEmergencyAlert = async (emergencyContact, user, location) => {
  const message = `EMERGENCY ALERT: ${user.first_name} ${user.last_name} may need help. Last known location: ${location.address || `${location.latitude}, ${location.longitude}`}. Please check on them immediately.`;
  
  try {
    // await sendSMS(emergencyContact.phone, message);
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// Bulk notification for ride participants
const notifyRideParticipants = async (participants, message, subject = null) => {
  const notifications = participants.map(async (participant) => {
    try {
      // await sendSMS(participant.phone_number, message);
      
      if (participant.email && subject) {
        // await sendEmail(participant.email, subject, `<p>${message}</p>`);
      }
      
      return { user_id: participant.id, success: true };
    } catch (error) {
      return { user_id: participant.id, success: false, error: error.message };
    }
  });
  
  return Promise.all(notifications);
};

// Bulk notification for group members
const notifyGroupMembers = async (members, message, subject = null) => {
  const notifications = members.map(async (member) => {
    try {
      // await sendSMS(member.phone_number, message);
      
      if (member.email && subject) {
        // await sendEmail(member.email, subject, `<p>${message}</p>`);
      }
      
      return { user_id: member.id, success: true };
    } catch (error) {
      return { user_id: member.id, success: false, error: error.message };
    }
  });
  
  return Promise.all(notifications);
};

module.exports = {
  sendSMS,
  sendEmail,
  sendRideInvitation,
  sendGroupInvitation,
  sendRideReminder,
  sendPaymentConfirmation,
  sendRentalBookingConfirmation,
  sendEmergencyAlert,
  notifyRideParticipants,
  notifyGroupMembers
};