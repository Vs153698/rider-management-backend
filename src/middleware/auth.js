const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { cacheGet, cacheSet } = require('../config/redis');

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check cache first
    let user = await cacheGet(`user:${decoded.userId}`);
    
    if (!user) {
      user = await User.findByPk(decoded.userId);
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'User not found'
        });
      }
      
      // Cache user for 15 minutes
      await cacheSet(`user:${decoded.userId}`, user, 900);
    }

    if (!user.is_active) {
      return res.status(401).json({
        status: 'error',
        message: 'Account is deactivated'
      });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Token expired'
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Authentication failed'
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.userId);
      
      if (user && user.is_active) {
        req.user = user;
        req.userId = user.id;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

const requireVerified = (req, res, next) => {
  if (!req.user.is_verified) {
    return res.status(403).json({
      status: 'error',
      message: 'Account verification required'
    });
  }
  next();
};

const checkOwnership = (model, idField = 'id') => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params[idField];
      const resource = await model.findByPk(resourceId);
      
      if (!resource) {
        return res.status(404).json({
          status: 'error',
          message: 'Resource not found'
        });
      }

      // Check if user owns the resource
      const ownerField = model.name === 'Group' ? 'admin_id' : 
                        model.name === 'Ride' ? 'creator_id' : 'owner_id';
      
      if (resource[ownerField] !== req.userId) {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied'
        });
      }

      req.resource = resource;
      next();
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Authorization check failed'
      });
    }
  };
};

const checkGroupMembership = async (req, res, next) => {
  try {
    const groupId = req.params.groupId || req.body.group_id;
    
    if (!groupId) {
      return next();
    }

    const { Group } = require('../models');
    const group = await Group.findByPk(groupId, {
      include: [{
        model: User,
        as: 'members',
        where: { id: req.userId },
        required: false
      }]
    });

    if (!group) {
      return res.status(404).json({
        status: 'error',
        message: 'Group not found'
      });
    }

    const isMember = group.members && group.members.length > 0;
    const isAdmin = group.admin_id === req.userId;

    if (!isMember && !isAdmin) {
      return res.status(403).json({
        status: 'error',
        message: 'Group membership required'
      });
    }

    req.group = group;
    req.isGroupAdmin = isAdmin;
    next();
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Group membership check failed'
    });
  }
};

module.exports = {
  authenticate,
  optionalAuth,
  requireVerified,
  checkOwnership,
  checkGroupMembership
};