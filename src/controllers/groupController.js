const { Group, User, Ride } = require('../models');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { uploadToCloudinary } = require('../config/cloudinary');
const { createPaymentOrder } = require('../services/paymentService');
const { sendGroupInvitation, notifyGroupMembers } = require('../services/notificationService');
const { findNearbyGroups } = require('../services/locationService');
const { getPagination, getPagingData } = require('../utils/helpers');
const { Op } = require('sequelize');
const Joi = require('joi');

// Create a new group
const createGroup = catchAsync(async (req, res, next) => {
  
  const groupData = {
    ...req.body,
    admin_id: req.userId
  };

  // Upload cover image if provided
  if (req.file) {
    try {
      const result = await uploadToCloudinary(req.file, 'group-covers');
      groupData.cover_image = result.secure_url;
    } catch (error) {
      return next(new AppError('Failed to upload cover image', 500));
    }
  }

  const group = await Group.create(groupData);

  // Add creator as first member
  const user = await User.findByPk(req.userId);
  await group.addMember(user);

  // Include admin details in response
  const groupWithAdmin = await Group.findByPk(group.id, {
    include: [
      {
        model: User,
        as: 'admin',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ]
  });

  res.status(201).json({
    status: 'success',
    message: 'Group created successfully',
    data: {
      group: groupWithAdmin
    }
  });
});

// Get all groups with filters
const getGroups = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    group_type,
    is_paid,
    search,
    tags,
    sort = 'created_at',
    order = 'DESC'
  } = req.query;

  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  // Build where clause
  const whereClause = { is_active: true };
  
  if (group_type) whereClause.group_type = group_type;
  if (is_paid !== undefined) whereClause.is_paid = is_paid === 'true';
  
  if (search) {
    whereClause[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } }
    ];
  }

  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    whereClause.tags = { [Op.overlap]: tagArray };
  }

  const groups = await Group.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'admin',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      },
      {
        model: User,
        as: 'members',
        through: { attributes: [] },
        attributes: ['id'],
        required: false
      }
    ],
    limit: limitNum,
    offset,
    order: [[sort, order]]
  });

  const response = getPagingData(groups, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: response
  });
});

// Get nearby groups
const getNearbyGroups = catchAsync(async (req, res, next) => {
  const { latitude, longitude, radius = 50 } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  try {
    const groups = await findNearbyGroups(
      parseFloat(latitude),
      parseFloat(longitude),
      parseInt(radius)
    );

    res.status(200).json({
      status: 'success',
      data: {
        groups,
        count: groups.length
      }
    });
  } catch (error) {
    return next(new AppError('Failed to find nearby groups', 500));
  }
});
// Get groups where user is admin only (name and id only)
const getUserAdminGroups = catchAsync(async (req, res, next) => {
  const userId = req.userId;

  const adminGroups = await Group.findAll({
    where: { 
      admin_id: userId,
      is_active: true 
    },
    attributes: ['id', 'name'],
    order: [['name', 'ASC']]
  });

  res.status(200).json({
    status: 'success',
    data: {
      groups: adminGroups.map(group => ({
        id: group.id,
        name: group.name
      })),
      count: adminGroups.length
    }
  });
});

// Get all groups where user is either admin or member (name and id only)
const getUserAllGroups = catchAsync(async (req, res, next) => {
  const userId = req.userId;

  // Find groups where user is admin
  const adminGroups = await Group.findAll({
    where: { 
      admin_id: userId,
      is_active: true 
    },
    attributes: ['id', 'name'],
    order: [['name', 'ASC']]
  });

  // Find groups where user is a member (but not admin)
  const memberGroups = await Group.findAll({
    include: [
      {
        model: User,
        as: 'members',
        where: { id: userId },
        through: { attributes: [] },
        attributes: []
      }
    ],
    where: { 
      is_active: true,
      admin_id: { [Op.ne]: userId } // Exclude groups where user is admin
    },
    attributes: ['id', 'name'],
    order: [['name', 'ASC']]
  });

  // Combine both arrays
  const allGroups = [
    ...adminGroups.map(group => ({
      id: group.id,
      name: group.name
    })),
    ...memberGroups.map(group => ({
      id: group.id,
      name: group.name
    }))
  ];

  // Sort by name
  allGroups.sort((a, b) => a.name.localeCompare(b.name));

  res.status(200).json({
    status: 'success',
    data: {
      groups: allGroups,
      count: allGroups.length
    }
  });
});


