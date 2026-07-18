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

describe('Auth API', () => {
  beforeAll(async () => {
    await global.TestDatabase.connect();
  });

  beforeEach(async () => {
    if (global.TestDatabase.isAvailable()) {
      await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    }
  });

  describe('POST /api/auth/login', () => {
    test('logs in a patient with correct credentials', async () => {
      await User.create({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'Patient123!',
        role: 'patient',
        phone: '+94770001111',
        dateOfBirth: '1990-01-01',
        gender: 'male',
        isActive: true,
        isEmailVerified: true
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john.doe@example.com', password: 'Patient123!' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.role).toBe('patient');
      expect(response.body.token).toBeDefined();
    });

    test('rejects an invalid password', async () => {
      await User.create({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'Patient123!',
        role: 'patient',
        phone: '+94770001111',
        dateOfBirth: '1990-01-01',
        gender: 'male'
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john.doe@example.com', password: 'WrongPassword!' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid email or password');
    });

    test('rejects an inactive account', async () => {
      await User.create({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'Patient123!',
        role: 'patient',
        phone: '+94770001111',
        dateOfBirth: '1990-01-01',
        gender: 'male',
        isActive: false
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john.doe@example.com', password: 'Patient123!' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Account is inactive');
    });
  });

  describe('GET /api/auth/me', () => {
    test('returns the current user for a valid token', async () => {
      await User.create({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        password: 'Patient123!',
        role: 'patient',
        phone: '+94770002222',
        dateOfBirth: '1985-05-15',
        gender: 'female',
        isActive: true,
        isEmailVerified: true
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: 'jane.smith@example.com', password: 'Patient123!' });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${loginResponse.body.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.role).toBe('patient');
    });

    test('rejects an invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('rejects a request with no token', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
