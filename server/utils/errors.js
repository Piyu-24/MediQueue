// Custom error classes with status codes

// Base error - all the others extend this
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// 400
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400);
    this.details = details;
  }
}

// 401
class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

// 403
class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
  }
}

// 404
class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

// 409
class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

// 429
class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', retryAfter = 60) {
    super(message, 429);
    this.retryAfter = retryAfter;
  }
}

// 500 - database problem
class DatabaseError extends AppError {
  constructor(message = 'Database operation failed', originalError = null) {
    super(message, 500);
    this.originalError = originalError;
  }
}

// 502 - another service failed
class ExternalServiceError extends AppError {
  constructor(message = 'External service error', service = null) {
    super(message, 502);
    this.service = service;
  }
}

// 422 - a business rule was broken
class BusinessLogicError extends AppError {
  constructor(message = 'Business logic error', code = null) {
    super(message, 422);
    this.code = code;
  }
}

// Helper to build the right error from a type string
class ErrorFactory {
  static createError(type, message, details = null) {
    switch (type.toLowerCase()) {
      case 'validation':
        return new ValidationError(message, details);
      case 'authentication':
        return new AuthenticationError(message);
      case 'authorization':
        return new AuthorizationError(message);
      case 'notfound':
      case 'not_found':
        return new NotFoundError(message);
      case 'conflict':
        return new ConflictError(message);
      case 'ratelimit':
      case 'rate_limit':
        return new RateLimitError(message, details);
      case 'database':
        return new DatabaseError(message, details);
      case 'external':
      case 'external_service':
        return new ExternalServiceError(message, details);
      case 'business':
      case 'business_logic':
        return new BusinessLogicError(message, details);
      default:
        return new AppError(message, 500);
    }
  }

  // Validation error with the list of field errors
  static createValidationError(fieldErrors) {
    const message = 'Validation failed';
    return new ValidationError(message, fieldErrors);
  }

  // Not-found error for a specific resource
  static createNotFoundError(resource, identifier = null) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    return new NotFoundError(message);
  }

  // Conflict error for a duplicate resource
  static createConflictError(resource, field, value) {
    const message = `${resource} with ${field} '${value}' already exists`;
    return new ConflictError(message);
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  ExternalServiceError,
  BusinessLogicError,
  ErrorFactory
};
