// Base class with shared service helpers

const EventEmitter = require('events');
const Logger = require('../utils/Logger');

class BaseService extends EventEmitter {
  constructor(repository = null, logger = null) {
    super();
    
    if (this.constructor === BaseService) {
      throw new Error('BaseService is abstract and cannot be instantiated directly');
    }
    
    this.repository = repository;
    this.logger = logger || Logger.getLogger(this.constructor.name);
  }

  // Log a service error and return it
  handleServiceError(error) {
    this.logger.error('Service error:', {
      error: error.message,
      stack: error.stack,
      service: this.constructor.name
    });

    // Emit error event for observers
    this.emit('error', error);

    return error;
  }

  // Check the data against a simple field-rules schema
  validateInput(data, schema) {
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      
      if (rules.required && (value === undefined || value === null || value === '')) {
        throw new Error(`${field} is required`);
      }
      
      if (rules.type && value !== undefined && typeof value !== rules.type) {
        throw new Error(`${field} must be of type ${rules.type}`);
      }
    }
    
    return true;
  }

  // Log a business event and emit it for listeners
  logBusinessEvent(event, data = {}) {
    this.logger.info(`Business event: ${event}`, {
      event,
      service: this.constructor.name,
      ...data
    });

    // Emit business event for observers
    this.emit('businessEvent', { event, data });
  }

  // Child classes must implement this
  getResourceName() {
    throw new Error('getResourceName() must be implemented by child class');
  }
}

module.exports = BaseService;
