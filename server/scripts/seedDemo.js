/**
 * MediQueue Demo Seed Script
 * 
 * Creates demo data to test the complete OPD journey:
 * Registration → QR Card → Appointment → Queue → Consultation
 *
 * Run: node server/scripts/seedDemo.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const User = require('../models/User');
const HealthCard = require('../models/HealthCard');
const Appointment = require('../models/Appointment');

// ── Connection ────────────────────────────────────────────────────────────────
const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('✅ Connected to MongoDB');
};

// ── Seed Data Definitions ─────────────────────────────────────────────────────
const generatedPassword = `Test${crypto.randomBytes(6).toString('hex')}A1!`;

const DOCTORS = [
  {
    firstName: 'Samantha', lastName: 'Perera',
    email: 'dr.perera@mediqueue.lk',
    role: 'doctor', specialization: 'General Medicine', department: 'General OPD',
    room: 'Room 01', phone: '+94771234001', isActive: true, isEmailVerified: true
  },
  {
    firstName: 'Rajan', lastName: 'Silva',
    email: 'dr.silva@mediqueue.lk',
    role: 'doctor', specialization: 'Cardiology', department: 'Cardiology',
    room: 'Room 02', phone: '+94771234002', isActive: true, isEmailVerified: true
  },
  {
    firstName: 'Priya', lastName: 'Fernando',
    email: 'dr.fernando@mediqueue.lk',
    role: 'doctor', specialization: 'Pediatrics', department: 'Pediatrics',
    room: 'Room 03', phone: '+94771234003', isActive: true, isEmailVerified: true
  }
];

const STAFF = [
  {
    firstName: 'Ayesha', lastName: 'Bandara',
    email: 'receptionist@mediqueue.lk',
    role: 'receptionist', phone: '+94771235001',
    isActive: true, isEmailVerified: true
  },
  {
    firstName: 'Kasun', lastName: 'Jayawardena',
    email: 'receptionist2@mediqueue.lk',
    role: 'receptionist', phone: '+94771235002',
    isActive: true, isEmailVerified: true
  }
];

const PATIENTS = [
  {
    firstName: 'Nimali', lastName: 'Kumari',
    email: 'patient1@mediqueue.lk',
    role: 'patient', phone: '+94712000001',
    dateOfBirth: '1990-05-15', gender: 'female',
    nicNumber: '901350001V', isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Chamara', lastName: 'Dissanayake',
    email: 'patient2@mediqueue.lk',
    role: 'patient', phone: '+94712000002',
    dateOfBirth: '1985-11-22', gender: 'male',
    nicNumber: '851270002V', isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Sashini', lastName: 'Wickramasinghe',
    email: 'patient3@mediqueue.lk',
    role: 'patient', phone: '+94712000003',
    dateOfBirth: '1995-03-08', gender: 'female',
    nicNumber: '956680003V', isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'pending'
  },
  {
    firstName: 'Lahiru', lastName: 'Rajapaksha',
    email: 'patient4@mediqueue.lk',
    role: 'patient', phone: '+94712000004',
    dateOfBirth: '1978-09-30', gender: 'male',
    nicNumber: '782740004V', isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Madhavi', lastName: 'Senanayake',
    email: 'patient5@mediqueue.lk',
    role: 'patient', phone: '+94712000005',
    dateOfBirth: '2000-01-20', gender: 'female',
    nicNumber: '200200005V', isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'unverified'
  }
];

// ── Seed Functions ────────────────────────────────────────────────────────────

const hashPwd = async () => bcrypt.hash(generatedPassword, 12);

const seedUsers = async (userDefs) => {
  const created = [];
  for (const def of userDefs) {
    const exists = await User.findOne({ email: def.email });
    if (exists) {
      console.log(`  ↩️  User exists: ${def.email}`);
      created.push(exists);
      continue;
    }
    const hashedPwd = await hashPwd();
    const user = await User.create({ ...def, password: hashedPwd });
    console.log(`  ✅ Created ${user.role}: ${user.email}`);
    created.push(user);
  }
  return created;
};

const seedHealthCards = async (patients) => {
  const cards = [];
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `HC${year}`;

  // Start sequence from the highest existing cardNumber for this year.
  // This keeps the script idempotent even if old/orphan cards exist.
  let seq = 1;
  const lastForYear = await HealthCard.findOne({ cardNumber: new RegExp(`^${prefix}`) })
    .sort({ cardNumber: -1 })
    .select({ cardNumber: 1 })
    .lean();
  if (lastForYear?.cardNumber) {
    const suffix = Number(lastForYear.cardNumber.slice(prefix.length));
    if (Number.isFinite(suffix) && suffix > 0) {
      seq = suffix + 1;
    }
  }

  for (const patient of patients) {
    const existing = await HealthCard.findOne({ patient: patient._id });
    if (existing) {
      console.log(`  ↩️  Card exists for ${patient.firstName}`);
      // Sync patient record
      await User.findByIdAndUpdate(patient._id, {
        digitalHealthCardId: existing.cardNumber,
        healthCard: existing._id
      });
      cards.push(existing);
      continue;
    }

    let cardNumber;
    // Ensure we never hit a duplicate key error even if some numbers are already taken.
    // (e.g., due to previous partial seeds)
    for (;;) {
      cardNumber = `${prefix}${String(seq++).padStart(6, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      const alreadyUsed = await HealthCard.exists({ cardNumber });
      if (!alreadyUsed) break;
    }
    const QRCode = require('qrcode');
    const randomBloodGroup = ['A+', 'B+', 'O+', 'AB+', 'A-', 'O-'][Math.floor(Math.random() * 6)];
    const qrPayload = JSON.stringify({ 
      cardNumber, 
      patientId: patient._id.toString(),
      name: `${patient.firstName} ${patient.lastName}`,
      dob: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().split('T')[0] : 'N/A',
      bloodGroup: randomBloodGroup,
      allergies: patient.allergies?.length ? patient.allergies.map(a => typeof a === 'string' ? a : a.allergen).join(', ') : 'None',
      emergencyContact: patient.emergencyContact?.phone || patient.phone || 'Not provided'
    });
    const qrCode = await QRCode.toDataURL(qrPayload);

    const card = await HealthCard.create({
      patient: patient._id,
      cardNumber,
      qrCode,
      bloodGroup: randomBloodGroup,
      status: 'active',
      issueDate: new Date(),
      expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 5)),
      allergies: [],
      chronicConditions: []
    });

    await User.findByIdAndUpdate(patient._id, {
      digitalHealthCardId: card.cardNumber,
      healthCard: card._id
    });

    console.log(`  ✅ Created health card ${card.cardNumber} for ${patient.firstName}`);
    cards.push(card);
  }
  return cards;
};


const seedAppointments = async (patients, doctors) => {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const times = ['09:00', '09:30', '10:00', '10:30', '11:00'];
  const types = ['consultation', 'follow-up', 'consultation'];

  for (let i = 0; i < Math.min(patients.length, doctors.length); i++) {
    // Appointment model validates appointmentDateTime must be in the future.
    // If the time slot for today has already passed, schedule it for tomorrow.
    const appointmentDate = new Date(today);
    const [hours, minutes] = times[i].split(':').map(Number);
    const slotDateTime = new Date(appointmentDate);
    slotDateTime.setHours(hours, minutes, 0, 0);
    if (slotDateTime <= now) {
      appointmentDate.setDate(appointmentDate.getDate() + 1);
    }

    const existing = await Appointment.findOne({
      patient: patients[i]._id,
      doctor: doctors[i % doctors.length]._id,
      appointmentDate: { $gte: today }
    });

    if (existing) {
      console.log(`  ↩️  Appointment exists for ${patients[i].firstName}`);
      continue;
    }

    const appt = await Appointment.create({
      patient: patients[i]._id,
      doctor: doctors[i % doctors.length]._id,
      appointmentDate,
      appointmentTime: times[i],
      appointmentType: types[i % types.length],
      status: 'scheduled',
      chiefComplaint: ['Routine checkup', 'Chest pain', 'Fever and cough', 'Joint pain', 'Headache'][i],
      duration: 15
    });
    console.log(`  ✅ Appointment: ${patients[i].firstName} → Dr. ${doctors[i % doctors.length].lastName} at ${appt.appointmentTime}`);
  }
};

// ── Main ──────────────────────────────────────────────────────────────────────
const seed = async () => {
  try {
    await connectDB();

    console.log('\n👨‍⚕️ Seeding Doctors...');
    const doctors = await seedUsers(DOCTORS);

    console.log('\n👩‍💼 Seeding Receptionists...');
    await seedUsers(STAFF);

    console.log('\n🧑‍🤝‍🧑 Seeding Patients...');
    const patients = await seedUsers(PATIENTS);

    console.log('\n💳 Creating Health Cards...');
    await seedHealthCards(patients);

    console.log('\n📅 Creating Today\'s Appointments...');
    await seedAppointments(patients, doctors);

    console.log('\n🎉 Seed complete! Demo accounts:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ROLE          EMAIL                          PASSWORD');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Receptionist  receptionist@mediqueue.lk      ${generatedPassword}`);
    console.log(`Doctor        dr.perera@mediqueue.lk         ${generatedPassword}`);
    console.log(`Doctor        dr.silva@mediqueue.lk          ${generatedPassword}`);
    console.log(`Doctor        dr.fernando@mediqueue.lk       ${generatedPassword}`);
    console.log(`Patient       patient1@mediqueue.lk          ${generatedPassword}`);
    console.log(`Patient       patient2@mediqueue.lk          ${generatedPassword}`);
    console.log(`Patient       patient3@mediqueue.lk          ${generatedPassword}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  IMPORTANT: Copy these auto-generated passwords now.');
    console.log('\n🔗 Public display screen: http://localhost:3000/display');
    console.log('🔗 Client: http://localhost:3000');
    console.log('🔗 Server: http://localhost:5000');

    mongoose.disconnect();
  } catch (error) {
    console.error('❌ Seed error:', error.message);
    mongoose.disconnect();
    process.exit(1);
  }
};

seed();
