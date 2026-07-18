// Base class for the frontend services (caching, events, error handling)
class BaseService {
  constructor(apiService) {
    if (this.constructor === BaseService) {
      throw new Error('BaseService is abstract and cannot be instantiated directly');
    }
    
    this.api = apiService;
    this.cache = new Map();
    this.subscribers = new Set();
  }

  // Run an API call with optional caching and shared error handling
  async handleApiCall(apiCall, cacheKey = null, options = {}) {
    const { useCache = false, cacheTTL = 300000 } = options; // 5 minutes default TTL

    // Check cache first
    if (useCache && cacheKey && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
      }
    }

    try {
      const response = await apiCall();
      const data = response?.data || response;

      // Cache the result
      if (useCache && cacheKey) {
        this.cache.set(cacheKey, {
          data,
          timestamp: Date.now()
        });
      }

      // Notify subscribers
      this.notifySubscribers('data_updated', { cacheKey, data });

      return data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // Log an error and tell subscribers about it
  handleError(error) {
    console.error(`${this.constructor.name} Error:`, error);
    this.notifySubscribers('error', { error });
  }

  // Subscribe to service events; returns a function to unsubscribe
  subscribe(callback) {
    this.subscribers.add(callback);

    return () => {
      this.subscribers.delete(callback);
    };
  }

  // Call every subscriber with an event
  notifySubscribers(event, data) {
    this.subscribers.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Subscriber callback error:', error);
      }
    });
  }

  // Clear one cache key, or the whole cache
  clearCache(key = null) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  // Get cached data for a key (or null)
  getCachedData(key) {
    const cached = this.cache.get(key);
    return cached ? cached.data : null;
  }

  // Simple field-rules validation
  validateData(data, schema) {
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      
      if (rules.required && (value === undefined || value === null || value === '')) {
        throw new Error(`${field} is required`);
      }
      
      if (rules.type && value !== undefined && typeof value !== rules.type) {
        throw new Error(`${field} must be of type ${rules.type}`);
      }
      
      if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
        throw new Error(`${field} must be at least ${rules.minLength} characters`);
      }
      
      if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
        throw new Error(`${field} must be no more than ${rules.maxLength} characters`);
      }
    }
    
    return true;
  }

  // Child classes can override these to reshape data
  transformForApi(data) {
    return data;
  }

  transformFromApi(data) {
    return data;
  }

  // Child classes must implement this
  getServiceName() {
    throw new Error('getServiceName() must be implemented by child class');
  }

  // Basic health info for this service
  getHealthStatus() {
    return {
      serviceName: this.getServiceName(),
      healthy: true,
      cacheSize: this.cache.size,
      subscriberCount: this.subscribers.size,
      timestamp: new Date().toISOString()
    };
  }
}

export default BaseService;
