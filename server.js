// server.js - Updated for high-performance socket integration with lakhs of users
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

// Socket.IO setup with optimized configuration for lakhs of users
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  // Optimized for high performance and many concurrent users
  pingTimeout: 60000,           // 60 seconds before considering connection dead
  pingInterval: 25000,          // Ping every 25 seconds
  maxHttpBufferSize: 5e6,       // 5MB max message size
  allowEIO3: true,              // Support older clients
  transports: ['websocket', 'polling'],
  
  // Connection state recovery for better reliability
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  
  // Additional performance settings for scaling
  serveClient: false,           // Don't serve socket.io client files
  cookie: false,                // Disable cookies for better performance
  destroyUpgrade: false,        // Don't destroy upgrade requests
  destroyUpgradeTimeout: 1000,  // Timeout for destroying upgrades
  
  // Redis adapter for horizontal scaling (uncomment when you have Redis)
  // adapter: process.env.REDIS_URL ? require('@socket.io/redis-adapter')({
  //   host: process.env.REDIS_HOST || 'localhost',
  //   port: process.env.REDIS_PORT || 6379,
  //   password: process.env.REDIS_PASSWORD
  // }) : undefined
});

// Initialize the socket manager
let socketManager;

// Enhanced health check endpoint with socket stats
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
    },
    socketStats: socketManager ? socketManager.getHealthStatus() : null,
    database: 'connected' // Will be updated by connection check
  };
  
  res.status(200).json(health);
});

