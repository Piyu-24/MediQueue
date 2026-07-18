// Hook to grab a service from the ServiceFactory

import { useEffect, useState } from 'react';
import ServiceFactory from '../services/ServiceFactory';

export const useService = (serviceName) => {
  const [service, setService] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const serviceInstance = ServiceFactory.getService(serviceName);
      setService(serviceInstance);
      setError(null);
    } catch (err) {
      setError(err.message);
      setService(null);
    }
  }, [serviceName]);

  if (error) {
    throw new Error(`Failed to get service '${serviceName}': ${error}`);
  }

  return service;
};

export default useService;
