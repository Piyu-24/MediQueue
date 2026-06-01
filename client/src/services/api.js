import axios from 'axios';
import { toast } from 'react-hot-toast';

// Create axios instance
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const response = await axios.post(
            `${process.env.REACT_APP_API_URL}/auth/refresh`,
            { refreshToken }
          );

          if (response.data.success) {
            const { token, refreshToken: newRefreshToken } = response.data.data;
            localStorage.setItem('token', token);
            localStorage.setItem('refreshToken', newRefreshToken);
            
            // Retry original request
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          }
        }
      } catch (refreshError) {
        // Refresh failed, redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// Auth API endpoints
export const authAPI = {
  register: (userData) => api.post('/auth/register', userData),
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  forgotPassword: (email) => api.post('/auth/forgot-password', email),
  resetPassword: (token, password) => api.put(`/auth/reset-password/${token}`, password),
  verifyEmail: (token) => api.get(`/auth/verify-email/${token}`),
  refreshToken: (refreshToken) => api.post('/auth/refresh', { refreshToken }),
};

// User API endpoints
export const userAPI = {
  getProfile: () => api.get('/users/profile'),
  getUserProfile: (userId) => api.get(`/users/${userId}/profile`),
  updateProfile: (userId, userData) => api.put(`/users/${userId}/profile`, userData),
  uploadAvatar: (formData) => api.post('/users/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getDoctors: (params) => api.get('/users/doctors', { params }),
  getDoctorById: (id) => api.get(`/users/doctors/${id}`),
  searchUsers: (query) => api.get(`/users/search`, { params: { q: query } }),
};

// Appointment API endpoints
export const appointmentAPI = {
  getAppointments: (params) => api.get('/appointments', { params }),
  getAppointmentById: (id) => api.get(`/appointments/${id}`),
  createAppointment: (appointmentData) => api.post('/appointments', appointmentData),
  updateAppointment: (id, appointmentData) => api.put(`/appointments/${id}`, appointmentData),
  cancelAppointment: (id, reason) => api.delete(`/appointments/${id}`, { data: { reason } }),
  checkAvailability: (doctorId, date) => api.get(`/appointments/availability/${doctorId}`, { 
    params: { date } 
  }),
  updateStatus: (id, status) => api.patch(`/appointments/${id}/status`, { status }),
  checkIn: (id, method) => api.post(`/appointments/${id}/checkin`, { method }),
  getDoctorAppointments: (doctorId, params) => api.get(`/appointments/doctor/${doctorId}`, { params }),
  getPatientAppointments: (patientId, params) => api.get(`/appointments/patient/${patientId}`, { params }),
  getPendingReschedule: () => api.get('/appointments/pending-reschedule')
};

// Doctor leave API endpoints
export const leaveAPI = {
  submitLeave: (leaveData, params) => api.post('/doctor/leave', leaveData, { params }),
  getLeaves: (params) => api.get('/doctor/leave', { params }),
  cancelLeave: (slotId) => api.delete(`/doctor/leave/${slotId}`)
};

// Medical Records API endpoints
export const medicalRecordsAPI = {
  getRecords: (patientId) => api.get(`/medical-records`, { params: { patientId } }),
  createRecord: (recordData) => api.post('/medical-records', recordData),
  updateRecord: (id, recordData) => api.put(`/medical-records/${id}`, recordData),
  deleteRecord: (id) => api.delete(`/medical-records/${id}`),
  uploadDocument: (recordId, formData) => api.post(`/medical-records/${recordId}/document`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  downloadDocument: (recordId, documentId) => api.get(`/medical-records/${recordId}/document/${documentId}`, {
  }),
};

// Health Card API endpoints
export const healthCardAPI = {
  createHealthCard: (cardData) => api.post('/health-cards', cardData),
  getPatientCard: (patientId) => api.get(`/health-cards/patient/${patientId}`),
  updatePatientCard: (patientId, updateData) => api.put(`/health-cards/patient/${patientId}`, updateData),
  validateCard: (validationData) => api.post('/health-cards/validate', validationData),
  updateCard: (cardId, updateData) => api.put(`/health-cards/${cardId}`, updateData),
  getAccessLog: (cardId) => api.get(`/health-cards/${cardId}/access-log`),
  getAllCards: (params) => api.get('/health-cards', { params }),
};
// Queue API endpoints
export const queueAPI = {
  /** Receptionist checks a patient in — creates QueueEntry */
  checkIn: (data) => api.post('/queue/checkin', data),
  /** Validate a QR code / health card and get patient + today's appointment */
  validateQR: (data) => api.post('/queue/validate-qr', data),
  /** Get full queue list with optional filters */
  getQueue: (params) => api.get('/queue', { params }),
  /** Get public display data (no auth) — all rooms */
  getDisplay: (date) => api.get('/queue/display', { params: { date } }),
  /** Get the current patient's own queue status */
  getMyStatus: () => api.get('/queue/my-status'),
  /** Get queue stats for admin/manager */
  getStats: (date) => api.get('/queue/stats', { params: { date } }),
  /** Doctor: call a waiting patient */
  callPatient: (id) => api.patch(`/queue/${id}/call`),
  /** Doctor: start consultation */
  startConsultation: (id) => api.patch(`/queue/${id}/start`),
  /** Doctor: complete consultation */
  completeConsultation: (id) => api.patch(`/queue/${id}/complete`),
  /** Doctor/Receptionist: mark no-show */
  markNoShow: (id) => api.patch(`/queue/${id}/no-show`),
};

// Document API endpoints
export const documentAPI = {
  uploadDocument: (formData) => api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getPatientDocuments: (patientId, params) => api.get(`/documents/patient/${patientId}`, { params }),
  getDocument: (documentId) => api.get(`/documents/${documentId}`),
  downloadDocument: (documentId) => api.get(`/documents/${documentId}/download`, {
    responseType: 'blob'
  }),
  shareDocument: (documentId, shareData) => api.post(`/documents/${documentId}/share`, shareData),
  deleteDocument: (documentId) => api.delete(`/documents/${documentId}`),
  getDocumentTypes: () => api.get('/documents/meta/types'),
};


// Report API endpoints
export const reportAPI = {
  getDashboardStats: () => api.get('/reports/dashboard'),
  getAppointmentReports: (params) => api.get('/reports/appointments', { params }),
  getUserReports: (params) => api.get('/reports/users', { params }),
  getDepartmentReports: (params) => api.get('/reports/departments', { params }),
  exportReport: (type, params) => api.get(`/reports/export/${type}`, { 
    params, 
    responseType: 'blob' 
  }),
};

// Alias for backward compatibility
export const reportsAPI = reportAPI;

// Notification API endpoints
export const notificationAPI = {
  getNotifications: () => api.get('/notifications'),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markAsRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllAsRead: () => api.patch('/notifications/read-all'),
  deleteNotification: (id) => api.delete(`/notifications/${id}`),
  updatePreferences: (preferences) => api.put('/notifications/preferences', preferences),
};

// Chatbot API endpoints // NEW
export const chatbotAPI = {
  sendMessage: (messageData) => api.post('/chatbot/message', messageData),
  getChatHistory: () => api.get('/chatbot/history'),
  getHealthTips: (category) => api.get(`/chatbot/health-tips/${category}`),
  getSymptomInfo: (symptom) => api.get(`/chatbot/symptom/${symptom}`),
  checkEmergency: (messageData) => api.post('/chatbot/emergency-check', messageData),
};

// Utility function to handle API errors
export const handleApiError = (error) => {
  if (error.response?.data?.message) {
    toast.error(error.response.data.message);
  } else if (error.message) {
    toast.error(error.message);
  } else {
    toast.error('An unexpected error occurred');
  }
  
  console.error('API Error:', error);
  return error;
};

export default api;