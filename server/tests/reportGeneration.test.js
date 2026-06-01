const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const GeneratedReport = require('../models/GeneratedReport');
const ReportGenerationController = require('../controllers/ReportGenerationController');
const TestDatabase = require('./testDatabase');

/**
 * UC04 - Generate Reports Unit Test Suite
 * Focused coverage for patient visits, staff utilization, and financial summary behavior.
 */

describe('UC04 - Generate Reports', () => {
  let manager;
  let managerToken;
  let doctor;
  let patient;

  const today = new Date();
  const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date(today);

  beforeAll(async () => {
    await TestDatabase.connect();
    await TestDatabase.cleanup();
  });

  afterAll(async () => {
    await TestDatabase.cleanup();
    await TestDatabase.disconnect();
  });

  beforeEach(async () => {
    manager = new User({
      firstName: 'John',
      lastName: 'Manager',
      email: 'manager@test.com',
      password: 'TestPass123!',
      phone: '+1-555-0101',
      role: 'manager',
      isActive: true,
      isEmailVerified: true
    });
    await manager.save();
    managerToken = manager.generateAuthToken();

    doctor = new User({
      firstName: 'Dr. Sarah',
      lastName: 'Smith',
      email: 'doctor@test.com',
      password: 'TestPass123!',
      phone: '+1-555-0102',
      role: 'doctor',
      specialization: 'Cardiology',
      licenseNumber: 'MD12345',
      department: 'Cardiology',
      isActive: true,
      isEmailVerified: true
    });
    await doctor.save();

    patient = new User({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'patient@test.com',
      password: 'TestPass123!',
      phone: '+1-555-0103',
      role: 'patient',
      isActive: true,
      isEmailVerified: true
    });
    await patient.save();
  });

  afterEach(async () => {
    await TestDatabase.cleanup();
  });

  describe('Patient Visit Report', () => {
    beforeEach(async () => {
      const appointment1 = new Appointment({
        patient: patient._id,
        doctor: doctor._id,
        appointmentDate: new Date(endDate.getTime() - 5 * 24 * 60 * 60 * 1000),
        appointmentTime: '10:00',
        chiefComplaint: 'Chest pain',
        symptoms: ['shortness of breath', 'dizziness'],
        status: 'completed',
        appointmentType: 'consultation',
        department: 'Cardiology'
      });
      await appointment1.save();

      const appointment2 = new Appointment({
        patient: patient._id,
        doctor: doctor._id,
        appointmentDate: new Date(endDate.getTime() - 10 * 24 * 60 * 60 * 1000),
        appointmentTime: '14:00',
        chiefComplaint: 'Follow-up',
        symptoms: [],
        status: 'completed',
        appointmentType: 'follow-up',
        department: 'Cardiology'
      });
      await appointment2.save();
    });

    test('Should generate patient visit report with valid date range', async () => {
      const res = await request(app)
        .post('/api/report-generation/patient-visits')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reportType).toBe('patient-visit');
      expect(res.body.data.analytics.totalVisits).toBe(2);
      expect(res.body.data.analytics.departmentBreakdown['Cardiology']).toBe(2);
    });

    test('Should include appointment details in report', async () => {
      const res = await request(app)
        .post('/api/report-generation/patient-visits')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.body.data.appointments.length).toBe(2);
      expect(res.body.data.appointments[0]).toHaveProperty('patientName');
      expect(res.body.data.appointments[0]).toHaveProperty('doctorName');
      expect(res.body.data.appointments[0]).toHaveProperty('status');
    });
  });

  describe('Staff Utilization Report', () => {
    beforeEach(async () => {
      const staff = new User({
        firstName: 'Dr. Mike',
        lastName: 'Johnson',
        email: 'doctor2@test.com',
        password: 'TestPass123!',
        phone: '+1-555-0104',
        role: 'doctor',
        specialization: 'Neurology',
        licenseNumber: 'MD12346',
        department: 'Neurology',
        isActive: true,
        isEmailVerified: true
      });
      await staff.save();

      const appointment1 = new Appointment({
        patient: patient._id,
        doctor: doctor._id,
        appointmentDate: new Date(endDate.getTime() - 3 * 24 * 60 * 60 * 1000),
        appointmentTime: '09:00',
        chiefComplaint: 'Check-up',
        status: 'completed',
        appointmentType: 'consultation',
        department: 'Cardiology'
      });
      await appointment1.save();
    });

    test('Should generate staff utilization report with valid parameters', async () => {
      const res = await request(app)
        .post('/api/report-generation/staff-utilization')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reportType).toBe('staff-utilization');
      expect(res.body.data.summary.totalStaff).toBeGreaterThan(0);
    });

    test('Should filter staff by department', async () => {
      const res = await request(app)
        .post('/api/report-generation/staff-utilization')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          department: 'Cardiology'
        });

      expect(res.body.data.filters.department).toBe('Cardiology');
    });
  });

  describe('Financial Summary Report', () => {
    test('Should return a financial summary message', async () => {
      const res = await request(app)
        .post('/api/report-generation/financial-summary')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reportType).toBe('financial-summary');
      expect(res.body.data.summary.message).toMatch(/disabled/i);
      expect(res.body.message).toMatch(/unavailable/i);
    });
  });

  describe('Validation and Authorization', () => {
    test('Should reject patient visit report without authentication', async () => {
      const res = await request(app)
        .post('/api/report-generation/patient-visits')
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(401);
    });

    test('Should reject patient visit report with invalid start date', async () => {
      const res = await request(app)
        .post('/api/report-generation/patient-visits')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: 'invalid-date',
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Edge Cases', () => {
    test('Should handle patient visit report with no appointments', async () => {
      const res = await request(app)
        .post('/api/report-generation/patient-visits')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        });

      expect(res.status).toBe(200);
      expect(res.body.data.analytics.totalVisits).toBe(0);
      expect(res.body.data.appointments.length).toBe(0);
    });

    test('Should handle report with reversed date range', async () => {
      const res = await request(app)
        .post('/api/report-generation/patient-visits')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          startDate: endDate.toISOString(),
          endDate: startDate.toISOString()
        });

      expect(res.status).toBe(200);
      expect(res.body.data.analytics.totalVisits).toBe(0);
    });
  });

  describe('ReportGenerationController Unit Tests', () => {
    test('Should expose expected methods', () => {
      expect(typeof ReportGenerationController.generatePatientVisitReport).toBe('function');
      expect(typeof ReportGenerationController.generateStaffUtilizationReport).toBe('function');
      expect(typeof ReportGenerationController.generateFinancialSummaryReport).toBe('function');
      expect(typeof ReportGenerationController.generateComprehensiveReport).toBe('function');
    });
  });
});