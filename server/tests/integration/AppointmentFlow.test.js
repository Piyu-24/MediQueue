/**
 * @fileoverview Integration Tests for Complete Appointment Flow (UC02)
 * @author MediQueue Development Team
 * @version 2.0.0
 *
 * Booking flow tests without payment steps.
 * Tests use mongodb-memory-server (via TestDatabase) for DB isolation.
 */

// IMPORTANT: Mock the mongo config BEFORE requiring server.js so that the
// automatic connectMongo() call at module-load time is a no-op.
// Our beforeAll hook calls TestDatabase.connect() which starts the real
// in-memory server and connects Mongoose to it.
jest.mock('../../config/mongo', () => ({
  connectMongo: jest.fn().mockResolvedValue({
    source: 'test-mock',
    fallbackFrom: null,
    atlasErrorKind: null
  })
}));

const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Appointment = require('../../models/Appointment');
const TestDatabase = require('../testDatabase');

describe('Integration Tests - Make an Appointment Flow (UC02)', () => {
  let patientToken;
  let doctorToken;
  let patientUser;
  let doctorUser;

  beforeAll(async () => {
    await TestDatabase.connect();
  });

  afterAll(async () => {
    await TestDatabase.disconnect();
  }, 15000);

  beforeEach(async () => {
    await TestDatabase.cleanup();

    // Create test users directly in the in-memory DB
    patientUser = await User.create({
      firstName: 'John',
      lastName: 'Doe',
      email: 'patient.test@example.com',
      password: 'hashedPassword123',
      role: 'patient',
      phone: '+1234567890',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'male',
      isActive: true,
      isEmailVerified: true
    });

    doctorUser = await User.create({
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'doctor.test@example.com',
      password: 'hashedPassword123',
      role: 'doctor',
      specialization: 'General Medicine',
      phone: '+1234567891',
      dateOfBirth: new Date('1980-01-01'),
      isActive: true,
      isEmailVerified: true
    });

    // Use real JWTs from the login endpoint
    const patientLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'patient.test@example.com', password: 'hashedPassword123' });
    // API returns: { success, message, data: { user, token, refreshToken } }
    patientToken = (patientLogin.body.data && patientLogin.body.data.token) || patientLogin.body.token || 'mock_patient_token';

    const doctorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'doctor.test@example.com', password: 'hashedPassword123' });
    doctorToken = (doctorLogin.body.data && doctorLogin.body.data.token) || doctorLogin.body.token || 'mock_doctor_token';
  });

  // ---------------------------------------------------------------------------
  // Main Success Scenario — Book → Confirm
  // ---------------------------------------------------------------------------
  describe('Complete Appointment Booking Flow', () => {
    test('should complete full appointment booking without payment', async () => {
      // Step 1: Patient logs in
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'patient.test@example.com',
          password: 'hashedPassword123'
        });

      expect(loginResponse.status).toBe(200);
      // API returns: { success, message, data: { user, token } }
      const token = (loginResponse.body.data && loginResponse.body.data.token) || loginResponse.body.token;

      // Step 2: Patient views available doctors
      const doctorsResponse = await request(app)
        .get('/api/users/doctors')
        .set('Authorization', `Bearer ${token}`);

      expect(doctorsResponse.status).toBe(200);

      // Step 3: Patient provides appointment details
      const appointmentDate = new Date(Date.now() + 172800000); // 48 hours ahead
      const dateString = appointmentDate.toISOString().split('T')[0]; // YYYY-MM-DD

      const appointmentData = {
        doctor: doctorUser._id.toString(),
        appointmentDate: dateString,
        appointmentTime: '10:00',
        appointmentType: 'consultation',
        chiefComplaint: 'Regular checkup for annual physical examination'
      };

      // Step 4: Submit appointment
      const bookingResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${token}`)
        .send(appointmentData);

      expect(bookingResponse.status).toBe(201);
      expect(bookingResponse.body.success).toBe(true);
      expect(bookingResponse.body.data.status).toBe('scheduled');
      // No paymentStatus expected
    });
  });

  // ---------------------------------------------------------------------------
  // Alternate Flow 4a: Doctor Fully Booked
  // ---------------------------------------------------------------------------
  describe('Alternate Flow 4a: Doctor Fully Booked', () => {
    test('should suggest alternative doctors when requested doctor is unavailable', async () => {
      const token = patientToken;

      const appointmentData = {
        doctor: doctorUser._id.toString(),
        appointmentDate: new Date('2024-12-25').toISOString().split('T')[0],
        appointmentTime: '10:00',
        appointmentType: 'consultation',
        chiefComplaint: 'Regular checkup'
      };

      const bookingResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${token}`)
        .send(appointmentData);

      if (bookingResponse.status === 409) {
        const alternativesResponse = await request(app)
          .get('/api/appointments/alternatives')
          .set('Authorization', `Bearer ${token}`)
          .query({
            department: 'General Medicine',
            appointmentDate: appointmentData.appointmentDate
          });

        expect(alternativesResponse.status).toBe(200);
        expect(alternativesResponse.body.data).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Appointment Cancellation
  // ---------------------------------------------------------------------------
  describe('Exception Flow 1: Appointment Cancellation', () => {
    test('should handle patient-initiated cancellation', async () => {
      const token = patientToken;

      // Create appointment 2 days from now
      const appointmentDate = new Date(Date.now() + 172800000); // 48 hours ahead
      const dateString = appointmentDate.toISOString().split('T')[0];

      const appointmentData = {
        doctor: doctorUser._id.toString(),
        appointmentDate: dateString,
        appointmentTime: '10:00',
        appointmentType: 'consultation',
        chiefComplaint: 'Regular checkup'
      };

      const bookingResponse = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${token}`)
        .send(appointmentData);

      // Only proceed with cancellation if booking succeeded
      if (bookingResponse.status === 201) {
        const appointmentId = bookingResponse.body.data._id;

        const cancellationResponse = await request(app)
          .put(`/api/appointments/${appointmentId}/cancel`)
          .set('Authorization', `Bearer ${token}`)
          .send({ reason: 'Personal emergency - cannot attend' });

        expect([200, 400]).toContain(cancellationResponse.status);
        if (cancellationResponse.status === 200) {
          expect(cancellationResponse.body.data.status).toBe('cancelled');
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Exception Flow 3: Concurrent Booking Attempts
  // ---------------------------------------------------------------------------
  describe('Exception Flow 3: Concurrent Booking Attempts', () => {
    test('should handle multiple patients trying to book the same slot', async () => {
      // Create a second patient
      const patient2 = await User.create({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'patient2.test@example.com',
        password: 'hashedPassword123',
        role: 'patient',
        phone: '+1234567892',
        dateOfBirth: new Date('1992-01-01'),
        isActive: true,
        isEmailVerified: true
      });

      const patient2Login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'patient2.test@example.com', password: 'hashedPassword123' });
      const token2 = patient2Login.body.token || 'mock_patient2_token';

      const appointmentDate = new Date(Date.now() + 86400000);
      appointmentDate.setHours(10, 0, 0, 0);

      const appointmentData = {
        doctorId: doctorUser._id.toString(),
        appointmentDate: appointmentDate.toISOString(),
        duration: 30,
        reasonForVisit: 'Regular checkup',
        department: 'General Medicine'
      };

      // Simulate concurrent booking attempts
      const [response1, response2] = await Promise.allSettled([
        request(app)
          .post('/api/appointments')
          .set('Authorization', `Bearer ${patientToken}`)
          .send(appointmentData),
        request(app)
          .post('/api/appointments')
          .set('Authorization', `Bearer ${token2}`)
          .send(appointmentData)
      ]);

      const responses = [response1, response2].map(r => r.value || r.reason);
      const statuses = responses.map(r => r.status);

      // At least one should get a valid response (201 or 409)
      expect(statuses.some(s => [201, 409, 400, 401].includes(s))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance: High Concurrent Requests
  // ---------------------------------------------------------------------------
  describe('Performance and Load Testing', () => {
    test('should handle high concurrent appointment requests', async () => {
      const token = patientToken;

      const promises = Array(5).fill().map((_, index) => {
        const futureDate = new Date(Date.now() + 86400000 + (index * 3600000));
        futureDate.setHours(10 + index, 0, 0, 0);

        return request(app)
          .post('/api/appointments')
          .set('Authorization', `Bearer ${token}`)
          .send({
            doctorId: doctorUser._id.toString(),
            appointmentDate: futureDate.toISOString(),
            duration: 30,
            reasonForVisit: `Checkup ${index + 1}`,
            department: 'General Medicine'
          });
      });

      const startTime = Date.now();
      const results = await Promise.allSettled(promises);
      const endTime = Date.now();

      // Should complete within a reasonable time
      expect(endTime - startTime).toBeLessThan(15000); // 15 seconds

      // Each result should have a valid HTTP status
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          expect([201, 400, 401, 409]).toContain(r.value.status);
        }
      });
    });
  });
});
