const AppointmentBookingService = require('../../services/AppointmentBookingService');
const Appointment = require('../../models/Appointment');
const User = require('../../models/User');

jest.mock('../../models/Appointment');
jest.mock('../../models/User');
jest.mock('../../models/DoctorSlot');

describe('AppointmentBookingService', () => {
  let mockDoctor, mockPatient, mockAppointment;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDoctor = {
      _id: '507f1f77bcf86cd799439011',
      firstName: 'Dr. Jane',
      lastName: 'Smith',
      role: 'doctor'
    };

    mockPatient = {
      _id: '507f1f77bcf86cd799439012',
      firstName: 'John',
      lastName: 'Doe',
      role: 'patient'
    };

    mockAppointment = {
      _id: '507f1f77bcf86cd799439013',
      patient: mockPatient._id,
      doctor: mockDoctor._id,
      appointmentDate: new Date('2024-12-25'),
      appointmentTime: '10:00',
      reason: 'Regular checkup',
      status: 'scheduled',
      duration: 30,
      save: jest.fn().mockResolvedValue(true)
    };
  });

  describe('getAvailableSlots', () => {
    beforeEach(() => {
      User.findById = jest.fn();
      Appointment.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });
    });

    test('returns slots for a valid doctor and future date', async () => {
      User.findById.mockResolvedValue(mockDoctor);

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const result = await AppointmentBookingService.getAvailableSlots(mockDoctor._id, futureDateStr);

      expect(result.success).toBe(true);
      expect(result.slots).toBeDefined();
    });

    test('fails when doctor id or date is missing', async () => {
      const result = await AppointmentBookingService.getAvailableSlots('', '2024-12-25');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Doctor ID and date are required');
    });

    test('fails when the doctor does not exist', async () => {
      User.findById.mockResolvedValue(null);

      const result = await AppointmentBookingService.getAvailableSlots('invalid-id', '2024-12-25');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Doctor not found');
    });

    test('rejects past dates', async () => {
      User.findById.mockResolvedValue(mockDoctor);

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const result = await AppointmentBookingService.getAvailableSlots(
        mockDoctor._id,
        pastDate.toISOString().split('T')[0]
      );
      expect(result.success).toBe(false);
      expect(result.message).toBe('Cannot book appointments for past dates');
    });
  });

  describe('bookAppointment', () => {
    let appointmentData;

    beforeEach(() => {
      appointmentData = {
        patientId: mockPatient._id,
        doctorId: mockDoctor._id,
        appointmentDate: '2024-12-25',
        appointmentTime: '10:00',
        reason: 'Regular checkup',
        duration: 30
      };

      Appointment.mockImplementation(() => mockAppointment);
      AppointmentBookingService._checkSlotAvailability = jest.fn().mockResolvedValue({ available: true });
    });

    test('books an appointment successfully', async () => {
      const result = await AppointmentBookingService.bookAppointment(appointmentData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Appointment booked successfully');
      expect(result.appointment).toBeDefined();
    });

    test('fails when required fields are missing', async () => {
      delete appointmentData.patientId;

      const result = await AppointmentBookingService.bookAppointment(appointmentData);
      expect(result.success).toBe(false);
      expect(result.message).toBe('All appointment fields are required');
    });

    test('fails when the slot is not available', async () => {
      AppointmentBookingService._checkSlotAvailability = jest.fn().mockResolvedValue({ available: false });

      const result = await AppointmentBookingService.bookAppointment(appointmentData);
      expect(result.success).toBe(false);
      expect(result.message).toBe('Selected time slot is no longer available');
    });
  });

  describe('cancelAppointment', () => {
    beforeEach(() => {
      Appointment.findById = jest.fn();
    });

    test('cancels an upcoming appointment', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 2);
      Appointment.findById.mockResolvedValue({ ...mockAppointment, appointmentDate: futureDate });

      const result = await AppointmentBookingService.cancelAppointment(
        mockAppointment._id,
        mockPatient._id,
        'Schedule conflict'
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Appointment cancelled successfully');
    });

    test('fails when the appointment does not exist', async () => {
      Appointment.findById.mockResolvedValue(null);

      const result = await AppointmentBookingService.cancelAppointment('invalid-id', mockPatient._id);
      expect(result.success).toBe(false);
      expect(result.message).toBe('Appointment not found');
    });

    test('fails when the user is not allowed to cancel', async () => {
      Appointment.findById.mockResolvedValue(mockAppointment);

      const result = await AppointmentBookingService.cancelAppointment(mockAppointment._id, 'someone-else');
      expect(result.success).toBe(false);
      expect(result.message).toBe('You are not authorized to cancel this appointment');
    });
  });

  describe('validation helpers', () => {
    test('isValidTimeFormat accepts valid times and rejects invalid ones', () => {
      expect(AppointmentBookingService.isValidTimeFormat('09:00')).toBe(true);
      expect(AppointmentBookingService.isValidTimeFormat('23:59')).toBe(true);
      expect(AppointmentBookingService.isValidTimeFormat('25:00')).toBe(false);
      expect(AppointmentBookingService.isValidTimeFormat('9:00')).toBe(false);
    });

    test('isValidStatus accepts known statuses only', () => {
      expect(AppointmentBookingService.isValidStatus('scheduled')).toBe(true);
      expect(AppointmentBookingService.isValidStatus('cancelled')).toBe(true);
      expect(AppointmentBookingService.isValidStatus('invalid')).toBe(false);
    });
  });
});
