const { sequelize } = require('../config/database');
const User = require('./User');
const Ride = require('./Ride');
const Group = require('./Group');
const Chat = require('./Chat');
const Rental = require('./Rental');
const Payment = require('./Payment');

// Initialize models
const models = {
  User: User(sequelize),
  Ride: Ride(sequelize),
  Group: Group(sequelize),
  Chat: Chat(sequelize),
  Rental: Rental(sequelize),
  Payment: Payment(sequelize)
};

// Define associations
const defineAssociations = () => {
  const { User, Ride, Group, Chat, Rental, Payment } = models;

  // User associations
  User.hasMany(Ride, { foreignKey: 'creator_id', as: 'createdRides' });
  User.hasMany(Chat, { foreignKey: 'sender_id', as: 'sentMessages' });
  User.hasMany(Rental, { foreignKey: 'owner_id', as: 'ownedRentals' });
  User.hasMany(Payment, { foreignKey: 'user_id', as: 'payments' });
  User.hasMany(Payment, { foreignKey: 'recipient_id', as: 'receivedPayments' });
  User.hasMany(Group, { foreignKey: 'admin_id', as: 'administeredGroups' });

  // User <-> Group association through group_members
  User.belongsToMany(Group, {
    through: 'group_members',
    foreignKey: 'user_id',
    otherKey: 'group_id',
    as: 'joinedGroups'
  });

  // User <-> Ride association through ride_participants
  User.belongsToMany(Ride, {
    through: 'ride_participants',
    foreignKey: 'user_id',
    otherKey: 'ride_id',
    as: 'participatedRides'
  });

  // User <-> Rental association through rental_bookings
  User.belongsToMany(Rental, {
    through: 'rental_bookings',
    foreignKey: 'user_id',
    otherKey: 'rental_id',
    as: 'rentedItems'
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

// Enhanced sync function with better dependency handling
const syncDatabase = async (options = {}) => {
  try {
    console.log('🔄 Starting database synchronization...');
    
    // Option 1: Disable foreign key checks temporarily (if using force: true)
    if (options.force) {
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
    if (options.force) {
      console.log('🔄 Re-enabling foreign key checks');
      await sequelize.query('SET foreign_key_checks = 1;', { logging: false });
    }

    console.log('📝 Syncing junction tables...');
    await sequelize.sync({ ...options, logging: false });
    console.log('✅ Junction tables synced');

    console.log('🎉 Database synchronization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database synchronization failed:', error);
    
    // Re-enable foreign key checks in case of error
    if (options.force) {
      try {
        await sequelize.query('SET foreign_key_checks = 1;', { logging: false });
      } catch (fkError) {
        console.error('Failed to re-enable foreign key checks:', fkError);
      }
    }
    
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
      logging: console.log
    });
    
    console.log('🎉 Database synchronization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database synchronization failed:', error);
    throw error;
  }
};

// Override sequelize.sync to use our custom sync function
sequelize.syncModels = syncDatabase;

module.exports = {
  sequelize,
  syncDatabase,
  syncDatabaseAlternative, // Export alternative method
  ...models
};