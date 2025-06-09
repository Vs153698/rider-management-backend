const { sequelize } = require('../config/database');
const User = require('./User');
const Ride = require('./Ride');
const Group = require('./Group');
const Chat = require('./Chat');
const Rental = require('./Rental');
const Payment = require('./Payment');
const UserConnection = require('./UserConnection');

// Initialize models
const models = {
  User: User(sequelize),
  Ride: Ride(sequelize),
  Group: Group(sequelize),
  Chat: Chat(sequelize),
  Rental: Rental(sequelize),
  Payment: Payment(sequelize),
  UserConnection: UserConnection(sequelize)
};

// Define associations
const defineAssociations = () => {
  const { User, Ride, Group, Chat, Rental, Payment, UserConnection } = models;

  // User associations
  User.hasMany(Ride, { foreignKey: 'creator_id', as: 'createdRides' });
  User.hasMany(Chat, { foreignKey: 'sender_id', as: 'sentMessages' });
  User.hasMany(Chat, { foreignKey: 'recipient_id', as: 'receivedMessages' });
  User.hasMany(Rental, { foreignKey: 'owner_id', as: 'ownedRentals' });
  User.hasMany(Payment, { foreignKey: 'user_id', as: 'payments' });
  User.hasMany(Payment, { foreignKey: 'recipient_id', as: 'receivedPayments' });
  User.hasMany(Group, { foreignKey: 'admin_id', as: 'administeredGroups' });

  // FIXED: User connection associations with proper aliases
  User.hasMany(UserConnection, { 
    foreignKey: 'user_id', 
    as: 'initiatedConnections',
    onDelete: 'CASCADE'
  });
  User.hasMany(UserConnection, { 
    foreignKey: 'connected_user_id', 
    as: 'receivedConnections',
    onDelete: 'CASCADE'
  });

  // User <-> Group association through group_members
  User.belongsToMany(Group, {
    through: 'group_members',
    foreignKey: 'user_id',
    otherKey: 'group_id',
    as: 'joinedGroups',
    onDelete: 'CASCADE'
  });

  // User <-> Ride association through ride_participants
  User.belongsToMany(Ride, {
    through: 'ride_participants',
    foreignKey: 'user_id',
    otherKey: 'ride_id',
    as: 'participatedRides',
    onDelete: 'CASCADE'
  });

  // User <-> Rental association through rental_bookings
  User.belongsToMany(Rental, {
    through: 'rental_bookings',
    foreignKey: 'user_id',
    otherKey: 'rental_id',
    as: 'rentedItems',
    onDelete: 'CASCADE'
  });

  // Ride associations
  Ride.belongsTo(User, { foreignKey: 'creator_id', as: 'creator' });
  Ride.belongsTo(Group, { foreignKey: 'group_id', as: 'group' });
  Ride.belongsToMany(User, {
    through: 'ride_participants',
    foreignKey: 'ride_id',
    otherKey: 'user_id',
    as: 'participants'
  });
  Ride.hasMany(Chat, { foreignKey: 'ride_id', as: 'messages' });
  Ride.hasMany(Payment, { foreignKey: 'ride_id', as: 'payments' });

  // Group associations
  Group.belongsTo(User, { foreignKey: 'admin_id', as: 'admin' });
  Group.belongsToMany(User, {
    through: 'group_members',
    foreignKey: 'group_id',
    otherKey: 'user_id',
    as: 'members'
  });
  Group.hasMany(Ride, { foreignKey: 'group_id', as: 'rides' });
  Group.hasMany(Chat, { foreignKey: 'group_id', as: 'messages' });
  Group.hasMany(Payment, { foreignKey: 'group_id', as: 'payments' });

  // Chat associations
  Chat.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });
  Chat.belongsTo(User, { foreignKey: 'recipient_id', as: 'recipient' });
  Chat.belongsTo(Ride, { foreignKey: 'ride_id', as: 'ride' });
  Chat.belongsTo(Group, { foreignKey: 'group_id', as: 'group' });
  
  // Chat self-reference for replies
  Chat.belongsTo(Chat, { 
    foreignKey: 'reply_to_id', 
    as: 'replyTo',
    constraints: false 
  });
  Chat.hasMany(Chat, { 
    foreignKey: 'reply_to_id', 
    as: 'replies',
    constraints: false 
  });

  // FIXED: UserConnection associations with proper structure
  UserConnection.belongsTo(User, { 
    foreignKey: 'user_id', 
    as: 'user',
    onDelete: 'CASCADE'
  });
  UserConnection.belongsTo(User, { 
    foreignKey: 'connected_user_id', 
    as: 'connectedUser',
    onDelete: 'CASCADE'
  });
  UserConnection.belongsTo(User, { 
    foreignKey: 'initiated_by', 
    as: 'initiator',
    onDelete: 'CASCADE'
  });

  // Rental associations
  Rental.belongsTo(User, { foreignKey: 'owner_id', as: 'owner' });
  Rental.belongsToMany(User, {
    through: 'rental_bookings',
    foreignKey: 'rental_id',
    otherKey: 'user_id',
    as: 'renters'
  });
  Rental.hasMany(Payment, { foreignKey: 'rental_id', as: 'payments' });

  // Payment associations
  Payment.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  Payment.belongsTo(User, { foreignKey: 'recipient_id', as: 'recipient' });
  Payment.belongsTo(Ride, { foreignKey: 'ride_id', as: 'ride' });
  Payment.belongsTo(Group, { foreignKey: 'group_id', as: 'group' });
  Payment.belongsTo(Rental, { foreignKey: 'rental_id', as: 'rental' });
};

