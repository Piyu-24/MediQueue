/**
 * @fileoverview Test Database Setup and Management using MongoDB Memory Server
 * @author MediQueue Development Team
 * @version 2.0.0
 *
 * Uses an in-memory MongoDB instance so tests never require a real running DB.
 * The MongoMemoryServer package is already listed in devDependencies.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

class TestDatabase {
  static mongod = null;
  static isConnected = false;

  /**
   * Start the in-memory MongoDB server and connect Mongoose to it.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
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

  /**
   * Disconnect Mongoose and stop the in-memory server.
   */
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

  /**
   * Delete all documents from every collection without dropping the DB.
   * Useful in afterEach hooks to reset state between tests.
   */
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

  /**
   * Returns true if the connection is currently open and ready.
   */
  static isAvailable() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }
}

module.exports = TestDatabase;
