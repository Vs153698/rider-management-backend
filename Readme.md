# Rider Management Backend

A comprehensive backend system for a rider management application with groups, chat, rentals, and payment integration using Cashfree.

## Features

### Core Functionality
- **User Management**: Registration, authentication, profile management with bike info
- **Ride Management**: Create, join, and manage rides with waypoints and location-based discovery
- **Group Management**: Create paid/free groups with admin controls
- **Real-time Chat**: WebSocket-based messaging for rides and groups
- **Rental System**: Peer-to-peer item rentals with booking management
- **Payment Integration**: Cashfree payment gateway for rides, groups, and rentals
- **Location Services**: Location-based ride discovery within 50km radius

### Technical Features
- **Authentication**: JWT-based auth with phone verification
- **File Uploads**: Cloudinary integration for images
- **Real-time Communication**: Socket.io for chat and live updates
- **Caching**: Redis for performance optimization
- **Notifications**: SMS and email notifications via Twilio and Nodemailer
- **Security**: Rate limiting, input validation, and security headers

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Caching**: Redis
- **Real-time**: Socket.io
- **Authentication**: JWT
- **Payments**: Cashfree Payment Gateway
- **File Storage**: Cloudinary
- **Notifications**: Twilio (SMS), Nodemailer (Email)

## Installation

### Prerequisites
- Node.js (v16 or higher)
- PostgreSQL (v12 or higher)
- Redis (v6 or higher)

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd rider-management-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Configuration**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=rider_management
DB_USER=postgres
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# Cashfree
CASHFREE_APP_ID=your_cashfree_app_id
CASHFREE_SECRET_KEY=your_cashfree_secret_key

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Twilio
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
```

4. **Database Setup**
```bash
# Create database
createdb rider_management

# Run migrations
npm run migrate

# Seed initial data (optional)
npm run seed
```

5. **Start the server**
```bash
# Development
npm run dev

# Production
npm start
```

## API Documentation

### Authentication Endpoints

#### Send Verification Code
```http
POST /api/auth/send-verification
Content-Type: application/json

{
  "phone_number": "9876543210"
}
```

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "phone_number": "9876543210",
  "email": "user@example.com",
  "password": "password123",
  "first_name": "John",
  "last_name": "Doe",
  "verification_code": "123456"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "phone_number": "9876543210",
  "password": "password123"
}
```

### Ride Endpoints

#### Create Ride
```http
POST /api/rides
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Weekend Mountain Ride",
  "description": "Scenic mountain route",
  "start_location": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "address": "Bangalore, Karnataka"
  },
  "end_location": {
    "latitude": 13.1986,
    "longitude": 77.7066,
    "address": "Nandi Hills, Karnataka"
  },
  "ride_date": "2025-06-15",
  "ride_time": "06:00",
  "max_participants": 10,
  "is_paid": true,
  "price": 500
}
```

#### Get Nearby Rides
```http
GET /api/rides/nearby?latitude=12.9716&longitude=77.5946&radius=50
Authorization: Bearer <token>
```

### Group Endpoints

#### Create Group
```http
POST /api/groups
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Bangalore Riders",
  "description": "Weekend riding group for Bangalore",
  "group_type": "public",
  "is_paid": true,
  "membership_fee": 1000,
  "max_members": 50
}
```

### Chat Endpoints

#### Get Messages
```http
GET /api/chat/ride/:rideId/messages?page=1&limit=20
Authorization: Bearer <token>
```

#### Send Message
```http
POST /api/chat/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Looking forward to the ride!",
  "ride_id": "ride-uuid",
  "message_type": "text"
}
```

### Rental Endpoints

#### Create Rental
```http
POST /api/rentals
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Premium Helmet",
  "description": "High-quality riding helmet",
  "category": "safety_gear",
  "condition": "like_new",
  "price_per_day": 100,
  "location": {
    "latitude": 12.9716,
    "longitude": 77.5946,
    "address": "Bangalore, Karnataka"
  }
}
```

### Payment Endpoints

#### Create Payment
```http
POST /api/payments/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 500,
  "payment_type": "ride_fee",
  "ride_id": "ride-uuid"
}
```

## WebSocket Events

### Connection
```javascript
const socket = io('https://fawn-main-jaybird.ngrok-free.app', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Join Ride Chat
```javascript
socket.emit('join_ride', 'ride-uuid');
```

### Send Message
```javascript
socket.emit('send_message', {
  message: 'Hello everyone!',
  ride_id: 'ride-uuid',
  message_type: 'text'
});
```

### Listen for Messages
```javascript
socket.on('new_message', (message) => {
  console.log('New message:', message);
});
```

## Database Schema

### Key Tables
- **users**: User profiles with bike info and emergency contacts
- **rides**: Ride details with locations and waypoints
- **groups**: Group management with membership
- **chats**: Real-time messaging system
- **rentals**: Item rental marketplace
- **payments**: Payment transactions and history

### Relationships
- Users can create multiple rides and groups
- Rides belong to groups (optional)
- Users can join multiple rides and groups
- Chats belong to either rides or groups
- Rentals are owned by users
- Payments link users to rides/groups/rentals

## Deployment

### Docker Deployment
```bash
# Build image
docker build -t rider-backend .

# Run with docker-compose
docker-compose up -d
```

### Environment Variables for Production
```env
NODE_ENV=production
PORT=3000
DB_HOST=your-production-db-host
REDIS_HOST=your-production-redis-host
```

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Security Considerations

- All endpoints require authentication except auth routes
- Input validation on all endpoints
- Rate limiting on sensitive operations
- SQL injection prevention via Sequelize ORM
- XSS protection with input sanitization
- Secure file upload with type validation

## Performance Optimizations

- Redis caching for frequently accessed data
- Database indexing on search fields
- Connection pooling for database
- Compressed responses
- Optimized database queries with includes

## License

MIT License - see LICENSE file for details