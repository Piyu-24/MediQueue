// Mock the MongoDB connection so requiring server.js does not open a real DB
jest.mock('../config/mongo', () => ({
  connectMongo: jest.fn().mockResolvedValue({
    source: 'test-mock',
    fallbackFrom: null,
    atlasErrorKind: null
  })
}));

const request = require('supertest');
const app = require('../server');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const TestDatabase = require('./testDatabase');

describe('Doctor leave', () => {
  let doctor;
  let doctorToken;
  let patient;
  let appointment;

  beforeAll(async () => {
    await TestDatabase.connect();
  });

  afterAll(async () => {
    await TestDatabase.cleanup();
    await TestDatabase.disconnect();
  });

  beforeEach(async () => {
    await TestDatabase.cleanup();

    doctor = await User.create({
      firstName: 'Dr. Leave',
      lastName: 'Tester',
      email: 'dr.leave@test.com',
      password: 'Doctor123!',
      phone: '+1-555-1000',
      role: 'doctor',
      specialization: 'General',
      isActive: true,
      isEmailVerified: true,
      credentialVerificationStatus: 'verified'
    });
    doctorToken = doctor.generateAuthToken();

    patient = await User.create({
      firstName: 'Patient',
      lastName: 'One',
      email: 'patient.leave@test.com',
      password: 'Patient123!',
      phone: '+1-555-2000',
      role: 'patient',
      isActive: true
    });

    // Appointment for tomorrow at 10:00
    const apptDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    apptDate.setHours(0, 0, 0, 0);

    appointment = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      appointmentDate: apptDate,
      appointmentTime: '10:00',
      duration: 30,
      appointmentType: 'consultation',
      chiefComplaint: 'Test complaint'
    });
  });

  test('dry run returns the number of affected appointments', async () => {
    const response = await request(app)
      .post('/api/doctor/leave?dryRun=true')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ startDate: appointment.appointmentDate.toISOString(), leaveType: 'FULL_DAY' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.affectedCount).toBe(1);
  });

  test('submitting leave updates the appointment and notifies the patient', async () => {
    const response = await request(app)
      .post('/api/doctor/leave')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        startDate: appointment.appointmentDate.toISOString(),
        leaveType: 'FULL_DAY',
        reason: 'Conference'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const updated = await Appointment.findById(appointment._id);
    expect(updated.status).toBe('doctor-unavailable');

    const notification = await Notification.findOne({
      recipient: patient._id,
      type: 'doctor-unavailable'
    });
    expect(notification).toBeTruthy();
  });
});
