// Base class with shared controller helpers

const ResponseFormatter = require('../utils/ResponseFormatter');
const Logger = require('../utils/Logger');

class BaseController {
  constructor(service = null, logger = null) {
    if (this.constructor === BaseController) {
      throw new Error('BaseController is abstract and cannot be instantiated directly');
    }
    
    this.service = service;
    this.logger = logger || Logger.getLogger(this.constructor.name);
    this.responseFormatter = new ResponseFormatter();
  }

  // Run an async handler and catch any error
  async handleAsync(operation, req, res) {
    try {
      await operation(req, res);
    } catch (error) {
      this.handleError(error, req, res);
    }
  }

  // Log the error and send an error response
  handleError(error, req, res) {
    this.logger.error('Controller error:', {
      error: error.message,
      stack: error.stack,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.id
    });

    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal server error';
    
    res.status(statusCode).json(
      this.responseFormatter.error(message, error.details)
    );
  }

  // Send a 200 success response
  sendSuccess(res, data = null, message = 'Success', meta = {}) {
    res.json(this.responseFormatter.success(data, message, meta));
  }

  // Send a 201 created response
  sendCreated(res, data, message = 'Resource created successfully', location = null) {
    res.status(201).json(this.responseFormatter.created(data, message, location));
  }

  // Send a 204 no-content response
  sendNoContent(res, message = 'No content') {
    res.status(204).json(this.responseFormatter.noContent(message));
  }

  // Pick out the allowed filters from the query string
  buildFilters(req, allowedFilters = []) {
    const filters = {};
    
    allowedFilters.forEach(key => {
      if (req.query[key] !== undefined && req.query[key] !== '') {
        filters[key] = req.query[key];
      }
    });
    
    return filters;
  }

  // Build pagination/sort options from the query string
  buildPaginationOptions(req) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder || 'desc';
    
    return {
      page,
      limit,
      skip: (page - 1) * limit,
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
    };
  }

  // Throw if any required body field is missing
  validateRequiredFields(req, requiredFields) {
    const missingFields = requiredFields.filter(field => 
      req.body[field] === undefined || req.body[field] === null || req.body[field] === ''
    );
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
  }

  // Log a controller action
  logAction(action, req, metadata = {}) {
    this.logger.info(`Controller action: ${action}`, {
      action,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.id,
      userRole: req.user?.role,
      ...metadata
    });
  }

  // Child classes must implement this
  getResourceName() {
    throw new Error('getResourceName() must be implemented by child class');
  }
}

module.exports = BaseController;
