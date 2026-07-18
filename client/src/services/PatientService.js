// Patient API calls (dashboard, appointments, records, profile...)

import BaseService from './BaseService';
import ApiService from './ApiService';

class PatientService extends BaseService {
  constructor() {
    super(ApiService.getInstance());
    this.endpoints = {
      dashboard: '/dashboard/stats',
      appointments: '/appointments',
      medicalRecords: '/medical-records',
      profile: '/users/profile',
      healthCard: '/health-cards',
      documents: '/documents'
    };
  }

  // Get everything the dashboard needs in one call
  async getDashboardData() {
    const cacheKey = 'patient_dashboard';
    
    return this.handleApiCall(
      async () => {
        // Fetch all dashboard data in parallel
        const [stats, appointments, medicalRecords, recentActivity] = await Promise.all([
          this.getPatientStats(),
          this.getRecentAppointments(5),
          this.getRecentMedicalRecords(5),
          this.getRecentActivity(10)
        ]);

        return {
          stats,
          appointments,
          medicalRecords,
          recentActivity,
          lastUpdated: new Date().toISOString()
        };
      },
      cacheKey,
      { useCache: true, cacheTTL: 300000 } // 5 minutes cache
    );
  }

  // Get the dashboard stats
  async getPatientStats() {
    return this.handleApiCall(
      () => this.api.get(this.endpoints.dashboard),
      'patient_stats',
      { useCache: true, cacheTTL: 600000 } // 10 minutes cache
    );
  }

  // Get appointments, with optional filters
  async getAppointments(options = {}) {
    const {
      limit = 10,
      status = null,
      startDate = null,
      endDate = null,
      doctorId = null
    } = options;

    const params = { limit };
    if (status) params.status = status;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (doctorId) params.doctorId = doctorId;

    return this.handleApiCall(
      () => this.api.get(this.endpoints.appointments, params),
      `appointments_${JSON.stringify(params)}`,
      { useCache: true, cacheTTL: 180000 } // 3 minutes cache
    );
  }

  // Get the most recent appointments
  async getRecentAppointments(limit = 5) {
    return this.getAppointments({ limit, status: null });
  }

  // Get upcoming appointments (today onwards)
  async getUpcomingAppointments(limit = 5) {
    const today = new Date().toISOString().split('T')[0];
    return this.getAppointments({ 
      limit, 
      startDate: today,
      status: 'scheduled,confirmed' 
    });
  }

  // Book an appointment
  async bookAppointment(appointmentData) {
    this.validateData(appointmentData, {
      doctorId: { required: true, type: 'string' },
      appointmentDate: { required: true, type: 'string' },
      reasonForVisit: { required: true, type: 'string', minLength: 5, maxLength: 500 },
      duration: { type: 'number' }
    });

    const transformedData = this.transformForApi(appointmentData);
    
    const result = await this.handleApiCall(
      () => this.api.post(this.endpoints.appointments, transformedData)
    );

    // Clear related caches
    this.clearCache('patient_dashboard');
    this.clearCache('patient_stats');
    
    return result;
  }

  // Cancel an appointment
  async cancelAppointment(appointmentId, reason) {
    const result = await this.handleApiCall(
      () => this.api.put(`${this.endpoints.appointments}/${appointmentId}/cancel`, { reason })
    );

    // Clear related caches
    this.clearCache('patient_dashboard');
    this.clearCache('patient_stats');
    
    return result;
  }

  // Get medical records, with optional filters
  async getMedicalRecords(options = {}) {
    const { limit = 10, recordType = null } = options;
    const params = { limit };
    if (recordType) params.recordType = recordType;

    return this.handleApiCall(
      () => this.api.get(this.endpoints.medicalRecords, params),
      `medical_records_${JSON.stringify(params)}`,
      { useCache: true, cacheTTL: 300000 } // 5 minutes cache
    );
  }

  // Get the most recent medical records
  async getRecentMedicalRecords(limit = 5) {
    return this.getMedicalRecords({ limit });
  }

  // Get the patient's profile
  async getProfile() {
    return this.handleApiCall(
      () => this.api.get(this.endpoints.profile),
      'patient_profile',
      { useCache: true, cacheTTL: 600000 } // 10 minutes cache
    );
  }

  // Update the patient's profile
  async updateProfile(profileData) {
    this.validateData(profileData, {
      firstName: { type: 'string', minLength: 2, maxLength: 50 },
      lastName: { type: 'string', minLength: 2, maxLength: 50 },
      email: { type: 'string' },
      phone: { type: 'string' }
    });

    const result = await this.handleApiCall(
      () => this.api.put(this.endpoints.profile, profileData)
    );

    // Clear profile cache
    this.clearCache('patient_profile');
    
    return result;
  }

  // Get the health card
  async getHealthCard() {
    return this.handleApiCall(
      () => this.api.get(this.endpoints.healthCard),
      'health_card',
      { useCache: true, cacheTTL: 3600000 } // 1 hour cache
    );
  }

  // Get documents, with optional filters
  async getDocuments(options = {}) {
    const { limit = 20, documentType = null } = options;
    const params = { limit };
    if (documentType) params.documentType = documentType;

    return this.handleApiCall(
      () => this.api.get(this.endpoints.documents, params),
      `documents_${JSON.stringify(params)}`,
      { useCache: true, cacheTTL: 300000 } // 5 minutes cache
    );
  }

  // Upload a document
  async uploadDocument(file, metadata = {}, onProgress = null) {
    const formData = new FormData();
    formData.append('document', file);
    
    Object.entries(metadata).forEach(([key, value]) => {
      formData.append(key, value);
    });

    const result = await this.handleApiCall(
      () => this.api.uploadFile(this.endpoints.documents, formData, onProgress)
    );

    // Clear documents cache
    this.clearCache('documents');
    
    return result;
  }

  // Build a recent-activity feed from appointments and medical records
  async getRecentActivity(limit = 10) {
    const [appointments, records] = await Promise.all([
      this.getRecentAppointments(limit / 2),
      this.getRecentMedicalRecords(limit / 2)
    ]);

    // Combine and sort by date
    const activities = [
      ...appointments.map(apt => ({
        id: apt.id,
        type: 'appointment',
        title: `Appointment with Dr. ${apt.doctor?.firstName} ${apt.doctor?.lastName}`,
        date: apt.appointmentDate,
        status: apt.status,
        data: apt
      })),
      ...records.map(record => ({
        id: record.id,
        type: 'medical_record',
        title: record.recordType || 'Medical Record',
        date: record.createdAt,
        status: 'completed',
        data: record
      }))
    ];

    return activities
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit);
  }

  // Convert dates to ISO strings before sending to the API
  transformForApi(data) {
    if (data.appointmentDate && typeof data.appointmentDate === 'string') {
      data.appointmentDate = new Date(data.appointmentDate).toISOString();
    }
    
    return data;
  }

  // Convert date strings from the API into Date objects
  transformFromApi(data) {
    if (data.appointmentDate) {
      data.appointmentDate = new Date(data.appointmentDate);
    }
    
    if (data.createdAt) {
      data.createdAt = new Date(data.createdAt);
    }
    
    return data;
  }

  getServiceName() {
    return 'PatientService';
  }

  // Clear all patient caches
  clearAllCaches() {
    this.clearCache();
  }
}

export default PatientService;
