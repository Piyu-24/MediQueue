const mongoose = require('mongoose');
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

// Create receptionist user
const createReceptionistUser = async () => {
  try {
    // Check if receptionist user already exists
    const existingReceptionist = await User.findOne({ email: 'receptionist@mediqueue.lk' });
    if (existingReceptionist) {
      console.log('ℹ️  Receptionist user already exists');
      console.log('📧 Email: receptionist@mediqueue.lk');
      console.log('🔑 Password: Receptionist123!');
      return;
    }

    // Create receptionist user
    const receptionistUser = new User({
      firstName: 'Front',
      lastName: 'Desk',
      email: 'receptionist@mediqueue.lk',
      password: 'Receptionist123!',
      phone: '+1-555-0300',
      role: 'receptionist',
      isActive: true,
      isEmailVerified: true,
      address: {
        street: '123 Hospital Street',
        city: 'Healthcare City',
        state: 'HC',
        zipCode: '12345',
        country: 'USA'
      }
    });

    await receptionistUser.save();
    console.log('✅ Receptionist user created successfully!');
    console.log('📧 Email: receptionist@mediqueue.lk');
    console.log('🔑 Password: Receptionist123!');

  } catch (error) {
    console.error('❌ Error creating receptionist user:', error);
  }
};

// Main function
const setupReceptionist = async () => {
  try {
    await connectDB();

    console.log('🔧 Setting up receptionist user...');
    await createReceptionistUser();

    console.log('🎉 Receptionist setup completed successfully!');
    console.log('\n📋 Receptionist Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email: receptionist@mediqueue.lk');
    console.log('🔑 Password: Receptionist123!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('❌ Receptionist setup failed:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};

// Run setup
setupReceptionist();