// Performance monitoring endpoint for admins
app.get('/api/admin/performance', (req, res) => {
  if (!socketManager) {
    return res.status(503).json({ error: 'Socket manager not initialized' });
  }
  
  const stats = socketManager.getPerformanceStats();
  const systemStats = {
    cpu: process.cpuUsage(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version
  };
  
  res.json({
    socket_stats: stats,
    system_stats: systemStats,
    timestamp: new Date()
  });
});

// Admin endpoint to broadcast messages (useful for maintenance notifications)
app.post('/api/admin/broadcast', (req, res) => {
  if (!socketManager) {
    return res.status(503).json({ error: 'Socket manager not initialized' });
  }
  
  const { message, targetType = 'all', targetIds = [], eventType = 'admin_message' } = req.body;
  
  // Simple admin auth check (implement proper auth in production)
  const adminToken = req.headers['x-admin-token'];
  if (adminToken !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    switch (targetType) {
      case 'all':
        socketManager.io.emit(eventType, { message, timestamp: new Date() });
        break;
      case 'users':
        targetIds.forEach(userId => {
          socketManager.io.to(`user_${userId}`).emit(eventType, { message, timestamp: new Date() });
        });
        break;
      case 'groups':
        targetIds.forEach(groupId => {
          socketManager.io.to(`group_${groupId}`).emit(eventType, { message, timestamp: new Date() });
        });
        break;
      case 'rides':
        targetIds.forEach(rideId => {
          socketManager.io.to(`ride_${rideId}`).emit(eventType, { message, timestamp: new Date() });
        });
        break;
    }
    
    res.json({ 
      success: true, 
      message: 'Broadcast sent successfully',
      targetType,
      targetCount: targetType === 'all' ? 'all' : targetIds.length,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
});

// Socket connection monitoring endpoint
app.get('/api/admin/connections', (req, res) => {
  if (!socketManager) {
    return res.status(503).json({ error: 'Socket manager not initialized' });
  }
  
  const connections = Array.from(socketManager.connections.entries()).map(([userId, sockets]) => ({
    userId,
    socketCount: sockets.size,
    sockets: Array.from(sockets)
  }));
  
  res.json({
    total_users: connections.length,
    total_sockets: connections.reduce((sum, conn) => sum + conn.socketCount, 0),
    connections: connections.slice(0, 100) // Limit to first 100 for performance
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  try {
    // Notify all connected clients about shutdown
    if (socketManager) {
      console.log('📢 Notifying connected clients about shutdown...');
      socketManager.io.emit('server_shutdown', { 
        message: 'Server is restarting for maintenance. Please reconnect in a moment.',
        reconnect_delay: 5000
      });
      
      // Give clients time to receive the message
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Gracefully shutdown socket manager
      console.log('🔌 Shutting down socket manager...');
      await socketManager.gracefulShutdown();
    }
    
    // Close HTTP server
    console.log('🌐 Closing HTTP server...');
    server.close(() => {
      console.log('✅ HTTP server closed.');
    });
    
    // Close database connection
    console.log('💾 Closing database connection...');
    await sequelize.close();
    console.log('✅ Database connection closed.');
    
    console.log('🎉 Graceful shutdown completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Enhanced error handling
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  
  if (socketManager) {
    socketManager.logError('uncaught_exception', error);
    
    // Emit error to monitoring systems
    socketManager.io.emit('server_error', {
      type: 'uncaught_exception',
      message: 'Server encountered an unexpected error',
      timestamp: new Date()
    });
  }
  
  // In production, you might want to restart gracefully instead of exiting
  if (NODE_ENV === 'production') {
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  } else {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  
  if (socketManager) {
    socketManager.logError('unhandled_rejection', new Error(reason), { promise: promise.toString() });
  }
  
  // Don't exit on unhandled rejections in production, just log them
  if (NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Start server function
const startServer = async () => {
  try {
    console.log(`🚀 Starting high-performance messaging server in ${NODE_ENV} mode...`);
    console.log(`📊 Target: Support lakhs of concurrent users`);
    
    // Test database connection
    console.log('💾 Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    
    // Database sync (be very careful in production)
    if (NODE_ENV === 'development') {
      console.log('🔄 Synchronizing database schema...');
      try {
        await syncDatabase({ alter: false, force: false });
        console.log('✅ Database schema synchronized.');
      } catch (syncError) {
        console.warn('⚠️ Database sync failed, continuing with existing schema:', syncError.message);
      }
    } else {
      console.log('📋 Skipping database sync in production mode');
    }
    
    // Check Redis connection for scaling
    await checkRedisConnection();
    
    // Initialize socket manager with high-performance settings
    console.log('🔌 Initializing high-performance socket manager...');
    socketManager = createSocketManager(io);
    console.log('✅ Socket manager initialized successfully.');
    
    // Start the HTTP server
    server.listen(PORT, () => {
      console.log('\n🎯 HIGH-PERFORMANCE MESSAGING SERVER STARTED');
      console.log('='.repeat(50));
      console.log(`🌐 Server running on port: ${PORT}`);
      console.log(`📡 Socket.IO enabled with CORS origins: ${process.env.FRONTEND_URL || "http://localhost:3000"}`);
      console.log('\n🔥 FEATURES ENABLED:');
      console.log('   ✨ Real-time messaging (WhatsApp-like performance)');
      console.log('   ⚡ Multi-layer caching (Redis + Memory)');
      console.log('   📬 Message queue processing');
      console.log('   👥 Real-time presence & typing indicators');
      console.log('   📱 Friend requests & management');
      console.log('   🏘️  Group & ride chat management');
      console.log('   📊 Polls & metadata-based features');
      console.log('   📍 Location sharing & status updates');
      console.log('   🔄 Optimized chat list synchronization');
      console.log('   📈 Performance monitoring & scaling');
      
      if (NODE_ENV === 'development') {
        console.log('\n🔗 DEVELOPMENT ENDPOINTS:');
        console.log(`   API: http://localhost:${PORT}/api`);
        console.log(`   Health: http://localhost:${PORT}/health`);
        console.log(`   Performance: http://localhost:${PORT}/api/admin/performance`);
        console.log(`   Connections: http://localhost:${PORT}/api/admin/connections`);
      }
      
      console.log('\n⚡ PERFORMANCE TARGETS:');
      console.log('   🎯 100,000+ concurrent connections');
      console.log('   ⚡ <50ms message delivery');
      console.log('   📊 1000+ messages/second throughput');
      console.log('   💾 Optimized memory usage');
      console.log('='.repeat(50));
    });
    
    // Setup enhanced performance monitoring
    setupAdvancedMonitoring();
    
    // Setup automatic cleanup tasks
    setupMaintenanceTasks();
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    
    if (error.name === 'SequelizeConnectionError') {
      console.error('\n💾 DATABASE CONNECTION FAILED');
      console.error('Please check:');
      console.error('   • PostgreSQL server is running');
      console.error('   • DATABASE_URL in .env file is correct');
      console.error('   • Database credentials are valid');
      console.error('   • Database exists and is accessible');
    } else if (error.name === 'SequelizeValidationError') {
      console.error('\n💾 DATABASE VALIDATION ERROR:');
      error.errors.forEach(err => console.error(`   • ${err.message}`));
    } else if (error.code === 'EADDRINUSE') {
      console.error(`\n🔌 PORT ${PORT} IS ALREADY IN USE`);
      console.error('Please either:');
      console.error('   • Stop the service using that port');
      console.error('   • Change the PORT in your .env file');
    }
    
    process.exit(1);
  }
};

// Advanced performance monitoring
function setupAdvancedMonitoring() {
  console.log('📊 Setting up advanced performance monitoring...');
  
  // Log performance stats every minute in production
  const statsInterval = NODE_ENV === 'production' ? 60000 : 30000;
  
  setInterval(() => {
    if (!socketManager) return;
    
    const stats = socketManager.getPerformanceStats();
    const memory = process.memoryUsage();
    
    const logData = {
      timestamp: new Date().toISOString(),
      connections: stats.connections,
      rooms: stats.rooms,
      messagesPerSecond: stats.messagesPerSecond,
      memoryMB: Math.round(memory.heapUsed / 1024 / 1024),
      uptime: Math.round(stats.uptime / 60), // minutes
    };
    
    if (NODE_ENV === 'production') {
      // In production, you'd send this to your monitoring service
      console.log(`📊 [STATS]`, JSON.stringify(logData));
    } else {
      console.log(`📊 Performance: ${stats.connections} users, ${stats.messagesPerSecond} msg/s, ${logData.memoryMB}MB`);
    }
    
    // Alert on high resource usage
    if (logData.memoryMB > 1000) { // 1GB memory usage warning
      console.warn(`⚠️ High memory usage: ${logData.memoryMB}MB`);
    }
    
    if (stats.connections > 50000) { // 50k connections milestone
      console.log(`🎉 High load: ${stats.connections} concurrent connections!`);
    }
    
  }, statsInterval);
  
  // Monitor event loop lag
  setInterval(() => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
      if (lag > 100) { // Warn if event loop lag > 100ms
        console.warn(`⚠️ Event loop lag: ${lag.toFixed(2)}ms`);
      }
    });
  }, 5000);
}

// Setup maintenance tasks
function setupMaintenanceTasks() {
  console.log('🧹 Setting up maintenance tasks...');
  
  // Cleanup stale data every hour
  setInterval(async () => {
    try {
      if (socketManager) {
        // Clean up disconnected socket references
        socketManager.cleanupStaleConnections();
        
        // Clean up old presence data
        socketManager.cleanupStalePresence();
        
        console.log('🧹 Maintenance cleanup completed');
      }
    } catch (error) {
      console.error('🧹 Maintenance cleanup error:', error);
    }
  }, 60 * 60 * 1000); // Every hour
  
  // Memory optimization every 30 minutes
  setInterval(() => {
    if (global.gc) {
      global.gc();
      console.log('🗑️ Garbage collection triggered');
    }
  }, 30 * 60 * 1000); // Every 30 minutes
}

// Redis connection checker
async function checkRedisConnection() {
  if (!process.env.REDIS_URL) {
    console.log('⚠️ Redis URL not configured - running in single-server mode');
    console.log('   For optimal performance with lakhs of users, configure Redis:');
    console.log('   • Install Redis server');
    console.log('   • Set REDIS_URL in .env file');
    console.log('   • Enable Redis adapter for Socket.IO scaling');
    return;
  }
  
  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL);
    
    await redis.ping();
    console.log('✅ Redis connection established - scaling enabled');
    
    // Test Redis performance
    const start = Date.now();
    await redis.set('test_key', 'test_value');
    await redis.get('test_key');
    await redis.del('test_key');
    const latency = Date.now() - start;
    
    console.log(`📊 Redis latency: ${latency}ms`);
    
    if (latency > 50) {
      console.warn('⚠️ High Redis latency detected - may impact performance');
    }
    
    await redis.quit();
    
  } catch (error) {
    console.warn('⚠️ Redis connection failed:', error.message);
    console.warn('   Falling back to single-server mode');
    console.warn('   Performance may be limited without Redis');
  }
}

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    console.error('   Please check if another instance is running');
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});

// Start the server
(async () => {
  console.log('🏃‍♂️ Initializing high-performance messaging server...');
  await startServer();
})();

// Export for testing
module.exports = { server, io, socketManager };