// Mock MongoDB connection before server.js loads
jest.mock('../config/mongo', () => ({
  connectMongo: jest.fn().mockResolvedValue({
    source: 'test-mock',
    fallbackFrom: null,
    atlasErrorKind: null
  })
}));

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const TestDatabase = require('./testDatabase');

describe('Leave Notification Flow', () => {
  let doctor;
  let doctorToken;
  let patient;
  let appointment;

  beforeAll(async () => {
    await TestDatabase.connect();
    await TestDatabase.cleanup();
  });

  afterAll(async () => {
    await TestDatabase.cleanup();
    await TestDatabase.disconnect();
  });

  beforeEach(async () => {
    // Create doctor
    doctor = new User({
      firstName: 'Dr. Leave',
      lastName: 'Tester',
      email: 'dr.leave@test.com',
      password: 'Doctor123!',
      phone: '+1-555-1000',
      role: 'doctor',
      specialization: 'General',
      isActive: true,
      isEmailVerified: true
    });
    await doctor.save();
    doctorToken = doctor.generateAuthToken();

    // Create patient
    patient = new User({
      firstName: 'Patient',
      lastName: 'One',
      email: 'patient.leave@test.com',
      password: 'Patient123!',
      phone: '+1-555-2000',
      role: 'patient',
      isActive: true
    });
    await patient.save();

    // Create appointment for tomorrow at 10:00
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const apptDate = new Date(tomorrow);
    apptDate.setHours(0,0,0,0);

    appointment = new Appointment({
      patient: patient._id,
      doctor: doctor._id,
      appointmentDate: apptDate,
      appointmentTime: '10:00',
      duration: 30,
      appointmentType: 'consultation',
      chiefComplaint: 'Test complaint'
    });
    await appointment.save();
    const saved = await Appointment.find({ doctor: doctor._id });
    if (!saved || saved.length === 0) {
      throw new Error('Sanity check failed: appointment not saved in test database');
    }
  });

  afterEach(async () => {
    await TestDatabase.cleanup();
  });

  test('dry-run returns affected appointment count', async () => {
    const apptDateIso = appointment.appointmentDate.toISOString();

    const response = await request(app)
      .post('/api/doctor/leave?dryRun=true')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ startDate: apptDateIso, leaveType: 'FULL_DAY' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.affectedCount).toBe(1);
  });

  test('submitting leave updates appointment and creates notification', async () => {
    const apptDateIso = appointment.appointmentDate.toISOString();

    const response = await request(app)
      .post('/api/doctor/leave')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ startDate: apptDateIso, leaveType: 'FULL_DAY', reason: 'Conference' });
    if (response.status !== 200) {
      throw new Error(`Submit leave failed: ${JSON.stringify(response.body)}`);
    }

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.affectedCount).toBe(1);

    // Reload appointment
    const updated = await Appointment.findById(appointment._id);
    expect(updated.status).toBe('doctor-unavailable');
    expect(updated.leaveInfo).toBeTruthy();

    // Notification created
    const notif = await Notification.findOne({ recipient: patient._id, type: 'doctor-unavailable' });
    expect(notif).toBeTruthy();
    expect(notif.appointment.toString()).toBe(appointment._id.toString());

    // Audit logs created
    const leaveLog = await AuditLog.findOne({ userId: doctor._id, action: 'DOCTOR_LEAVE_SUBMITTED' });
    expect(leaveLog).toBeTruthy();

    const notifyLog = await AuditLog.findOne({ userId: doctor._id, action: 'PATIENT_NOTIFIED_LEAVE' });
    expect(notifyLog).toBeTruthy();
  });
});
