// In-memory MongoDB for tests, so we don't need a real database running

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

class TestDatabase {
  static mongod = null;
  static isConnected = false;

  // Start the in-memory DB and connect. Safe to call more than once.
  static async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      // Start an in-memory Mongo instance
      this.mongod = await MongoMemoryServer.create();
      const uri = this.mongod.getUri();

      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      this.isConnected = true;
    } catch (error) {
      console.error('Test database connection failed:', error.message);
      // Do not re-throw — let tests degrade gracefully where possible
    }
  }

  // Disconnect and stop the in-memory server
  static async disconnect() {
    if (!this.isConnected) {
      return;
    }

    try {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close();
      if (this.mongod) {
        await this.mongod.stop();
        this.mongod = null;
      }
      this.isConnected = false;
    } catch (error) {
      console.error('Error disconnecting test database:', error.message);
    }
  }

  // Clear every collection to reset state between tests
  static async cleanup() {
    if (!this.isConnected) {
      return;
    }

    try {
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        await collections[key].deleteMany({});
      }
    } catch (error) {
      console.log('Cleanup error (ignored):', error.message);
    }
  }

  // True if the DB connection is open
  static isAvailable() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }
}

module.exports = TestDatabase;