// Initialize associations
defineAssociations();

// ENHANCED: Better sync function with dependency handling and error recovery
const syncDatabase = async (options = {}) => {
  try {
    console.log('🔄 Starting database synchronization...');
    
    // Check database connection first
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    // For MySQL/MariaDB: Disable foreign key checks temporarily if force sync
    const dialectName = sequelize.getDialect();
    if (options.force && (dialectName === 'mysql' || dialectName === 'mariadb')) {
      console.log('⚠️  Force sync detected - temporarily disabling foreign key checks');
      await sequelize.query('SET foreign_key_checks = 0;', { logging: false });
    }
    
    // Step 1: Sync base models (no foreign key dependencies)
    console.log('📝 Syncing User model...');
    await models.User.sync(options);
    console.log('✅ User model synced');

    // Step 2: Sync models that only depend on User
    console.log('📝 Syncing Group model...');
    await models.Group.sync(options);
    console.log('✅ Group model synced');

    console.log('📝 Syncing Rental model...');
    await models.Rental.sync(options);
    console.log('✅ Rental model synced');

    // CRITICAL: UserConnection must be synced after User but before Chat
    console.log('📝 Syncing UserConnection model...');
    await models.UserConnection.sync(options);
    console.log('✅ UserConnection model synced');

    // Step 3: Sync Ride model (depends on User and Group)
    console.log('📝 Syncing Ride model...');
    await models.Ride.sync(options);
    console.log('✅ Ride model synced');

    // Step 4: Sync models that depend on multiple tables including Ride
    console.log('📝 Syncing Chat model...');
    await models.Chat.sync(options);
    console.log('✅ Chat model synced');

    console.log('📝 Syncing Payment model...');
    await models.Payment.sync(options);
    console.log('✅ Payment model synced');

    // Step 5: Re-enable foreign key checks and sync junction tables
    if (options.force && (dialectName === 'mysql' || dialectName === 'mariadb')) {
      console.log('🔄 Re-enabling foreign key checks');
      await sequelize.query('SET foreign_key_checks = 1;', { logging: false });
    }

    console.log('📝 Syncing junction tables...');
    await sequelize.sync({ 
      ...options, 
      logging: process.env.NODE_ENV === 'development' ? console.log : false 
    });
    console.log('✅ Junction tables synced');

    console.log('🎉 Database synchronization completed successfully!');
    
    // ADDED: Create indexes for better performance
    await createOptimizedIndexes();
    
  } catch (error) {
    console.error('❌ Database synchronization failed:', error);
    
    // Re-enable foreign key checks in case of error
    const dialectName = sequelize.getDialect();
    if (options.force && (dialectName === 'mysql' || dialectName === 'mariadb')) {
      try {
        await sequelize.query('SET foreign_key_checks = 1;', { logging: false });
      } catch (fkError) {
        console.error('Failed to re-enable foreign key checks:', fkError);
      }
    }
    
    throw error;
  }
};

