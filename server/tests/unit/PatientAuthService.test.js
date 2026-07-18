const PatientAuthService = require('../../services/PatientAuthService');
const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

jest.mock('../../models/User');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

describe('PatientAuthService', () => {
  let mockUser;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';

    mockUser = {
      _id: '507f1f77bcf86cd799439011',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@test.com',
      phone: '+1-555-0100',
      role: 'patient',
      isActive: true,
      save: jest.fn().mockResolvedValue(true),
      comparePassword: jest.fn().mockResolvedValue(true)
    };
  });

  describe('registerPatient', () => {
    beforeEach(() => {
      User.findOne = jest.fn();
      bcrypt.hash = jest.fn();
      User.mockImplementation(() => mockUser);
    });

    test('registers a new patient', async () => {
      User.findOne.mockResolvedValue(null);
      bcrypt.hash.mockResolvedValue('hashedPassword');

      const result = await PatientAuthService.registerPatient({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@test.com',
        password: 'SecurePass123',
        phone: '+1-555-0100'
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Patient registered successfully');
    });

    test('rejects when required fields are missing', async () => {
      const result = await PatientAuthService.registerPatient({
        lastName: 'Doe',
        email: 'john@test.com',
        password: 'SecurePass123',
        phone: '+1-555-0100'
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('All fields are required');
    });

    test('rejects a duplicate email', async () => {
      User.findOne.mockResolvedValue(mockUser);

      const result = await PatientAuthService.registerPatient({
        firstName: 'John',
        lastName: 'Doe',
        email: 'existing@test.com',
        password: 'SecurePass123',
        phone: '+1-555-0100'
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Email already registered');
    });
  });

  describe('authenticatePatient', () => {
    beforeEach(() => {
      User.findOne = jest.fn();
      jwt.sign = jest.fn();
    });

    test('authenticates with correct credentials', async () => {
      User.findOne.mockResolvedValue(mockUser);
      jwt.sign.mockReturnValue('mock.jwt.token');

      const result = await PatientAuthService.authenticatePatient('john@test.com', 'SecurePass123');

      expect(result.success).toBe(true);
      expect(result.token).toBe('mock.jwt.token');
    });

    test('rejects when email or password is missing', async () => {
      const result = await PatientAuthService.authenticatePatient('', 'SecurePass123');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Email and password are required');
    });

    test('rejects a non-existent user', async () => {
      User.findOne.mockResolvedValue(null);

      const result = await PatientAuthService.authenticatePatient('nobody@test.com', 'SecurePass123');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid credentials');
    });

    test('rejects a wrong password', async () => {
      mockUser.comparePassword.mockResolvedValue(false);
      User.findOne.mockResolvedValue(mockUser);

      const result = await PatientAuthService.authenticatePatient('john@test.com', 'WrongPassword');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid credentials');
    });
  });

  describe('validation helpers', () => {
    test('isValidEmail accepts valid emails and rejects invalid ones', () => {
      expect(PatientAuthService.isValidEmail('test@example.com')).toBe(true);
      expect(PatientAuthService.isValidEmail('invalid-email')).toBe(false);
      expect(PatientAuthService.isValidEmail('')).toBe(false);
    });

    test('validatePassword accepts a strong password and rejects a weak one', () => {
      expect(PatientAuthService.validatePassword('SecurePass123').isValid).toBe(true);
      expect(PatientAuthService.validatePassword('123').isValid).toBe(false);
    });
  });
});
