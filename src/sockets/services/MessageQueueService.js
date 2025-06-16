// src/services/MessageQueueService.js
const Redis = require('ioredis');
const EventEmitter = require('events');
const { Chat, User } = require('../../models');

class MessageQueueService extends EventEmitter {
  constructor() {
    super();
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.subClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    // High-performance queues
    this.messageQueue = [];
    this.priorityQueue = []; // For urgent messages
    this.processingBatch = false;
    
    // Configuration
    this.batchSize = 100;
    this.batchTimeout = 25; // 25ms for ultra-fast processing
    this.maxRetries = 3;
    
    this.setupSubscriptions();
    this.startBatchProcessor();
    this.startPriorityProcessor();
  }

  setupSubscriptions() {
    // Subscribe to distributed events
    this.subClient.subscribe(
      'message:new',
      'message:update', 
      'message:delete',
      'chat:update',
      'user:online',
      'user:offline',
      'typing:start',
      'typing:stop'
    );
    
    this.subClient.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        this.emit(channel, data);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });
  }

  // Queue message for processing
  async queueMessage(messageData, priority = 'normal') {
    const messageId = this.generateMessageId();
    const timestamp = Date.now();
    
    const queuedMessage = {
      id: messageId,
      tempId: messageData.tempId,
      ...messageData,
      timestamp,
      status: 'queued',
      retries: 0,
      priority
    };

    // Add to appropriate queue
    if (priority === 'high' || messageData.message_type === 'emergency') {
      this.priorityQueue.push(queuedMessage);
    } else {
      this.messageQueue.push(queuedMessage);
    }
    
    // Store temporarily in Redis for immediate retrieval
    await this.redis.setex(`temp_msg:${messageId}`, 300, JSON.stringify(queuedMessage));
    
    // Immediate acknowledgment
    return {
      id: messageId,
      tempId: messageData.tempId,
      status: 'queued',
      timestamp
    };
  }

  // Start high-frequency batch processor
  startBatchProcessor() {
    setInterval(async () => {
      if (this.messageQueue.length > 0 && !this.processingBatch) {
        await this.processBatch();
      }
    }, this.batchTimeout);
  }

  // Start priority message processor (even faster)
  startPriorityProcessor() {
    setInterval(async () => {
      if (this.priorityQueue.length > 0) {
        await this.processPriorityMessages();
      }
    }, 10); // 10ms for urgent messages
  }

  async processBatch() {
    if (this.processingBatch) return;
    this.processingBatch = true;

    const batch = this.messageQueue.splice(0, this.batchSize);
    
    try {
      // Process all messages in parallel
      const results = await Promise.allSettled(
        batch.map(msg => this.processMessage(msg))
      );
      
      // Handle failed messages
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const failedMessage = batch[index];
          this.handleFailedMessage(failedMessage, result.reason);
        }
      });
      
    } catch (error) {
      console.error('Batch processing failed:', error);
      // Re-queue failed messages with retry logic
      batch.forEach(msg => this.handleFailedMessage(msg, error));
    }
    
    this.processingBatch = false;
  }

  async processPriorityMessages() {
    const priorityBatch = this.priorityQueue.splice(0, 10); // Smaller batches for speed
    
    try {
      await Promise.all(priorityBatch.map(msg => this.processMessage(msg)));
    } catch (error) {
      priorityBatch.forEach(msg => this.handleFailedMessage(msg, error));
    }
  }

  async processMessage(message) {
    try {
      // 1. Validate message
      if (!this.validateMessage(message)) {
        throw new Error('Invalid message format');
      }

      // 2. Save to database (optimized)
      const savedMessage = await this.saveMessageOptimized(message);
      
      // 3. Update message with DB ID
      message.id = savedMessage.id;
      message.status = 'sent';
      message.createdAt = savedMessage.createdAt;
      
      // 4. Cache the message
      await this.cacheMessage(message);
      
      // 5. Publish to subscribers
      await this.publishMessage('message:new', {
        ...message,
        dbId: savedMessage.id
      });
      
      // 6. Update sender confirmation
      await this.publishMessage('message:confirmed', {
        tempId: message.tempId,
        id: savedMessage.id,
        status: 'sent',
        timestamp: savedMessage.createdAt
      });
      
      return savedMessage;
      
    } catch (error) {
      console.error('Message processing failed:', message.id, error);
      throw error;
    }
  }

  async saveMessageOptimized(message) {
    // Use raw query for maximum performance
    const [savedMessage] = await Chat.sequelize.query(`
      INSERT INTO "Chats" (
        message, message_type, chat_type, sender_id, recipient_id, 
        ride_id, group_id, reply_to_id, metadata, created_at, updated_at
      ) VALUES (
        :message, :message_type, :chat_type, :sender_id, :recipient_id,
        :ride_id, :group_id, :reply_to_id, :metadata, NOW(), NOW()
      ) RETURNING *
    `, {
      replacements: {
        message: message.message,
        message_type: message.message_type || 'text',
        chat_type: message.chat_type || 'direct',
        sender_id: message.sender_id,
        recipient_id: message.recipient_id || null,
        ride_id: message.ride_id || null,
        group_id: message.group_id || null,
        reply_to_id: message.reply_to_id || null,
        metadata: JSON.stringify(message.metadata || {})
      },
      type: Chat.sequelize.QueryTypes.SELECT
    });

    return savedMessage;
  }

  async cacheMessage(message) {
    // Cache individual message
    await this.redis.setex(`msg:${message.id}`, 3600, JSON.stringify(message));
    
    // Add to conversation cache
    const conversationKey = this.getConversationKey(message);
    await this.redis.lpush(`conv:${conversationKey}`, JSON.stringify(message));
    await this.redis.ltrim(`conv:${conversationKey}`, 0, 99); // Keep last 100 messages
  }

  getConversationKey(message) {
    if (message.chat_type === 'direct') {
      const [user1, user2] = [message.sender_id, message.recipient_id].sort();
      return `direct:${user1}:${user2}`;
    } else if (message.chat_type === 'ride') {
      return `ride:${message.ride_id}`;
    } else if (message.chat_type === 'group') {
      return `group:${message.group_id}`;
    }
    return 'unknown';
  }

  async publishMessage(channel, data) {
    await this.pubClient.publish(channel, JSON.stringify(data));
  }

  validateMessage(message) {
    return message.sender_id && 
           (message.message || message.message_type !== 'text') &&
           ['direct', 'ride', 'group'].includes(message.chat_type);
  }

  handleFailedMessage(message, error) {
    message.retries = (message.retries || 0) + 1;
    
    if (message.retries < this.maxRetries) {
      // Re-queue with exponential backoff
      setTimeout(() => {
        if (message.priority === 'high') {
          this.priorityQueue.push(message);
        } else {
          this.messageQueue.push(message);
        }
      }, Math.pow(2, message.retries) * 1000);
    } else {
      // Failed permanently
      this.publishMessage('message:failed', {
        tempId: message.tempId,
        id: message.id,
        error: error.message
      });
    }
  }

  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cleanup and shutdown
  async shutdown() {
    await this.redis.quit();
    await this.pubClient.quit();
    await this.subClient.quit();
  }
}

module.exports = new MessageQueueService();