// Get group by ID
const getGroupById = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;

  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'admin',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
      },
      {
        model: User,
        as: 'members',
        through: { attributes: [] },
        attributes: ['id', 'first_name', 'last_name', 'profile_picture'],
        limit: 10 // Show first 10 members
      },
      {
        model: Ride,
        as: 'rides',
        where: { status: 'upcoming' },
        required: false,
        limit: 5,
        order: [['ride_date', 'ASC']],
        include: [
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'first_name', 'last_name']
          }
        ]
      }
    ]
  });

  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  // Add user's membership status if authenticated
  let userStatus = {
    is_admin: false,
    is_member: false,
    can_join: group.canJoin()
  };

  if (req.userId) {
    const isMember = group.members?.some(m => m.id === req.userId) || false;
    const isAdmin = group.admin_id === req.userId;

    userStatus = {
      is_admin: isAdmin,
      is_member: isMember,
      can_join: group.canJoin() && !isMember && !isAdmin
    };
  }

  res.status(200).json({
    status: 'success',
    data: {
      group: {
        ...group.toJSON(),
        user_status: userStatus
      }
    }
  });
});

// Update group
const updateGroup = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;

  const group = await Group.findByPk(groupId);
  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  if (!group.canEdit(req.userId)) {
    return next(new AppError('Only group admin can update the group', 403));
  }

  // Upload new cover image if provided
  let updateData = { ...req.body };
  if (req.file) {
    try {
      const result = await uploadToCloudinary(req.file, 'group-covers');
      updateData.cover_image = result.secure_url;
    } catch (error) {
      return next(new AppError('Failed to upload cover image', 500));
    }
  }

  const updatedGroup = await group.update(updateData);

  // Notify members about changes if significant updates
  const significantFields = ['name', 'description', 'rules', 'membership_fee'];
  const hasSignificantChanges = significantFields.some(field => 
    req.body.hasOwnProperty(field)
  );

  if (hasSignificantChanges) {
    try {
      const members = await User.findAll({
        include: [{
          model: Group,
          as: 'joinedGroups',
          where: { id: groupId },
          through: { attributes: [] }
        }]
      });

      if (members.length > 0) {
        const message = `Group "${group.name}" has been updated. Check the app for details.`;
        await notifyGroupMembers(members, message);
      }
    } catch (error) {
      // Log error but don't fail the update
      console.error('Failed to notify group members:', error);
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Group updated successfully',
    data: {
      group: updatedGroup
    }
  });
});

// Join group
const joinGroup = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;
  console.log('Group ID:', groupId);

  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'admin',
        attributes: ['id', 'first_name', 'last_name']
      },
      {
        model: User,
        as: 'members',
        through: { attributes: [] },
        where: { id: req.userId },
        required: false
      }
    ]
  });

  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  if (!group.canJoin()) {
    return next(new AppError('Cannot join this group', 400));
  }

  // Check if user is already a member
  const isAlreadyMember = group.members?.some(m => m.id === req.userId);
  if (isAlreadyMember || group.admin_id === req.userId) {
    return next(new AppError('You are already a member of this group', 400));
  }

  // Handle payment for paid groups
  if (group.is_paid && group.membership_fee > 0) {
    try {
      const paymentOrder = await createPaymentOrder({
        user_id: req.userId,
        amount: group.membership_fee,
        payment_type: 'group_membership',
        group_id: groupId,
        recipient_id: group.admin_id,
        metadata: {
          group_name: group.name,
          membership_type: 'standard'
        }
      });

      return res.status(200).json({
        status: 'success',
        message: 'Payment required to join group',
        data: {
          payment_required: true,
          payment_order: paymentOrder,
          group_details: {
            id: group.id,
            name: group.name,
            membership_fee: group.membership_fee,
            currency: group.currency
          }
        }
      });
    } catch (error) {
      return next(new AppError('Failed to create payment order', 500));
    }
  }

  // Add user to group members for free groups
  const user = await User.findByPk(req.userId);
  await group.addMember(user);
  await group.increment('current_members');

  res.status(200).json({
    status: 'success',
    message: 'Successfully joined the group',
    data: {
      group_id: groupId,
      payment_required: false
    }
  });
});