// ADDED: Create optimized indexes for friend system and chat performance
const createOptimizedIndexes = async () => {
  try {
    console.log('🔍 Creating optimized indexes...');
    
    // Friend system indexes
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_user_connections_friendship 
      ON user_connections(user_id, connected_user_id, status)
    `, { logging: false });

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_user_connections_pending 
      ON user_connections(connected_user_id, status, created_at) 
      WHERE status = 'pending'
    `, { logging: false });

    // Chat system indexes
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_direct_conversation 
      ON chats(sender_id, recipient_id, chat_type, created_at) 
      WHERE chat_type = 'direct'
    `, { logging: false });

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_unread 
      ON chats(recipient_id, is_read, chat_type) 
      WHERE is_read = false
    `, { logging: false });

    // User activity indexes
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_users_active 
      ON users(is_active, last_active)
    `, { logging: false });

    console.log('✅ Optimized indexes created');
  } catch (error) {
    // Don't fail the entire sync for index creation errors
    console.warn('⚠️  Index creation failed (non-critical):', error.message);
  }
};

// ADDED: Safe migration function for production
const migrateDatabase = async () => {
  try {
    console.log('🔄 Starting database migration...');
    
    // Use alter mode for safer production migrations
    await syncDatabase({ alter: true });
    
    console.log('🎉 Database migration completed successfully!');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    throw error;
  }
};

// ADDED: Database health check function
const checkDatabaseHealth = async () => {
  try {
    await sequelize.authenticate();
    
    // Check if all required tables exist
    const requiredTables = ['users', 'user_connections', 'chats', 'rides', 'groups'];
    const existingTables = await sequelize.getQueryInterface().showAllTables();
    
    const missingTables = requiredTables.filter(table => 
      !existingTables.includes(table)
    );
    
    if (missingTables.length > 0) {
      throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    }
    
    console.log('✅ Database health check passed');
    return true;
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return false;
  }
};

// ADDED: Cleanup function for development
const cleanupDatabase = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot cleanup database in production environment');
  }
  
  try {
    console.log('🧹 Cleaning up database...');
    await sequelize.drop();
    console.log('✅ Database cleaned up');
  } catch (error) {
    console.error('❌ Database cleanup failed:', error);
    throw error;
  }
};

// Alternative approach: Use Sequelize's built-in sync with proper order
const syncDatabaseAlternative = async (options = {}) => {
  try {
    console.log('🔄 Starting database synchronization (alternative approach)...');
    
    // Sync all models at once, Sequelize will handle dependencies
    await sequelize.sync({
      ...options,
      // This ensures tables are created in the right order
      logging: process.env.NODE_ENV === 'development' ? console.log : false
    });
    
    console.log('🎉 Database synchronization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database synchronization failed:', error);
    throw error;
  }
};

// Override sequelize.sync to use our custom sync function
sequelize.syncModels = syncDatabase;
sequelize.migrate = migrateDatabase;
sequelize.healthCheck = checkDatabaseHealth;
sequelize.cleanup = cleanupDatabase;

// ADDED: Export helper functions for friend system
const FriendHelpers = {
  async areFriends(userId1, userId2) {
    return await models.UserConnection.areFriends(userId1, userId2);
  },
  
  async getConnectionStatus(userId1, userId2) {
    return await models.UserConnection.getConnectionStatus(userId1, userId2);
  },
  
  async isBlocked(userId1, userId2) {
    return await models.UserConnection.isBlocked(userId1, userId2);
  }
};

// ADDED: Export helper functions for chat system
const ChatHelpers = {
  getDirectConversationId(userId1, userId2) {
    return models.Chat.getDirectConversationId(userId1, userId2);
  },
  
  async canUserAccessChat(userId, chatType, contextId) {
    // Implementation would depend on your specific business logic
    return true; // Placeholder
  }
};

module.exports = {
  sequelize,
  syncDatabase,
  syncDatabaseAlternative,
  migrateDatabase,
  checkDatabaseHealth,
  cleanupDatabase,
  FriendHelpers,
  ChatHelpers,
  ...models
};