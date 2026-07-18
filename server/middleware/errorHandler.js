/**
 * @fileoverview Enhanced Error Handler Middleware
 * @author MediQueue Development Team
 * @version 1.0.0
 */

const Logger = require('../utils/Logger');
const ResponseFormatter = require('../utils/ResponseFormatter');
const { redactSensitive } = require('../utils/redact');
const { 
  AppError, 
  ValidationError, 
  AuthenticationError, 
  AuthorizationError, 
  NotFoundError,
  ConflictError
} = require('../utils/errors');

/**
 * Enhanced error handler middleware with comprehensive error handling
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  const logger = Logger.getLogger('ErrorHandler');
  const responseFormatter = new ResponseFormatter();
  
  // Generate unique error ID for tracking
  const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log error immediately to console for Vercel visibility
  console.error(`ERROR [${errorId}]:`, err.message);
  console.error('Stack:', err.stack);
  console.error('Request:', req.method, req.path); // path only — omit query/token
  
  // Log error with context — sensitive fields (passwords, tokens, PHI) are
  // redacted so they never land in application logs.
  logger.error('Application error occurred:', {
    errorId,
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    userId: req.user?.id,
    userRole: req.user?.role,
    body: req.method !== 'GET' ? redactSensitive(req.body) : undefined,
    query: redactSensitive(req.query),
    params: redactSensitive(req.params)
  });
  
  let error = err;
  
  // Convert known error types to AppError instances
  if (!(error instanceof AppError)) {
    // Handle Mongoose errors
    if (err.name === 'CastError') {
      error = new ValidationError(`Invalid ${err.path}: ${err.value}`);
    }
    else if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      error = new ConflictError(`Duplicate ${field} already exists`);
    }
    else if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => ({
        field: e.path,
        message: e.message,
        value: e.value
      }));
      error = new ValidationError('Validation failed', errors);
    }
    else {
      error = new AppError(
        process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : err.message,
        err.statusCode || 500
      );
    }
  }
  
  // Prepare response
  let response;
  if (error instanceof ValidationError) {
    response = responseFormatter.validationError(error.details, error.message);
  }
  else if (error instanceof AuthenticationError) {
    response = responseFormatter.authenticationError(error.message);
  }
  else if (error instanceof AuthorizationError) {
    response = responseFormatter.authorizationError(error.message);
  }
  else if (error instanceof NotFoundError) {
    response = responseFormatter.notFound('Resource', error.message);
  }
  else if (error instanceof ConflictError) {
    response = responseFormatter.conflict(error.message);
  }
  else {
    response = responseFormatter.serverError(error.message, errorId);
  }
  
  // Add error ID and development info
  response.errorId = errorId;
  if (process.env.NODE_ENV === 'development') {
    response.stack = error.stack;
  }
  
  res.status(error.statusCode || 500).json(response);
};

module.exports = errorHandler;