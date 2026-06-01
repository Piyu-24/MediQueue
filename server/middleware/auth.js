const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // No token at all → not authorized
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    // Validate that the extracted token is a non-empty string
    if (typeof token !== 'string' || token.trim() === '') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }

    let decoded;
    try {
      // Verify token — throws JsonWebTokenError or TokenExpiredError on failure
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired'
        });
      }
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }
      // Any other JWT-related error
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    // Valid signature — look up the user
    let user;
    try {
      user = await User.findById(decoded.id);
    } catch (dbError) {
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account has been deactivated'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    // Outer catch: handles truly unexpected errors (e.g. DB failure, malformed header)
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

module.exports = auth;