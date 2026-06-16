import axios from 'axios';
import { toast } from 'react-hot-toast';

// Token helpers — use sessionStorage (tab-scoped, not persisted across sessions)
// Refresh token is stored as httpOnly cookie set by the server.
export const tokenStorage = {
  getToken: () => sessionStorage.getItem('token'),
  setToken: (t) => sessionStorage.setItem('token', t),
  clearToken: () => sessionStorage.removeItem('token'),
};

// Create axios instance
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // sends httpOnly refresh-token cookie automatically
});

// Request interceptor — attach access token from sessionStorage
api.interceptors.request.use(
  (config) => {
    const token = tokenStorage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — silent token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // withCredentials sends the httpOnly refreshToken cookie automatically
        const response = await axios.post(
          `${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/auth/refresh`,
          {},
          { withCredentials: true }
        );

        if (response.data.success) {
          const { token } = response.data.data;
          tokenStorage.setToken(token);
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        }
      } catch {
        tokenStorage.clearToken();
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
  refreshToken: () => api.post('/auth/refresh'),
  reAuthenticate: (password) => api.post('/auth/re-authenticate', { password }),
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
  searchUsers: (query, params) => api.get('/users/search', { params: { q: query || '', ...params } }),
};

// Admin API endpoints
export const adminAPI = {
  toggleUserStatus: (userId) => api.patch(`/users/${userId}/toggle-status`),
};

// Manager/Health-monitoring API endpoints (now accessible to admin too)
export const managerAPI = {
  getDashboardOverview: () => api.get('/manager/dashboard/overview'),
  getPatientVisitReport: (params) => api.get('/manager/reports/patient-visits', { params }),
  getStaffUtilizationReport: (params) => api.get('/manager/reports/staff-utilization', { params }),
};

// Doctor API endpoints
export const doctorAPI = {
  updateAvailability: (availability) => api.put('/doctor/availability', availability),
};

// Appointment API endpoints
export const appointmentAPI = {
  getAppointments: (params) => api.get('/appointments', { params }),
  getAppointmentById: (id) => api.get(`/appointments/${id}`),
  createAppointment: (appointmentData) => api.post('/appointments', appointmentData),
  updateAppointment: (id, appointmentData) => api.put(`/appointments/${id}`, appointmentData),
  cancelAppointment: (id, reason) => api.delete(`/appointments/${id}`, { data: { reason } }),
  checkAvailability: (doctorId, date) => api.get(`/appointments/availability/${doctorId}`, { params: { date } }),
  // Slot-based availability (specialist booking)
  getSlotAvailability: (doctorId, date, patientId) =>
    api.get('/appointments/availability', { params: { doctorId, date, patientId } }),
  // Block-based availability (General OPD booking)
  getBlockAvailability: (departmentId, date, doctorId) =>
    api.get('/appointments/availability', { params: { departmentId, date, doctorId, blockBased: 'true' } }),
  getAvailableDoctors: (date, departmentId, patientId) =>
    api.get('/appointments/doctors/available', { params: { date, departmentId, patientId } }),
  updateStatus: (id, status) => api.patch(`/appointments/${id}/status`, { status }),
  checkIn: (id, method) => api.post(`/appointments/${id}/checkin`, { method }),
  getDoctorAppointments: (doctorId, params) => api.get(`/appointments/doctor/${doctorId}`, { params }),
  getPatientAppointments: (patientId, params) => api.get(`/appointments/patient/${patientId}`, { params }),
  getPendingReschedule: () => api.get('/appointments/pending-reschedule'),
};

// Department API endpoints
export const departmentAPI = {
  getDepartments: (params) => api.get('/departments', { params }),
  getDepartmentById: (id) => api.get(`/departments/${id}`),
  createDepartment: (data) => api.post('/departments', data),
  updateDepartment: (id, data) => api.patch(`/departments/${id}`, data),
};

// Time Block API endpoints
export const timeBlockAPI = {
  getBlocks: (params) => api.get('/time-blocks', { params }),
  getBlockById: (id) => api.get(`/time-blocks/${id}`),
  createBlock: (data) => api.post('/time-blocks', data),
  generateBlocks: (data) => api.post('/time-blocks/generate', data),
  updateBlock: (id, data) => api.patch(`/time-blocks/${id}`, data),
  deleteBlock: (id) => api.delete(`/time-blocks/${id}`),
};

// Reception API endpoints
export const receptionAPI = {
  searchPatients: (q, by = 'all', date) =>
    api.get('/reception/patients/search', { params: { q, by, date } }),
  registerPatient: (data) => api.post('/reception/patients', data),
  searchAppointments: (params) => api.get('/reception/appointments/search', { params }),
  checkInAppointment: (appointmentId, data) => api.post(`/reception/check-in/${appointmentId}`, data),
  walkIn: (data) => api.post('/reception/walk-in', data),
  assignDoctor: (data) => api.post('/reception/assign-doctor', data),
  markNoShow: (id, reason) => api.patch(`/reception/queue/${id}/no-show`, { reason }),
  markTemporarilyAway: (id) => api.patch(`/reception/queue/${id}/temporarily-away`),
  markReturned: (id) => api.patch(`/reception/queue/${id}/returned`),
  markLate: (id, reason) => api.patch(`/reception/queue/${id}/late`, { reason }),
  generateHealthCard: (patientId) => api.post(`/reception/health-card/${patientId}/generate`),
  printHealthCard: (patientId) => api.post(`/reception/health-card/${patientId}/print`),
  getTodayQueue: (params) => api.get('/reception/queue/today', { params }),
  getAvailableDoctors: (params) => api.get('/reception/doctors/available', { params }),
};

// Notification API endpoints
export const notificationAPI = {
  getNotifications: (params) => api.get('/notifications', { params }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markAsRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllAsRead: () => api.patch('/notifications/read-all'),
  deleteNotification: (id) => api.delete(`/notifications/${id}`),
  updatePreferences: (preferences) => api.put('/notifications/preferences', preferences),
};

// Doctor leave API endpoints
export const leaveAPI = {
  submitLeave: (leaveData, params) => api.post('/doctor/leave', leaveData, { params }),
  getLeaves: (params) => api.get('/doctor/leave', { params }),
  cancelLeave: (slotId) => api.delete(`/doctor/leave/${slotId}`)
};

// Medical Records API endpoints
export const medicalRecordsAPI = {
  getRecords: (patientId) => api.get('/medical-records', { params: { patientId } }),
  createRecord: (recordData) => api.post('/medical-records', recordData),
  updateRecord: (id, recordData) => api.put(`/medical-records/${id}`, recordData),
  deleteRecord: (id) => api.delete(`/medical-records/${id}`),
  uploadDocument: (recordId, formData) => api.post(`/medical-records/${recordId}/document`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  downloadDocument: (recordId, documentId) => api.get(`/medical-records/${recordId}/document/${documentId}`),
};

// Prescription API endpoints
export const prescriptionAPI = {
  getPatientPrescriptions: (patientId) => api.get(`/prescriptions/patient/${patientId}`),
  getPrescription: (id) => api.get(`/prescriptions/${id}`),
  createPrescription: (data) => api.post('/prescriptions', data),
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
  checkIn: (data) => api.post('/queue/checkin', data),
  validateQR: (data) => api.post('/queue/validate-qr', data),
  getCheckInEligibility: (appointmentId, patientId) =>
    api.get(`/check-in/eligibility/${appointmentId}`, { params: { patientId } }),
  checkInAppointment: (data) => api.post('/check-in/appointment', data),
  checkInWalkIn: (data) => api.post('/check-in/walk-in', data),
  getQueue: (params) => api.get('/queue', { params }),
  getActiveQueue: (doctorId, date) =>
    api.get(`/queue/doctors/${doctorId}/active`, { params: { date } }),
  getDisplay: (date) => api.get('/queue/display', { params: { date } }),
  getMyStatus: () => api.get('/queue/my-status'),
  getStats: (date) => api.get('/queue/stats', { params: { date } }),
  callPatient: (id) => api.patch(`/queue/${id}/call`),
  startConsultation: (id) => api.patch(`/queue/${id}/start`),
  completeConsultation: (id, notes) => api.patch(`/queue/${id}/complete`, { notes }),
  skipPatient: (id, reason) => api.patch(`/queue/${id}/skip`, { reason }),
  markNoShow: (id) => api.patch(`/queue/${id}/no-show`),
  pauseQueue: (doctorId, message) => api.patch(`/queue/session/${doctorId}/pause`, { message }),
  resumeQueue: (doctorId) => api.patch(`/queue/session/${doctorId}/resume`),
  markTemporarilyAway: (id) => api.patch(`/queue/${id}/temporarily-away`),
  markReturned: (id) => api.patch(`/queue/${id}/returned`),
  lookupAppointment: (params) => api.get('/appointments/lookup', { params }),
};

// Document API endpoints
export const documentAPI = {
  uploadDocument: (formData) => api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getPatientDocuments: (patientId, params) => api.get(`/documents/patient/${patientId}`, { params }),
  getDocument: (documentId) => api.get(`/documents/${documentId}`),
  downloadDocument: (documentId) => api.get(`/documents/${documentId}/download`, { responseType: 'blob' }),
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
  exportReport: (type, params) => api.get(`/reports/export/${type}`, { params, responseType: 'blob' }),
};

// Alias for backward compatibility
export const reportsAPI = reportAPI;

// Chatbot API endpoints
export const chatbotAPI = {
  sendMessage: (messageData) => api.post('/chatbot/message', messageData),
  getChatHistory: () => api.get('/chatbot/history'),
  getHealthTips: (category) => api.get(`/chatbot/health-tips/${category}`),
  getSymptomInfo: (symptom) => api.get(`/chatbot/symptom/${symptom}`),
  checkEmergency: (messageData) => api.post('/chatbot/emergency-check', messageData),
};

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
