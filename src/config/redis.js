const Redis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || null,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

// Redis client for general use
const redisClient = new Redis(redisConfig);

// Connect Redis function
const connectRedis = async () => {
  redisClient.on('connect', () => {
    console.log('Redis client connected');
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err.message);
  });
};

// Cache set
const cacheSet = async (key, value, expireTime = 3600) => {
  try {
    await redisClient.set(key, JSON.stringify(value), 'EX', expireTime);
  } catch (error) {
    console.error('Cache set error:', error.message);
  }
};

// Cache get
const cacheGet = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Cache get error:', error.message);
    return null;
  }
};

// Cache delete
const cacheDel = async (key) => {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error('Cache delete error:', error.message);
  }
};

module.exports = {
  redisClient,
  connectRedis,
  cacheSet,
  cacheGet,
  cacheDel
};
