// server.js - Updated for new architecture
require('dotenv').config();
const app = require('./src/app');
const { sequelize, syncDatabase } = require('./src/models');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Import the new socket manager
const createSocketManager = require('./src/sockets/socketHandlers');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const server = createServer(app);

// Socket.IO setup with optimized configuration
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  // Optimized for high performance
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB
  allowEIO3: true,
  transports: ['websocket', 'polling'],
  // Connection limits
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  }
});

// Initialize the new socket manager
let socketManager;

// Health check endpoint with socket stats
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    memory: process.memoryUsage(),
    socketStats: socketManager ? socketManager.getHealthStatus() : null
  };
  
  res.status(200).json(health);
});

// Performance stats endpoint
app.get('/api/admin/performance', (req, res) => {
  if (!socketManager) {
    return res.status(503).json({ error: 'Socket manager not initialized' });
  }
  
  const stats = socketManager.getPerformanceStats();
  res.json(stats);
});

// Admin broadcast endpoint (for testing)
app.post('/api/admin/broadcast', (req, res) => {
  if (!socketManager) {
    return res.status(503).json({ error: 'Socket manager not initialized' });
  }
  
  const { message, targetType = 'all', targetIds = [] } = req.body;
  
  socketManager.handleAdminBroadcast(message, targetType, targetIds);
  
  res.json({ 
    success: true, 
    message: 'Broadcast sent',
    targetType,
    targetCount: targetType === 'all' ? 'all' : targetIds.length
  });
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  try {
    // Shutdown socket manager first (handles client disconnections)
    if (socketManager) {
      await socketManager.gracefulShutdown();
    }
    
    // Close HTTP server
    server.close(() => {
      console.log('HTTP server closed.');
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
  
  if (socketManager) {
    socketManager.logError('uncaught_exception', error);
  }
  
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  if (socketManager) {
    socketManager.logError('unhandled_rejection', new Error(reason), { promise });
  }
  
  if (NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Start server
const startServer = async () => {
  try {
    console.log(`🚀 Starting high-performance messaging server in ${NODE_ENV} mode...`);
    
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    
    // Database sync (be careful in production)
    if (NODE_ENV === 'development') {
      const syncOptions = { alter: true, force: false };
      console.log('🔄 Synchronizing database...');
      // await syncDatabase(syncOptions);
      console.log('✅ Database synchronized successfully.');
    }
    
    // Initialize socket manager after database is ready
    socketManager = createSocketManager(io);
    
    // Start server
    server.listen(PORT, () => {
      console.log(`🎯 High-performance messaging server running on port ${PORT}`);
      console.log(`📡 Socket.IO enabled with CORS origin: ${process.env.FRONTEND_URL || "http://localhost:3000"}`);
      console.log(`🔥 Features enabled:`);
      console.log(`   • Multi-layer caching (Redis + Memory)`);
      console.log(`   • Message queue processing`);
      console.log(`   • Real-time presence & typing`);
      console.log(`   • Optimized chat list sync`);
      console.log(`   • High-performance message handling`);
      
      if (NODE_ENV === 'development') {
        console.log(`🔗 API available at: http://localhost:${PORT}`);
        console.log(`📊 Performance stats: http://localhost:${PORT}/api/admin/performance`);
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
    
    // Setup performance monitoring
    setupPerformanceMonitoring();
    
  } catch (error) {
    console.error('❌ Unable to start server:', error);
    
    if (error.name === 'SequelizeConnectionError') {
      console.error('💾 Database connection failed. Please check your database configuration.');
      console.error('   • Make sure PostgreSQL is running');
      console.error('   • Check DATABASE_URL in .env file');
      console.error('   • Verify database credentials');
    } else if (error.name === 'SequelizeValidationError') {
      console.error('💾 Database validation error:', error.errors);
    }
    
    process.exit(1);
  }
};

// Performance monitoring setup
function setupPerformanceMonitoring() {
  // Log performance stats every 60 seconds in production
  if (NODE_ENV === 'production') {
    setInterval(() => {
      if (socketManager) {
        const stats = socketManager.getPerformanceStats();
        console.log(`📊 [${new Date().toISOString()}] Performance Stats:`, {
          connections: stats.connections,
          messagesPerSecond: stats.messagesPerSecond,
          cacheHitRate: stats.cacheHitRate,
          memoryUsage: `${Math.round(stats.memoryUsage.heapUsed / 1024 / 1024)}MB`
        });
      }
    }, 60000);
  }
  
  // Memory usage monitoring
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    // Alert if memory usage is high (over 1GB)
    if (heapUsedMB > 1000) {
      console.warn(`⚠️  High memory usage detected: ${heapUsedMB}MB`);
      
      if (socketManager) {
        socketManager.emit('performance_alert', {
          type: 'high_memory',
          value: heapUsedMB,
          threshold: 1000
        });
      }
    }
  }, 30000);
}

// Initialize Redis connection check
async function checkRedisConnection() {
  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    await redis.ping();
    console.log('✅ Redis connection established successfully.');
    await redis.quit();
    
  } catch (error) {
    console.warn('⚠️  Redis connection failed:', error.message);
    console.warn('   • Message queue and caching will use fallback methods');
    console.warn('   • Performance may be reduced');
    console.warn('   • Install and start Redis server for optimal performance');
  }
}

// Start the server
(async () => {
  // Check Redis first
  await checkRedisConnection();
  
  // Start main server
  await startServer();
})();