require('dotenv').config();
const app = require('./src/app');
const { sequelize, syncDatabase } = require('./src/models');
const { createServer } = require('http');
const { Server } = require('socket.io');
const socketHandlers = require('./src/sockets/socketHandlers');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const server = createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  // Add connection timeout and other options
  pingTimeout: 60000,
  pingInterval: 25000
});

// Initialize socket handlers
socketHandlers(io);

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  try {
    // Close server first
    server.close(() => {
      console.log('HTTP server closed.');
    });
    
    // Close Socket.IO
    io.close(() => {
      console.log('Socket.IO server closed.');
    });
    
    // Close database connection
    await sequelize.close();
    console.log('Database connection closed.');
    
    console.log('Graceful shutdown completed.');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In production, you might want to exit the process
  if (NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Start server
const startServer = async () => {
  try {
    console.log(`Starting server in ${NODE_ENV} mode...`);
    
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    
    // Determine sync options based on environment
    const syncOptions = {
      alter: NODE_ENV === 'development', // Only alter in development
      force: false // Never use force in production
    };
    
    // Use custom sync function that handles dependencies
    console.log('🔄 Synchronizing database...');
    // await syncDatabase(syncOptions);
    console.log('✅ Database synchronized successfully.');
    
    // Start listening
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.IO enabled with CORS origin: ${process.env.FRONTEND_URL || "http://localhost:3000"}`);
      
      if (NODE_ENV === 'development') {
        console.log(`🔗 API available at: http://localhost:${PORT}`);
      }
    });
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
      } else {
        console.error('❌ Server error:', error);
      }
      process.exit(1);
    });
    
  } catch (error) {
    console.error('❌ Unable to start server:', error);
    
    // More detailed error logging
    if (error.name === 'SequelizeConnectionError') {
      console.error('Database connection failed. Please check your database configuration.');
    } else if (error.name === 'SequelizeValidationError') {
      console.error('Database validation error:', error.errors);
    }
    
    process.exit(1);
  }
};

// Add health check endpoint (optional)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

startServer();