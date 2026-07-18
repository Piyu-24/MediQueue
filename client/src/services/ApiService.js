// One place for all the HTTP calls (single axios instance)

import axios from 'axios';

class ApiService {
  static instance = null;

  constructor() {
    if (ApiService.instance) {
      return ApiService.instance;
    }

    this.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
    this.timeout = 30000; // 30 seconds
    
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.setupInterceptors();
    ApiService.instance = this;
  }

  // Get the single shared instance
  static getInstance() {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  // Add auth token to requests and handle common errors on responses
  setupInterceptors() {
    // Request: attach the token and note the start time
    this.axiosInstance.interceptors.request.use(
      (config) => {
        const token = sessionStorage.getItem('token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        config.metadata = { startTime: new Date() };

        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response: log timing in dev, handle common errors
    this.axiosInstance.interceptors.response.use(
      (response) => {
        const duration = new Date() - response.config.metadata.startTime;

        if (process.env.NODE_ENV === 'development') {
          console.log(`API Call: ${response.config.method?.toUpperCase()} ${response.config.url} - ${duration}ms`);
        }

        return response;
      },
      (error) => {
        if (error.response?.status === 401) {
          // Not logged in - send them to login
          sessionStorage.removeItem('token');
          window.location.href = '/login';
        } else if (error.response?.status === 403) {
          console.error('Access denied');
        } else if (error.response?.status >= 500) {
          console.error('Server error occurred');
        }

        return Promise.reject(error);
      }
    );
  }

  // GET request
  async get(endpoint, params = {}, config = {}) {
    try {
      const response = await this.axiosInstance.get(endpoint, {
        params,
        ...config
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // POST request
  async post(endpoint, data = {}, config = {}) {
    try {
      const response = await this.axiosInstance.post(endpoint, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // PUT request
  async put(endpoint, data = {}, config = {}) {
    try {
      const response = await this.axiosInstance.put(endpoint, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // DELETE request
  async delete(endpoint, config = {}) {
    try {
      const response = await this.axiosInstance.delete(endpoint, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // Upload a file
  async uploadFile(endpoint, formData, onUploadProgress = null) {
    try {
      const response = await this.axiosInstance.post(endpoint, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // Download a file and save it
  async downloadFile(endpoint, filename) {
    try {
      const response = await this.axiosInstance.get(endpoint, {
        responseType: 'blob'
      });

      // Make a temporary link and click it to trigger the download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // Turn an axios error into a simpler Error object
  handleError(error) {
    if (error.response) {
      // Server replied with an error status
      const { status, data } = error.response;
      const message = data?.message || data?.error || `HTTP ${status} Error`;

      const apiError = new Error(message);
      apiError.status = status;
      apiError.data = data;
      apiError.type = 'API_ERROR';

      return apiError;
    } else if (error.request) {
      // No response came back
      const networkError = new Error('Network error - please check your connection');
      networkError.type = 'NETWORK_ERROR';
      return networkError;
    } else {
      const genericError = new Error(error.message || 'Unknown error occurred');
      genericError.type = 'GENERIC_ERROR';
      return genericError;
    }
  }

  // Save or clear the auth token
  setAuthToken(token) {
    if (token) {
      sessionStorage.setItem('token', token);
      this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      sessionStorage.removeItem('token');
      delete this.axiosInstance.defaults.headers.common['Authorization'];
    }
  }

  // Get the current token
  getAuthToken() {
    return sessionStorage.getItem('token');
  }

  // Clear the token
  clearAuthToken() {
    this.setAuthToken(null);
  }

  // True if we have a token
  isAuthenticated() {
    return !!this.getAuthToken();
  }

  // Check if the API is reachable
  async getHealthStatus() {
    try {
      const response = await this.get('/health');
      return {
        api: 'healthy',
        baseURL: this.baseURL,
        authenticated: this.isAuthenticated(),
        ...response
      };
    } catch (error) {
      return {
        api: 'unhealthy',
        baseURL: this.baseURL,
        authenticated: this.isAuthenticated(),
        error: error.message
      };
    }
  }
}

export default ApiService;
