// Creates and hands out the frontend service instances

import ApiService from './ApiService';
import PatientService from './PatientService';

class ServiceFactory {
  static instances = new Map();
  static initialized = false;

  // Set up the services once
  static initialize() {
    if (this.initialized) return;

    this.instances.set('api', ApiService.getInstance());
    this.instances.set('patient', new PatientService());

    this.initialized = true;
  }

  // Get a service by name
  static getService(serviceName) {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.instances.has(serviceName)) {
      throw new Error(`Service '${serviceName}' not found. Available services: ${Array.from(this.instances.keys()).join(', ')}`);
    }

    return this.instances.get(serviceName);
  }

  // Add a service
  static registerService(serviceName, serviceInstance) {
    this.instances.set(serviceName, serviceInstance);
  }

  // List the service names
  static getAvailableServices() {
    if (!this.initialized) {
      this.initialize();
    }
    return Array.from(this.instances.keys());
  }

  // Collect health info from every service
  static async getHealthStatus() {
    if (!this.initialized) {
      this.initialize();
    }

    const status = {
      healthy: true,
      services: {},
      timestamp: new Date().toISOString()
    };

    for (const [name, service] of this.instances.entries()) {
      try {
        if (typeof service.getHealthStatus === 'function') {
          status.services[name] = await service.getHealthStatus();
        } else {
          status.services[name] = { status: 'unknown', message: 'Health check not implemented' };
        }
      } catch (error) {
        status.services[name] = { status: 'unhealthy', error: error.message };
        status.healthy = false;
      }
    }

    return status;
  }

  // Clear the cache on every service
  static clearAllCaches() {
    for (const service of this.instances.values()) {
      if (typeof service.clearCache === 'function') {
        service.clearCache();
      }
    }
  }

  // Reset everything (handy in tests)
  static reset() {
    this.instances.clear();
    this.initialized = false;
  }
}

export default ServiceFactory;