// Leave group
const leaveGroup = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;

  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'members',
        through: { attributes: [] },
        where: { id: req.userId },
        required: false
      }
    ]
  });

  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  if (group.admin_id === req.userId) {
    return next(new AppError('Group admin cannot leave the group. Transfer admin rights first.', 400));
  }

  const isMember = group.members?.some(m => m.id === req.userId);
  if (!isMember) {
    return next(new AppError('You are not a member of this group', 400));
  }

  // Remove user from group members
  const user = await User.findByPk(req.userId);
  await group.removeMember(user);
  await group.decrement('current_members');

  res.status(200).json({
    status: 'success',
    message: 'Successfully left the group'
  });
});

// Invite users to group
const inviteToGroup = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;
  const { user_ids, phone_numbers, message } = req.body;

  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'admin',
        attributes: ['id', 'first_name', 'last_name']
      }
    ]
  });

  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  // Check if user has permission to invite
  const canInvite = group.admin_id === req.userId || 
                   (group.settings?.allow_member_invite && 
                    await group.hasMember(req.userId));

  if (!canInvite) {
    return next(new AppError('You do not have permission to send invitations', 403));
  }

  const invitations = [];

  // Invite by user IDs
  if (user_ids && user_ids.length > 0) {
    const users = await User.findAll({
      where: { id: { [Op.in]: user_ids } }
    });

    for (const user of users) {
      try {
        await sendGroupInvitation(user, group, group.admin.getFullName(), message);
        invitations.push({ 
          user_id: user.id, 
          user_name: user.getFullName(),
          status: 'sent' 
        });
      } catch (error) {
        invitations.push({ 
          user_id: user.id, 
          status: 'failed', 
          error: error.message 
        });
      }
    }
  }

  // Invite by phone numbers
  if (phone_numbers && phone_numbers.length > 0) {
    const users = await User.findAll({
      where: { phone_number: { [Op.in]: phone_numbers } }
    });

    for (const user of users) {
      try {
        await sendGroupInvitation(user, group, group.admin.getFullName(), message);
        invitations.push({ 
          phone_number: user.phone_number,
          user_name: user.getFullName(),
          status: 'sent' 
        });
      } catch (error) {
        invitations.push({ 
          phone_number: user.phone_number, 
          status: 'failed', 
          error: error.message 
        });
      }
    }

    // Handle phone numbers not found in system
    const foundPhones = users.map(u => u.phone_number);
    const notFoundPhones = phone_numbers.filter(phone => !foundPhones.includes(phone));
    
    notFoundPhones.forEach(phone => {
      invitations.push({
        phone_number: phone,
        status: 'user_not_found',
        message: 'User not registered in the app'
      });
    });
  }

  res.status(200).json({
    status: 'success',
    message: 'Invitations processed',
    data: {
      invitations,
      total_sent: invitations.filter(inv => inv.status === 'sent').length,
      total_failed: invitations.filter(inv => inv.status === 'failed').length
    }
  });
});

