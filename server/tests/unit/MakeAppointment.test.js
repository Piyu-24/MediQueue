/**
 * @fileoverview Unit Tests for Make an Appointment Use Case
 * @description Comprehensive test suite covering appointment booking, slot management, and scheduling
 * @author MediQueue Development Team
 * @version 2.0.0
 *
 * Payment integration has been removed.
 *
 * Test Coverage Areas:
 * - Appointment Creation (positive, negative, edge cases)
 * - Slot Availability Checking
 * - Doctor Schedule Management
 * - Appointment Modifications
 * - Cancellation
 *
 * Target Coverage: >80%
 */

const AppointmentService = require('../../services/AppointmentService');
const SlotManagementService = require('../../services/SlotManagementService');
const Appointment = require('../../models/Appointment');
const DoctorSlot = require('../../models/DoctorSlot');
const User = require('../../models/User');

// Mock dependencies
jest.mock('../../models/Appointment');
jest.mock('../../models/DoctorSlot');
jest.mock('../../models/User');

describe('UC02 - Make an Appointment', () => {
  let mockPatient, mockDoctor, mockSlot, mockAppointment;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockPatient = {
      _id: '507f1f77bcf86cd799439011',
      firstName: 'John',
      lastName: 'Patient',
      email: 'patient@test.com',
      role: 'patient'
    };

    mockDoctor = {
      _id: '507f1f77bcf86cd799439012',
      firstName: 'Dr. Jane',
      lastName: 'Doctor',
      email: 'doctor@test.com',
      role: 'doctor',
      specialization: 'Cardiology'
    };

    mockSlot = {
      _id: '507f1f77bcf86cd799439013',
      doctor: mockDoctor._id,
      date: new Date('2024-01-15'),
      startTime: '09:00',
      endTime: '09:30',
      isAvailable: true,
      duration: 30
    };

    mockAppointment = {
      _id: '507f1f77bcf86cd799439014',
      patient: mockPatient._id,
      doctor: mockDoctor._id,
      slot: mockSlot._id,
      appointmentDate: new Date('2024-01-15T09:00:00Z'),
      duration: 30,
      status: 'scheduled',
      reasonForVisit: 'Regular checkup',
      department: 'Cardiology',
      save: jest.fn()
    };
  });

  describe('Slot Availability Checking', () => {
    describe('Positive Cases', () => {
      test('should return available slots for a doctor on a specific date', async () => {
        const availableSlots = [mockSlot, { ...mockSlot, _id: 'slot2', startTime: '10:00', endTime: '10:30' }];
        DoctorSlot.find.mockResolvedValue(availableSlots);

        const result = await SlotManagementService.getAvailableSlots(mockDoctor._id, '2024-01-15');

        expect(DoctorSlot.find).toHaveBeenCalledWith({
          doctor: mockDoctor._id,
          date: new Date('2024-01-15'),
          isAvailable: true
        });
        expect(result.success).toBe(true);
        expect(result.slots).toHaveLength(2);
      });

      test('should filter slots by time range', async () => {
        const morningSlots = [
          { ...mockSlot, startTime: '09:00' },
          { ...mockSlot, startTime: '10:00' }
        ];
        DoctorSlot.find.mockResolvedValue(morningSlots);

        const result = await SlotManagementService.getAvailableSlots(
          mockDoctor._id, 
          '2024-01-15', 
          { startTime: '09:00', endTime: '11:00' }
        );

        expect(result.success).toBe(true);
        expect(result.slots).toHaveLength(2);
      });
    });

    describe('Negative Cases', () => {
      test('should return empty array when no slots available', async () => {
        DoctorSlot.find.mockResolvedValue([]);

        const result = await SlotManagementService.getAvailableSlots(mockDoctor._id, '2024-01-15');

        expect(result.success).toBe(true);
        expect(result.slots).toHaveLength(0);
      });

      test('should handle invalid doctor ID', async () => {
        const result = await SlotManagementService.getAvailableSlots('invalid-id', '2024-01-15');

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid doctor ID');
      });
    });

    describe('Edge Cases', () => {
      test('should handle past dates', async () => {
        const pastDate = new Date('2020-01-01').toISOString().split('T')[0];
        
        const result = await SlotManagementService.getAvailableSlots(mockDoctor._id, pastDate);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Cannot book appointments for past dates');
      });

      test('should handle database errors', async () => {
        DoctorSlot.find.mockRejectedValue(new Error('Database error'));

        const result = await SlotManagementService.getAvailableSlots(mockDoctor._id, '2024-01-15');

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to retrieve available slots');
      });
    });
  });

  describe('Appointment Creation', () => {
    describe('Positive Cases', () => {
      test('should successfully create appointment with valid data', async () => {
        const appointmentData = {
          patientId: mockPatient._id,
          doctorId: mockDoctor._id,
          slotId: mockSlot._id,
          reasonForVisit: 'Regular checkup'
        };

        User.findById.mockImplementation((id) => {
          if (id === mockPatient._id) return Promise.resolve(mockPatient);
          if (id === mockDoctor._id) return Promise.resolve(mockDoctor);
          return Promise.resolve(null);
        });
        
        DoctorSlot.findById.mockResolvedValue(mockSlot);
        DoctorSlot.findByIdAndUpdate.mockResolvedValue({ ...mockSlot, isAvailable: false });
        Appointment.prototype.save = jest.fn().mockResolvedValue(mockAppointment);

        const result = await AppointmentService.createAppointment(appointmentData);

        expect(result.success).toBe(true);
        expect(result.appointment).toEqual(expect.objectContaining({
          patient: mockPatient._id,
          doctor: mockDoctor._id,
          status: 'scheduled'
        }));
      });

      test('should handle emergency appointments with priority', async () => {
        const emergencyData = {
          patientId: mockPatient._id,
          doctorId: mockDoctor._id,
          slotId: mockSlot._id,
          reasonForVisit: 'Emergency consultation',
          priority: 'urgent'
        };

        User.findById.mockImplementation((id) => {
          if (id === mockPatient._id) return Promise.resolve(mockPatient);
          if (id === mockDoctor._id) return Promise.resolve(mockDoctor);
        });
        
        DoctorSlot.findById.mockResolvedValue(mockSlot);
        DoctorSlot.findByIdAndUpdate.mockResolvedValue({ ...mockSlot, isAvailable: false });
        Appointment.prototype.save = jest.fn().mockResolvedValue({ ...mockAppointment, priority: 'urgent' });

        const result = await AppointmentService.createAppointment(emergencyData);

        expect(result.success).toBe(true);
        expect(result.appointment.priority).toBe('urgent');
      });
    });

    describe('Negative Cases', () => {
      test('should reject appointment for non-existent patient', async () => {
        const appointmentData = {
          patientId: 'nonexistent-patient',
          doctorId: mockDoctor._id,
          slotId: mockSlot._id,
          reasonForVisit: 'Checkup'
        };

        User.findById.mockResolvedValue(null);

        const result = await AppointmentService.createAppointment(appointmentData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Patient not found');
      });

      test('should reject appointment for unavailable slot', async () => {
        const appointmentData = {
          patientId: mockPatient._id,
          doctorId: mockDoctor._id,
          slotId: mockSlot._id,
          reasonForVisit: 'Checkup'
        };

        User.findById.mockImplementation((id) => {
          if (id === mockPatient._id) return Promise.resolve(mockPatient);
          if (id === mockDoctor._id) return Promise.resolve(mockDoctor);
        });
        
        DoctorSlot.findById.mockResolvedValue({ ...mockSlot, isAvailable: false });

        const result = await AppointmentService.createAppointment(appointmentData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Selected slot is no longer available');
      });

      test('should reject appointment for unavailable slot (booking conflict)', async () => {
        const appointmentData = {
          patientId: mockPatient._id,
          doctorId: mockDoctor._id,
          slotId: mockSlot._id,
          reasonForVisit: 'Checkup'
        };

        User.findById.mockImplementation((id) => {
          if (id === mockPatient._id) return Promise.resolve(mockPatient);
          if (id === mockDoctor._id) return Promise.resolve(mockDoctor);
        });
        
        // Slot becomes unavailable just before booking is confirmed
        DoctorSlot.findById.mockResolvedValue({ ...mockSlot, isAvailable: false });

        const result = await AppointmentService.createAppointment(appointmentData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Selected slot is no longer available');
      });
    });

    describe('Edge Cases', () => {
      test('should handle concurrent booking attempts', async () => {
        const appointmentData = {
          patientId: mockPatient._id,
          doctorId: mockDoctor._id,
          slotId: mockSlot._id,
          reasonForVisit: 'Checkup'
        };

        User.findById.mockImplementation((id) => {
          if (id === mockPatient._id) return Promise.resolve(mockPatient);
          if (id === mockDoctor._id) return Promise.resolve(mockDoctor);
        });
        
        DoctorSlot.findById.mockResolvedValue(mockSlot);
        DoctorSlot.findByIdAndUpdate.mockResolvedValue(null); // Slot already booked

        const result = await AppointmentService.createAppointment(appointmentData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Slot booking conflict');
      });

      test('should validate appointment time constraints', async () => {
        const appointmentData = {
          patientId: mockPatient._id,
          doctorId: mockDoctor._id,
          slotId: mockSlot._id,
          reasonForVisit: 'Checkup'
        };

        const pastSlot = { ...mockSlot, date: new Date('2020-01-01') };
        
        User.findById.mockImplementation((id) => {
          if (id === mockPatient._id) return Promise.resolve(mockPatient);
          if (id === mockDoctor._id) return Promise.resolve(mockDoctor);
        });
        
        DoctorSlot.findById.mockResolvedValue(pastSlot);

        const result = await AppointmentService.createAppointment(appointmentData);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Cannot book appointments for past dates');
      });
    });
  });

  describe('Appointment Modifications', () => {
    describe('Positive Cases', () => {
      test('should successfully reschedule appointment', async () => {
        const newSlot = { ...mockSlot, _id: 'new-slot', startTime: '14:00', endTime: '14:30' };
        
        Appointment.findById.mockResolvedValue(mockAppointment);
        DoctorSlot.findById.mockResolvedValue(newSlot);
        DoctorSlot.findByIdAndUpdate.mockImplementation((id, update) => {
          if (update.isAvailable === false) return Promise.resolve({ ...newSlot, isAvailable: false });
          if (update.isAvailable === true) return Promise.resolve({ ...mockSlot, isAvailable: true });
        });
        Appointment.findByIdAndUpdate.mockResolvedValue({ 
          ...mockAppointment, 
          slot: newSlot._id,
          appointmentDate: new Date('2024-01-15T14:00:00Z')
        });

        const result = await AppointmentService.rescheduleAppointment(
          mockAppointment._id, 
          newSlot._id, 
          mockPatient._id
        );

        expect(result.success).toBe(true);
        expect(result.appointment.slot).toBe(newSlot._id);
      });

      test('should successfully cancel appointment', async () => {
        Appointment.findById.mockResolvedValue(mockAppointment);
        DoctorSlot.findByIdAndUpdate.mockResolvedValue({ ...mockSlot, isAvailable: true });
        Appointment.findByIdAndUpdate.mockResolvedValue({ ...mockAppointment, status: 'cancelled' });

        const result = await AppointmentService.cancelAppointment(mockAppointment._id, mockPatient._id);

        expect(result.success).toBe(true);
        expect(result.appointment.status).toBe('cancelled');
      });
    });

    describe('Negative Cases', () => {
      test('should reject reschedule for non-existent appointment', async () => {
        Appointment.findById.mockResolvedValue(null);

        const result = await AppointmentService.rescheduleAppointment('nonexistent-id', mockSlot._id, mockPatient._id);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Appointment not found');
      });

      test('should reject cancellation after appointment time', async () => {
        const pastAppointment = { 
          ...mockAppointment, 
          appointmentDate: new Date('2020-01-01T09:00:00Z') 
        };
        
        Appointment.findById.mockResolvedValue(pastAppointment);

        const result = await AppointmentService.cancelAppointment(mockAppointment._id, mockPatient._id);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Cannot cancel past appointments');
      });
    });

    describe('Edge Cases', () => {
      test('should handle cancellation gracefully', async () => {
        // Slot is already in the past — cancellation should fail
        const pastAppointment = {
          ...mockAppointment,
          appointmentDate: new Date('2020-01-01T09:00:00Z')
        };
        Appointment.findById.mockResolvedValue(pastAppointment);

        const result = await AppointmentService.cancelAppointment(mockAppointment._id, mockPatient._id);

        // Either rejected as past appointment or handled gracefully
        expect(result.success).toBe(false);
      });

      test('should handle same-day cancellation policies', async () => {
        const todayAppointment = { 
          ...mockAppointment, 
          appointmentDate: new Date() 
        };
        
        Appointment.findById.mockResolvedValue(todayAppointment);

        const result = await AppointmentService.cancelAppointment(mockAppointment._id, mockPatient._id);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Same-day cancellation not allowed');
      });
    });
  });

  // Payment integration section removed.
});
