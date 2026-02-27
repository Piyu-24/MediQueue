const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Create predefined admin user
const createAdminUser = async () => {
  try {
    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'admin@mediqueue.lk' });
    if (existingAdmin) {
      console.log('ℹ️  Admin user already exists');
      console.log('📧 Email: admin@mediqueue.lk');
      console.log('🔑 Password: Admin123!');
      return;
    }

    // Create admin user with plain password - let pre-save middleware handle hashing
    const adminUser = new User({
      firstName: 'System',
      lastName: 'Administrator',
      email: 'admin@mediqueue.lk',
      password: 'Admin123!', // Plain password - will be hashed by pre-save middleware
      phone: '+1-555-0100',
      role: 'admin',
      isActive: true,
      isEmailVerified: true,
      address: {
        street: '123 Admin Street',
        city: 'Healthcare City',
        state: 'HC',
        zipCode: '12345',
        country: 'USA'
      }
    });

    // Save with pre-save middleware enabled
    await adminUser.save();
    console.log('✅ Admin user created successfully!');
    console.log('📧 Email: admin@mediqueue.lk');
    console.log('🔑 Password: Admin123!');

  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  }
};

// Main function
const setupAdmin = async () => {
  try {
    await connectDB();

    console.log('🔧 Setting up admin user...');
    await createAdminUser();

    console.log('🎉 Admin setup completed successfully!');
    console.log('\n📋 Admin Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email: admin@mediqueue.lk');
    console.log('🔑 Password: Admin123!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('❌ Admin setup failed:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};

// Run setup
setupAdmin();