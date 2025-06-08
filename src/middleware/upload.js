const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/temp');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = process.env.ALLOWED_IMAGE_TYPES?.split(',') || ['jpg', 'jpeg', 'png', 'webp'];
  const fileExt = path.extname(file.originalname).toLowerCase().slice(1);
  
  if (file.fieldname === 'images' || file.fieldname === 'cover_image' || 
      file.fieldname === 'profile_picture' || file.fieldname === 'cover_picture') {
    // Image files
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`), false);
    }
  } else if (file.fieldname === 'attachment') {
    // Chat attachments - allow more file types
    const allowedAttachmentTypes = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'txt'];
    if (allowedAttachmentTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid attachment type. Allowed types: ${allowedAttachmentTypes.join(', ')}`), false);
    }
  } else {
    cb(new Error('Invalid field name'), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
    files: 10 // Maximum 10 files
  }
});

// Upload configurations for different endpoints
const uploadConfigs = {
  // Single image upload
  single: (fieldName) => upload.single(fieldName),
  
  // Multiple images upload (for rentals, rides)
  multiple: (fieldName, maxCount = 5) => upload.array(fieldName, maxCount),
  
  // Profile update (profile and cover picture)
  profile: upload.fields([
    { name: 'profile_picture', maxCount: 1 },
    { name: 'cover_picture', maxCount: 1 }
  ]),
  
  // Rental images
  rental: upload.array('images', 10),
  
  // Ride cover image
  rideCover: upload.single('cover_image'),
  
  // Group cover image
  groupCover: upload.single('cover_image'),
  
  // Chat attachment
  chatAttachment: upload.single('attachment')
};

// Error handler for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    let message = 'File upload error';
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File too large';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field';
        break;
      default:
        message = error.message;
    }
    
    return res.status(400).json({
      status: 'error',
      message,
      code: error.code
    });
  }
  
  if (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
  
  next();
};

// Cleanup temporary files middleware
const cleanupTempFiles = (req, res, next) => {
  const fs = require('fs');
  
  // Store original end function
  const originalEnd = res.end;
  
  // Override end function to cleanup files
  res.end = function(...args) {
    // Clean up uploaded files if they exist
    const filesToCleanup = [];
    
    if (req.file) {
      filesToCleanup.push(req.file.path);
    }
    
    if (req.files) {
      if (Array.isArray(req.files)) {
        filesToCleanup.push(...req.files.map(file => file.path));
      } else {
        Object.values(req.files).forEach(fileArray => {
          if (Array.isArray(fileArray)) {
            filesToCleanup.push(...fileArray.map(file => file.path));
          }
        });
      }
    }
    
    // Cleanup files after response
    setImmediate(() => {
      filesToCleanup.forEach(filePath => {
        fs.unlink(filePath, (err) => {
          if (err && err.code !== 'ENOENT') {
            console.error('Error cleaning up temp file:', err);
          }
        });
      });
    });
    
    // Call original end function
    originalEnd.apply(this, args);
  };
  
  next();
};

module.exports = {
  upload,
  uploadConfigs,
  handleUploadError,
  cleanupTempFiles
};