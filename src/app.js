const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { errorHandler } = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const rideRoutes = require('./routes/rides');
const groupRoutes = require('./routes/groups');
const chatRoutes = require('./routes/chat');
const rentalRoutes = require('./routes/rentals');
const paymentRoutes = require('./routes/payments');
const FriendSystem = require('./routes/FriendSystem');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/rentals', rentalRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/friends', FriendSystem);


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Global error handler
app.use(errorHandler);

module.exports = app;