export const convertRideFormData = (req, res, next) => {
  try {
    // Skip conversion if not multipart/form-data
    if (!req.file && Object.keys(req.body).length === 0) {
      return next();
    }

    console.log('Converting FormData types for ride:', req.body);

    // Convert numeric fields from strings to numbers
    const numericFields = {
      'max_participants': 'int',
      'price': 'float',
      'distance_km': 'float',
      'estimated_duration_hours': 'float'
    };

    Object.entries(numericFields).forEach(([field, type]) => {
      if (req.body[field] !== undefined) {
        if (req.body[field] === '' || req.body[field] === null) {
          // Remove empty strings and null values
          delete req.body[field];
        } else {
          const num = type === 'int' ? parseInt(req.body[field]) : parseFloat(req.body[field]);
          if (!isNaN(num)) {
            req.body[field] = num;
          }
        }
      }
    });

    // Convert boolean fields
    const booleanFields = ['is_paid'];
    booleanFields.forEach(field => {
      if (req.body[field] !== undefined) {
        req.body[field] = req.body[field] === 'true' || req.body[field] === true;
      }
    });

    // Parse JSON fields that come as strings from FormData
    const jsonFields = [
      'start_location', 
      'end_location', 
      'waypoints', 
      'requirements', 
      'emergency_contacts', 
      'amenities', 
      'pricing_options'
    ];
    
    jsonFields.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch (error) {
          console.error(`Error parsing ${field}:`, error.message);
          return res.status(400).json({
            status: 'error',
            message: `Invalid ${field} format`,
            field: field
          });
        }
      }
    });

    // Convert nested numeric values in pricing_options
    if (req.body.pricing_options && typeof req.body.pricing_options === 'object') {
      ['with_bike', 'without_bike'].forEach(key => {
        if (req.body.pricing_options[key] !== undefined) {
          if (req.body.pricing_options[key] === '' || req.body.pricing_options[key] === null) {
            delete req.body.pricing_options[key];
          } else {
            const num = parseFloat(req.body.pricing_options[key]);
            if (!isNaN(num)) {
              req.body.pricing_options[key] = num;
            }
          }
        }
      });
    }

    // Convert nested numeric values in requirements
    if (req.body.requirements && typeof req.body.requirements === 'object') {
      ['min_age', 'max_age'].forEach(key => {
        if (req.body.requirements[key] !== undefined) {
          if (req.body.requirements[key] === '' || req.body.requirements[key] === null) {
            req.body.requirements[key] = null;
          } else {
            const num = parseInt(req.body.requirements[key]);
            if (!isNaN(num)) {
              req.body.requirements[key] = num;
            }
          }
        }
      });

      // Handle boolean fields in requirements
      const reqBooleanFields = ['license_required', 'helmet_required', 'insurance_required'];
      reqBooleanFields.forEach(field => {
        if (req.body.requirements[field] !== undefined) {
          req.body.requirements[field] = req.body.requirements[field] === 'true' || req.body.requirements[field] === true;
        }
      });
    }

    // Convert group_id to null if empty string
    if (req.body.group_id === '' || req.body.group_id === 'null') {
      req.body.group_id = null;
    }

    // Remove the UI-only field that shouldn't go to backend
    if (req.body.selected_group_name) {
      delete req.body.selected_group_name;
    }

    console.log('Converted FormData:', req.body);
    next();

  } catch (error) {
    console.error('Error in convertRideFormData middleware:', error);
    return res.status(400).json({
      status: 'error',
      message: 'Invalid form data format',
      error: error.message
    });
  }
};