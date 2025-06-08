const { Op } = require('sequelize');

// Calculate distance between two points using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
};

const toRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

// Find nearby locations within radius
const findNearbyLocations = (userLat, userLon, locations, radiusKm = 50) => {
  return locations.filter(location => {
    const lat = location.latitude || location.start_location?.latitude;
    const lon = location.longitude || location.start_location?.longitude;
    
    if (!lat || !lon) return false;
    
    const distance = calculateDistance(userLat, userLon, lat, lon);
    return distance <= radiusKm;
  });
};

// Get bounding box for efficient database queries
const getBoundingBox = (latitude, longitude, radiusKm) => {
  const latDelta = radiusKm / 111; // Approximate km per degree latitude
  const lonDelta = radiusKm / (111 * Math.cos(toRadians(latitude))); // Adjust for longitude
  
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLon: longitude - lonDelta,
    maxLon: longitude + lonDelta
  };
};

// Build location-based where clause for Sequelize
const buildLocationWhereClause = (latitude, longitude, radiusKm = 50, locationField = 'start_location') => {
  const bbox = getBoundingBox(latitude, longitude, radiusKm);
  
  return {
    [Op.and]: [
      { [`${locationField}.latitude`]: { [Op.between]: [bbox.minLat, bbox.maxLat] } },
      { [`${locationField}.longitude`]: { [Op.between]: [bbox.minLon, bbox.maxLon] } }
    ]
  };
};

// Check if a point is within waypoints radius
const isWithinWaypoints = (userLat, userLon, waypoints, radiusKm = 50) => {
  if (!waypoints || waypoints.length === 0) return false;
  
  return waypoints.some(waypoint => {
    const distance = calculateDistance(userLat, userLon, waypoint.latitude, waypoint.longitude);
    return distance <= radiusKm;
  });
};

// Find rides visible to user based on location
const findVisibleRides = async (userLat, userLon, radiusKm = 50) => {
  const { Ride } = require('../models');
  
  const bbox = getBoundingBox(userLat, userLon, radiusKm);
  
  // Find rides where user is within radius of start location or waypoints
  const rides = await Ride.findAll({
    where: {
      status: 'upcoming',
      ride_date: { [Op.gte]: new Date() },
      [Op.or]: [
        // Within start location radius
        {
          [Op.and]: [
            { 'start_location.latitude': { [Op.between]: [bbox.minLat, bbox.maxLat] } },
            { 'start_location.longitude': { [Op.between]: [bbox.minLon, bbox.maxLon] } }
          ]
        },
        // Within waypoints radius (if waypoints exist)
        {
          waypoints: {
            [Op.contains]: [{
              latitude: { [Op.between]: [bbox.minLat, bbox.maxLat] },
              longitude: { [Op.between]: [bbox.minLon, bbox.maxLon] }
            }]
          }
        }
      ]
    },
    include: [
      {
        model: require('../models').User,
        as: 'creator',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ],
    order: [['ride_date', 'ASC']]
  });

  // Filter by exact distance and add distance field
  return rides.map(ride => {
    const startDistance = calculateDistance(
      userLat, userLon,
      ride.start_location.latitude,
      ride.start_location.longitude
    );

    let waypointDistance = Infinity;
    if (ride.waypoints && ride.waypoints.length > 0) {
      waypointDistance = Math.min(...ride.waypoints.map(wp => 
        calculateDistance(userLat, userLon, wp.latitude, wp.longitude)
      ));
    }

    const minDistance = Math.min(startDistance, waypointDistance);
    
    return {
      ...ride.toJSON(),
      distance_km: Math.round(minDistance * 10) / 10,
      distance_from: startDistance <= waypointDistance ? 'start' : 'waypoint'
    };
  }).filter(ride => ride.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
};

// Find nearby rentals
const findNearbyRentals = async (userLat, userLon, radiusKm = 50, filters = {}) => {
  const { Rental } = require('../models');
  
  const bbox = getBoundingBox(userLat, userLon, radiusKm);
  
  const whereClause = {
    is_available: true,
    status: 'active',
    [Op.and]: [
      { 'location.latitude': { [Op.between]: [bbox.minLat, bbox.maxLat] } },
      { 'location.longitude': { [Op.between]: [bbox.minLon, bbox.maxLon] } }
    ]
  };

  // Apply additional filters
  if (filters.category) whereClause.category = filters.category;
  if (filters.min_price) whereClause.price_per_day = { [Op.gte]: filters.min_price };
  if (filters.max_price) {
    whereClause.price_per_day = {
      ...whereClause.price_per_day,
      [Op.lte]: filters.max_price
    };
  }

  const rentals = await Rental.findAll({
    where: whereClause,
    include: [
      {
        model: require('../models').User,
        as: 'owner',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture', 'phone_number']
      }
    ],
    order: [['created_at', 'DESC']]
  });

  // Add distance and filter by exact radius
  return rentals.map(rental => {
    const distance = calculateDistance(
      userLat, userLon,
      rental.location.latitude,
      rental.location.longitude
    );

    return {
      ...rental.toJSON(),
      distance_km: Math.round(distance * 10) / 10
    };
  }).filter(rental => rental.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
};

// Find nearby groups
const findNearbyGroups = async (userLat, userLon, radiusKm = 50) => {
  const { Group } = require('../models');
  
  const bbox = getBoundingBox(userLat, userLon, radiusKm);
  
  const groups = await Group.findAll({
    where: {
      is_active: true,
      group_type: { [Op.in]: ['public', 'invite_only'] },
      location: {
        [Op.and]: [
          { latitude: { [Op.between]: [bbox.minLat, bbox.maxLat] } },
          { longitude: { [Op.between]: [bbox.minLon, bbox.maxLon] } }
        ]
      }
    },
    include: [
      {
        model: require('../models').User,
        as: 'admin',
        attributes: ['id', 'first_name', 'last_name', 'profile_picture']
      }
    ],
    order: [['created_at', 'DESC']]
  });

  // Add distance and filter by exact radius
  return groups.map(group => {
    const distance = calculateDistance(
      userLat, userLon,
      group.location.latitude,
      group.location.longitude
    );

    return {
      ...group.toJSON(),
      distance_km: Math.round(distance * 10) / 10
    };
  }).filter(group => group.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
};

// Get route suggestions (simplified - in production, use Google Maps API)
const getRouteSuggestions = (startLat, startLon, endLat, endLon) => {
  const distance = calculateDistance(startLat, startLon, endLat, endLon);
  const estimatedTime = distance / 50; // Assuming 50 km/h average speed
  
  return {
    distance_km: Math.round(distance * 10) / 10,
    estimated_duration_hours: Math.round(estimatedTime * 10) / 10,
    waypoints: [], // In production, get from maps API
    warnings: distance > 500 ? ['Long distance ride - ensure proper preparation'] : []
  };
};

// Check if location is safe (placeholder - integrate with crime/safety APIs)
const checkLocationSafety = async (latitude, longitude) => {
  // In production, integrate with local safety/crime databases
  return {
    safety_score: Math.random() * 5, // 0-5 scale
    warnings: [],
    recommendations: [
      'Share your location with emergency contacts',
      'Ride in groups when possible',
      'Avoid riding alone after dark'
    ]
  };
};

module.exports = {
  calculateDistance,
  findNearbyLocations,
  getBoundingBox,
  buildLocationWhereClause,
  isWithinWaypoints,
  findVisibleRides,
  findNearbyRentals,
  findNearbyGroups,
  getRouteSuggestions,
  checkLocationSafety
};