
/**
 * Jest Setup File
 * Initializes test environment, global test utilities, and database configuration
 */

const TestDatabase = require('./testDatabase');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/mediqueue-test';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// ---------------------------------------------------------------------------
// Global TestDatabase — used by integration tests via global.TestDatabase
// ---------------------------------------------------------------------------
global.TestDatabase = TestDatabase;

// ---------------------------------------------------------------------------
// Global Test Utilities — factory helpers shared across all test files
// ---------------------------------------------------------------------------
global.testUtils = {
  /**
   * Creates a mock user object
   * @param {Object} overrides - Fields to override on the default mock
   */
  createMockUser(overrides = {}) {
    return {
      _id: overrides._id || '507f1f77bcf86cd799439011',
      firstName: overrides.firstName || 'John',
      lastName: overrides.lastName || 'Doe',
      email: overrides.email || 'john.doe@example.com',
      phone: overrides.phone || '+1234567890',
      role: overrides.role || 'patient',
      specialization: overrides.specialization || null,
      isActive: overrides.isActive !== undefined ? overrides.isActive : true,
      isEmailVerified: overrides.isEmailVerified !== undefined ? overrides.isEmailVerified : true,
      dateOfBirth: overrides.dateOfBirth || new Date('1990-01-01'),
      gender: overrides.gender || 'male',
      digitalHealthCardId: overrides.digitalHealthCardId || 'HC123456789',
      comparePassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
      generateAuthToken: jest.fn().mockReturnValue('mock.jwt.token'),
      ...overrides
    };
  },

  /**
   * Creates a mock appointment object
   * @param {Object} overrides - Fields to override on the default mock
   */
  createMockAppointment(overrides = {}) {
    return {
      _id: overrides._id || '507f1f77bcf86cd799439012',
      patient: overrides.patient || '507f1f77bcf86cd799439011',
      doctor: overrides.doctor || '507f1f77bcf86cd799439013',
      appointmentDate: overrides.appointmentDate || new Date(Date.now() + 86400000),
      appointmentTime: overrides.appointmentTime || '10:00',
      duration: overrides.duration || 30,
      reasonForVisit: overrides.reasonForVisit || 'Regular checkup',
      department: overrides.department || 'General Medicine',
      status: overrides.status || 'scheduled',
      cancellationReason: overrides.cancellationReason || null,
      cancelledAt: overrides.cancelledAt || null,
      completedAt: overrides.completedAt || null,
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      save: jest.fn().mockResolvedValue(true),
      populate: jest.fn().mockReturnThis(),
      ...overrides
    };
  },

  /**
   * Creates a mock Express request object
   * @param {Object} overrides - Fields to override on the default mock
   */
  createMockRequest(overrides = {}) {
    return {
      body: overrides.body || {},
      params: overrides.params || {},
      query: overrides.query || {},
      user: overrides.user || { id: '507f1f77bcf86cd799439011', role: 'patient' },
      headers: overrides.headers || {},
      ip: overrides.ip || '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn((header) => overrides.headers?.[header] || null),
      ...overrides
    };
  },

  /**
   * Creates a mock Express response object with chainable status/json methods
   */
  createMockResponse() {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
      send: jest.fn(),
      set: jest.fn()
    };
    // Make status() chainable: res.status(200).json({})
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    res.send.mockReturnValue(res);
    res.set.mockReturnValue(res);
    return res;
  },

  /**
   * Creates a mock Express next() function
   */
  createMockNext() {
    return jest.fn();
  }
};

module.exports = {};