// Get group members
const getGroupMembers = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;
  const { page = 1, limit = 20, search, role } = req.query;
  const { limit: limitNum, offset } = getPagination(page - 1, limit);

  const group = await Group.findByPk(groupId);
  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  // Build search conditions
  const memberWhere = {};
  if (search) {
    memberWhere[Op.or] = [
      { first_name: { [Op.iLike]: `%${search}%` } },
      { last_name: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const throughWhere = {};
  if (role) {
    throughWhere.role = role;
  }

  const members = await User.findAndCountAll({
    include: [{
      model: Group,
      as: 'joinedGroups',
      where: { id: groupId },
      through: { 
        attributes: ['role', 'status', 'joined_at'],
        where: throughWhere
      }
    }],
    where: memberWhere,
    attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number'],
    limit: limitNum,
    offset,
    order: [['first_name', 'ASC']]
  });

  // Get admin details separately
  const admin = await User.findByPk(group.admin_id, {
    attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
  });

  const response = getPagingData(members, page - 1, limitNum);

  res.status(200).json({
    status: 'success',
    data: {
      admin,
      members: response.items,
      pagination: {
        total: response.totalItems,
        pages: response.totalPages,
        currentPage: response.currentPage,
        hasNext: response.hasNext,
        hasPrev: response.hasPrev
      },
      total_members: group.current_members
    }
  });
});

// Remove member from group (admin only)
const removeMember = catchAsync(async (req, res, next) => {
  const { groupId, userId } = req.params;
  const { reason } = req.body;

  const group = await Group.findByPk(groupId);
  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  if (group.admin_id !== req.userId) {
    return next(new AppError('Only group admin can remove members', 403));
  }

  if (userId === group.admin_id) {
    return next(new AppError('Cannot remove group admin', 400));
  }

  const user = await User.findByPk(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Check if user is actually a member
  const isMember = await group.hasMember(user);
  if (!isMember) {
    return next(new AppError('User is not a member of this group', 400));
  }

  await group.removeMember(user);
  await group.decrement('current_members');

  // Optionally notify the removed user
  if (reason) {
    try {
      const message = `You have been removed from group "${group.name}". Reason: ${reason}`;
      // Send notification logic here
    } catch (error) {
      // Log but don't fail the removal
      console.error('Failed to notify removed user:', error);
    }
  }

  res.status(200).json({
    status: 'success',
    message: 'Member removed successfully'
  });
});

// Transfer admin rights
const transferAdmin = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;
  const { new_admin_id } = req.body;

  const group = await Group.findByPk(groupId, {
    include: [
      {
        model: User,
        as: 'members',
        through: { attributes: [] },
        where: { id: new_admin_id },
        required: false
      }
    ]
  });

  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  if (group.admin_id !== req.userId) {
    return next(new AppError('Only current admin can transfer admin rights', 403));
  }

  if (new_admin_id === req.userId) {
    return next(new AppError('You are already the admin', 400));
  }

  // Check if new admin is a member
  const isMember = group.members?.some(m => m.id === new_admin_id);
  if (!isMember) {
    return next(new AppError('New admin must be a group member', 400));
  }

  const newAdmin = await User.findByPk(new_admin_id);
  if (!newAdmin) {
    return next(new AppError('New admin user not found', 404));
  }

  await group.update({ admin_id: new_admin_id });

  // Notify group members about admin change
  try {
    const members = await User.findAll({
      include: [{
        model: Group,
        as: 'joinedGroups',
        where: { id: groupId },
        through: { attributes: [] }
      }]
    });

    const message = `${newAdmin.getFullName()} is now the admin of group "${group.name}".`;
    await notifyGroupMembers(members, message);
  } catch (error) {
    console.error('Failed to notify group members about admin change:', error);
  }

  res.status(200).json({
    status: 'success',
    message: 'Admin rights transferred successfully',
    data: {
      new_admin: {
        id: newAdmin.id,
        name: newAdmin.getFullName()
      }
    }
  });
});

// Delete group
const deleteGroup = catchAsync(async (req, res, next) => {
  const { groupId } = req.params;

  const group = await Group.findByPk(groupId);
  if (!group) {
    return next(new AppError('Group not found', 404));
  }

  if (group.admin_id !== req.userId) {
    return next(new AppError('Only group admin can delete the group', 403));
  }

  // Soft delete by setting inactive
  await group.update({ is_active: false });

  // Notify all members about group deletion
  try {
    const members = await User.findAll({
      include: [{
        model: Group,
        as: 'joinedGroups',
        where: { id: groupId },
        through: { attributes: [] }
      }]
    });

    if (members.length > 0) {
      const message = `Group "${group.name}" has been deleted by the admin.`;
      await notifyGroupMembers(members, message);
    }
  } catch (error) {
    console.error('Failed to notify group members about deletion:', error);
  }

  res.status(200).json({
    status: 'success',
    message: 'Group deleted successfully'
  });
});

module.exports = {
  createGroup,
  getGroups,
  getNearbyGroups,
  getGroupById,
  updateGroup,
  joinGroup,
  leaveGroup,
  inviteToGroup,
  getGroupMembers,
  removeMember,
  transferAdmin,
  deleteGroup,
  getUserAdminGroups,
  getUserAllGroups
};