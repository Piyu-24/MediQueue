/**
 * MediQueue — Comprehensive Demo Seed Script
 *
 * Creates a fully-populated demonstration environment covering all roles,
 * appointment statuses, queue states, medical history, and dashboard data.
 *
 * Usage:
 *   node server/scripts/seedDemo.js           # additive / idempotent
 *   node server/scripts/seedDemo.js --reset   # wipe queue/appt/record data first
 *
 * Fixed demo password for all accounts: Demo@MediQueue1
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const QRCode   = require('qrcode');

const User               = require('../models/User');
const HealthCard         = require('../models/HealthCard');
const Appointment        = require('../models/Appointment');
const QueueEntry         = require('../models/QueueEntry');
const DoctorQueueSession = require('../models/DoctorQueueSession');
const MedicalRecord      = require('../models/MedicalRecord');
const Prescription       = require('../models/Prescription');
const Notification       = require('../models/Notification');
const Consultation       = require('../models/Consultation');
const Department         = require('../models/Department');
const TimeBlock          = require('../models/TimeBlock');
const TokenSequence      = require('../models/TokenSequence');
const QueuePolicy        = require('../models/QueuePolicy');

// ── Config ────────────────────────────────────────────────────────────────────

const DEMO_PASSWORD = 'Demo@MediQueue1';
const RESET         = process.argv.includes('--reset');

// ── DB Connection ─────────────────────────────────────────────────────────────

const connectDB = async () => {
  const uri =
    process.env.MONGODB_URI ||
    `mongodb://127.0.0.1:27017/${process.env.MONGODB_DB || 'mediqueue'}`;
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('✅ Connected to MongoDB');
};

// ── Date helpers ──────────────────────────────────────────────────────────────

const TODAY      = new Date(); TODAY.setHours(0, 0, 0, 0);
const todayStr   = () => TODAY.toISOString().split('T')[0];
const daysAgo    = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() - n); return d; };
const daysAhead  = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; };
const dateStr    = (d) => d.toISOString().split('T')[0];

// ── Appointment reference generator ──────────────────────────────────────────

let _refSeq = 1;
const makeRef = (d) => {
  const ds = d instanceof Date
    ? d.toISOString().slice(0,10).replace(/-/g,'')
    : String(d).replace(/-/g,'');
  return `MQ-${ds}-${String(_refSeq++).padStart(4,'0')}`;
};

// ── Prescription number generator ────────────────────────────────────────────

const makeRxNum = () => `RX-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

// ── User definitions ──────────────────────────────────────────────────────────

const ADMIN = {
  firstName: 'Admin', lastName: 'MediQueue',
  email: 'admin@mediqueue.lk',
  role: 'admin',
  phone: '+94771230000',
  isActive: true, isEmailVerified: true,
  identityVerificationStatus: 'verified'
};

const DOCTORS = [
  {
    firstName: 'Samantha', lastName: 'Perera',
    email: 'dr.perera@mediqueue.lk',
    role: 'doctor',
    specialization: 'General Medicine', department: 'General OPD',
    yearsOfExperience: 12,
    qualifications: ['MBBS', 'MD (General Medicine)'],
    languages: ['Sinhala', 'English', 'Tamil'],
    phone: '+94771234001',
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified',
    // Mon-Fri 08:00-16:00
    availability: {
      mon: { enabled: true, startTime: '08:00', endTime: '16:00' },
      tue: { enabled: true, startTime: '08:00', endTime: '16:00' },
      wed: { enabled: true, startTime: '08:00', endTime: '16:00' },
      thu: { enabled: true, startTime: '08:00', endTime: '16:00' },
      fri: { enabled: true, startTime: '08:00', endTime: '16:00' },
      sat: { enabled: false, startTime: '09:00', endTime: '13:00' },
      sun: { enabled: false, startTime: '09:00', endTime: '13:00' },
    }
  },
  {
    firstName: 'Rajan', lastName: 'Silva',
    email: 'dr.silva@mediqueue.lk',
    role: 'doctor',
    specialization: 'Cardiology', department: 'Cardiology',
    yearsOfExperience: 18,
    qualifications: ['MBBS', 'MD (Cardiology)', 'FRCP'],
    languages: ['Sinhala', 'English'],
    phone: '+94771234002',
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified',
    availability: {
      mon: { enabled: true, startTime: '09:00', endTime: '17:00' },
      tue: { enabled: true, startTime: '09:00', endTime: '17:00' },
      wed: { enabled: false, startTime: '09:00', endTime: '17:00' },
      thu: { enabled: true, startTime: '09:00', endTime: '17:00' },
      fri: { enabled: true, startTime: '09:00', endTime: '17:00' },
      sat: { enabled: true, startTime: '09:00', endTime: '13:00' },
      sun: { enabled: false, startTime: '09:00', endTime: '13:00' },
    }
  },
  {
    firstName: 'Priya', lastName: 'Fernando',
    email: 'dr.fernando@mediqueue.lk',
    role: 'doctor',
    specialization: 'Pediatrics', department: 'Pediatrics',
    yearsOfExperience: 9,
    qualifications: ['MBBS', 'DCH', 'MD (Pediatrics)'],
    languages: ['Sinhala', 'English', 'Tamil'],
    phone: '+94771234003',
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified',
    availability: {
      mon: { enabled: true, startTime: '08:30', endTime: '15:30' },
      tue: { enabled: true, startTime: '08:30', endTime: '15:30' },
      wed: { enabled: true, startTime: '08:30', endTime: '15:30' },
      thu: { enabled: true, startTime: '08:30', endTime: '15:30' },
      fri: { enabled: true, startTime: '08:30', endTime: '15:30' },
      sat: { enabled: false, startTime: '09:00', endTime: '12:00' },
      sun: { enabled: false, startTime: '09:00', endTime: '12:00' },
    }
  }
];

const STAFF = [
  {
    firstName: 'Ayesha', lastName: 'Bandara',
    email: 'receptionist@mediqueue.lk',
    role: 'receptionist',
    department: 'General OPD',
    phone: '+94771235001',
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Kasun', lastName: 'Jayawardena',
    email: 'receptionist2@mediqueue.lk',
    role: 'receptionist',
    department: 'Cardiology',
    phone: '+94771235002',
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  }
];

const PATIENTS = [
  {
    firstName: 'Nimali', lastName: 'Kumari',
    email: 'patient1@mediqueue.lk',
    role: 'patient', phone: '+94712000001',
    dateOfBirth: new Date('1990-05-15'), gender: 'female',
    nicNumber: '901350001V',
    bloodType: 'A+',
    allergies: [{ allergen: 'Penicillin', severity: 'severe', notes: 'Anaphylaxis risk' }],
    chronicConditions: ['Hypertension'],
    address: { street: '12 Galle Road', city: 'Colombo', state: 'Western Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Chamara', lastName: 'Dissanayake',
    email: 'patient2@mediqueue.lk',
    role: 'patient', phone: '+94712000002',
    dateOfBirth: new Date('1985-11-22'), gender: 'male',
    nicNumber: '851270002V',
    bloodType: 'B+',
    chronicConditions: ['Type 2 Diabetes', 'Hyperlipidemia'],
    address: { street: '45 Kandy Road', city: 'Kandy', state: 'Central Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Sashini', lastName: 'Wickramasinghe',
    email: 'patient3@mediqueue.lk',
    role: 'patient', phone: '+94712000003',
    dateOfBirth: new Date('1995-03-08'), gender: 'female',
    nicNumber: '956680003V',
    bloodType: 'O+',
    address: { street: '78 Negombo Road', city: 'Negombo', state: 'Western Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'pending'
  },
  {
    firstName: 'Lahiru', lastName: 'Rajapaksha',
    email: 'patient4@mediqueue.lk',
    role: 'patient', phone: '+94712000004',
    dateOfBirth: new Date('1978-09-30'), gender: 'male',
    nicNumber: '782740004V',
    bloodType: 'AB+',
    chronicConditions: ['Asthma'],
    allergies: [{ allergen: 'Aspirin', severity: 'moderate', notes: 'GI distress' }],
    address: { street: '23 Matara Road', city: 'Galle', state: 'Southern Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Madhavi', lastName: 'Senanayake',
    email: 'patient5@mediqueue.lk',
    role: 'patient', phone: '+94712000005',
    dateOfBirth: new Date('2000-01-20'), gender: 'female',
    nicNumber: '200200005V',
    bloodType: 'O-',
    address: { street: '9 Temple Road', city: 'Kurunegala', state: 'North Western Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'unverified'
  },
  {
    firstName: 'Ruwan', lastName: 'Mendis',
    email: 'patient6@mediqueue.lk',
    role: 'patient', phone: '+94712000006',
    dateOfBirth: new Date('1972-07-14'), gender: 'male',
    nicNumber: '721960006V',
    bloodType: 'A-',
    chronicConditions: ['Ischemic Heart Disease', 'Hypertension'],
    currentMedications: [
      { medication: 'Atorvastatin', dosage: '40mg', frequency: 'Once daily', prescribedBy: 'Dr. Silva' },
      { medication: 'Metoprolol', dosage: '50mg', frequency: 'Twice daily', prescribedBy: 'Dr. Silva' }
    ],
    address: { street: '34 Baseline Road', city: 'Colombo', state: 'Western Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Dilani', lastName: 'Jayasinghe',
    email: 'patient7@mediqueue.lk',
    role: 'patient', phone: '+94712000007',
    dateOfBirth: new Date('1993-12-05'), gender: 'female',
    nicNumber: '933400007V',
    bloodType: 'B-',
    address: { street: '56 High Level Road', city: 'Nugegoda', state: 'Western Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  },
  {
    firstName: 'Ashan', lastName: 'Weerasinghe',
    email: 'patient8@mediqueue.lk',
    role: 'patient', phone: '+94712000008',
    dateOfBirth: new Date('2016-04-22'), gender: 'male',
    nicNumber: null,
    bloodType: 'A+',
    address: { street: '67 Moratuwa Road', city: 'Moratuwa', state: 'Western Province', country: 'Sri Lanka' },
    isActive: true, isEmailVerified: true,
    identityVerificationStatus: 'verified'
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const hashPwd = () => bcrypt.hash(DEMO_PASSWORD, 12);

const upsertUser = async (def) => {
  const exists = await User.findOne({ email: def.email });
  if (exists) {
    // Update availability if doctor (may have changed)
    if (def.availability) {
      await User.findByIdAndUpdate(exists._id, { availability: def.availability });
    }
    console.log(`  ↩  User exists: ${def.email}`);
    return exists;
  }
  const user = await User.create({ ...def, password: await hashPwd() });
  console.log(`  ✅ Created [${user.role}]: ${user.email}`);
  return user;
};

// Build appointmentDate at midnight + appointmentTime as a combined Date for insertion
const apptDate = (d) => {
  const dt = new Date(d); dt.setHours(0, 0, 0, 0); return dt;
};

// Raw insert bypasses pre-save hooks (no date-future validator, no pre-save reference hook)
const insertAppt = async (doc) => {
  doc.appointmentReference = doc.appointmentReference || makeRef(doc.appointmentDate);
  doc.notifications = { reminderSent: false, confirmationSent: false, followUpSent: false };
  doc.createdAt = doc.createdAt || new Date();
  doc.updatedAt = doc.updatedAt || new Date();
  return Appointment.collection.insertOne(doc);
};

// ── Reset ─────────────────────────────────────────────────────────────────────

const resetCollections = async () => {
  console.log('\n🗑  Resetting demo collections...');
  await Promise.all([
    Appointment.deleteMany({}),
    QueueEntry.deleteMany({}),
    DoctorQueueSession.deleteMany({}),
    MedicalRecord.deleteMany({}),
    Prescription.deleteMany({}),
    Notification.deleteMany({}),
    Consultation.deleteMany({}),
    TimeBlock.deleteMany({}),
    TokenSequence.deleteMany({}),
  ]);
  console.log('  ✅ Collections cleared');
};

// ── Health Cards ──────────────────────────────────────────────────────────────

const seedHealthCards = async (patients) => {
  const year   = new Date().getFullYear().toString().slice(-2);
  const prefix = `HC${year}`;

  let seq = 1;
  const last = await HealthCard.findOne({ cardNumber: new RegExp(`^${prefix}`) })
    .sort({ cardNumber: -1 }).select({ cardNumber: 1 }).lean();
  if (last?.cardNumber) {
    const n = Number(last.cardNumber.slice(prefix.length));
    if (Number.isFinite(n) && n > 0) seq = n + 1;
  }

  const bloodGroups = ['A+', 'B+', 'O+', 'AB+', 'A-', 'O-', 'B-', 'AB-'];
  for (const patient of patients) {
    const existing = await HealthCard.findOne({ patient: patient._id });
    if (existing) {
      await User.findByIdAndUpdate(patient._id, { digitalHealthCardId: existing.cardNumber });
      console.log(`  ↩  Card exists for ${patient.firstName}`);
      continue;
    }

    let cardNumber;
    for (;;) {
      cardNumber = `${prefix}${String(seq++).padStart(6, '0')}`;
      if (!(await HealthCard.exists({ cardNumber }))) break;
    }

    const bg = patient.bloodType || bloodGroups[seq % bloodGroups.length];
    const qrPayload = JSON.stringify({
      cardNumber,
      patientId: patient._id.toString(),
      name: `${patient.firstName} ${patient.lastName}`,
      dob: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().split('T')[0] : 'N/A',
      bloodGroup: bg,
      allergies: patient.allergies?.length
        ? patient.allergies.map(a => (typeof a === 'string' ? a : a.allergen)).join(', ')
        : 'None',
      emergencyContact: patient.phone || 'Not provided'
    });
    const qrCode = await QRCode.toDataURL(qrPayload);

    const card = await HealthCard.create({
      patient: patient._id,
      cardNumber, qrCode,
      bloodGroup: bg,
      status: 'active',
      issueDate: new Date(),
      expiryDate: daysAhead(365 * 5),
      allergies: patient.allergies?.map(a => (typeof a === 'string' ? a : a.allergen)) || [],
      chronicConditions: (patient.chronicConditions || []).map(c => ({ condition: c, diagnosedDate: daysAgo(365) }))
    });

    await User.findByIdAndUpdate(patient._id, { digitalHealthCardId: card.cardNumber });
    console.log(`  ✅ Health card ${card.cardNumber} → ${patient.firstName}`);
  }
};

// ── Main seed ─────────────────────────────────────────────────────────────────

const seed = async () => {
  await connectDB();

  if (RESET) await resetCollections();

  // ── 1. Users ────────────────────────────────────────────────────────────────
  console.log('\n👑 Seeding Admin...');
  const admin = await upsertUser(ADMIN);

  console.log('\n👨‍⚕️ Seeding Doctors...');
  const [drPerera, drSilva, drFernando] = await Promise.all(DOCTORS.map(upsertUser));

  console.log('\n👩‍💼 Seeding Receptionists...');
  const [recAyesha, recKasun] = await Promise.all(STAFF.map(upsertUser));

  console.log('\n🧑‍🤝‍🧑 Seeding Patients...');
  const [p1, p2, p3, p4, p5, p6, p7, p8] = await Promise.all(PATIENTS.map(upsertUser));

  // ── 2. Health Cards ─────────────────────────────────────────────────────────
  console.log('\n💳 Health Cards...');
  await seedHealthCards([p1, p2, p3, p4, p5, p6, p7, p8]);

  // ── 3. Historical appointments (past 30 days) ───────────────────────────────
  console.log('\n📅 Historical appointments...');

  const histAppts = [
    // ── Dr. Perera completions ───────────────────────────────────────────────
    {
      patient: p1._id, doctor: drPerera._id,
      appointmentDate: apptDate(daysAgo(25)), appointmentTime: '09:00',
      appointmentType: 'consultation', status: 'completed',
      chiefComplaint: 'Persistent headache and dizziness',
      duration: 30,
      diagnosis: { primary: 'Hypertension - uncontrolled', secondary: [], icd10Codes: ['I10'] },
      prescription: [{ medication: 'Amlodipine 5mg', dosage: '5mg', frequency: 'Once daily', duration: '30 days', instructions: 'Take in the morning' }],
      vitalSigns: { bloodPressure: { systolic: 158, diastolic: 95 }, heartRate: 82, temperature: 36.8, weight: 62, height: 162 },
      notes: { doctor: 'Patient presents with uncontrolled hypertension. Prescribed Amlodipine. Lifestyle modification advised. Follow-up in 4 weeks.' },
      rating: { patientRating: 5, patientFeedback: 'Very thorough consultation, doctor explained everything clearly.' }
    },
    {
      patient: p1._id, doctor: drPerera._id,
      appointmentDate: apptDate(daysAgo(5)), appointmentTime: '09:30',
      appointmentType: 'follow-up', status: 'completed',
      chiefComplaint: 'Follow-up for hypertension',
      duration: 20,
      diagnosis: { primary: 'Hypertension - controlled', secondary: [], icd10Codes: ['I10'] },
      vitalSigns: { bloodPressure: { systolic: 132, diastolic: 82 }, heartRate: 76, temperature: 36.6, weight: 61, height: 162 },
      notes: { doctor: 'Blood pressure improving on Amlodipine. Continue current medication. Next review in 1 month.' },
      rating: { patientRating: 5, patientFeedback: 'Quick and efficient follow-up.' }
    },
    {
      patient: p4._id, doctor: drPerera._id,
      appointmentDate: apptDate(daysAgo(18)), appointmentTime: '10:00',
      appointmentType: 'consultation', status: 'completed',
      chiefComplaint: 'Wheezing and shortness of breath',
      duration: 30,
      diagnosis: { primary: 'Bronchial Asthma - exacerbation', secondary: [], icd10Codes: ['J45.901'] },
      prescription: [
        { medication: 'Salbutamol Inhaler', dosage: '2 puffs', frequency: 'PRN', duration: '30 days', instructions: 'Use when breathless' },
        { medication: 'Budesonide Inhaler', dosage: '2 puffs', frequency: 'Twice daily', duration: '30 days', instructions: 'Morning and evening' }
      ],
      vitalSigns: { bloodPressure: { systolic: 128, diastolic: 78 }, heartRate: 98, temperature: 37.1, weight: 78, height: 175 },
      notes: { doctor: 'Acute asthma exacerbation. Prescribed Salbutamol and Budesonide inhalers. Avoid triggers. Peak flow meter recommended.' }
    },
    {
      patient: p7._id, doctor: drPerera._id,
      appointmentDate: apptDate(daysAgo(10)), appointmentTime: '11:00',
      appointmentType: 'consultation', status: 'completed',
      chiefComplaint: 'Fever, sore throat and body aches for 3 days',
      duration: 20,
      diagnosis: { primary: 'Acute viral upper respiratory tract infection', secondary: [], icd10Codes: ['J06.9'] },
      prescription: [
        { medication: 'Paracetamol 500mg', dosage: '500mg', frequency: 'Three times daily', duration: '5 days', instructions: 'Take after meals' },
        { medication: 'Vitamin C 500mg', dosage: '500mg', frequency: 'Once daily', duration: '7 days', instructions: 'Take with water' }
      ],
      notes: { doctor: 'Viral URTI. Symptomatic treatment. Advised rest and plenty of fluids. No antibiotics required.' }
    },

    // ── Dr. Silva (Cardiology) completions ───────────────────────────────────
    {
      patient: p2._id, doctor: drSilva._id,
      appointmentDate: apptDate(daysAgo(22)), appointmentTime: '10:00',
      appointmentType: 'consultation', status: 'completed',
      chiefComplaint: 'Chest pain on exertion and palpitations',
      duration: 45,
      diagnosis: { primary: 'Stable Angina', secondary: ['Hyperlipidemia'], icd10Codes: ['I20.9', 'E78.5'] },
      prescription: [
        { medication: 'Aspirin 75mg', dosage: '75mg', frequency: 'Once daily', duration: '90 days', instructions: 'Take with food' },
        { medication: 'Atorvastatin 20mg', dosage: '20mg', frequency: 'Once daily at night', duration: '90 days', instructions: 'Take at bedtime' },
        { medication: 'GTN Spray', dosage: '0.4mg sublingual', frequency: 'PRN for chest pain', duration: '90 days', instructions: 'Spray under tongue when chest pain starts' }
      ],
      vitalSigns: { bloodPressure: { systolic: 145, diastolic: 88 }, heartRate: 88, temperature: 36.9, weight: 85, height: 172 },
      notes: { doctor: 'Stress ECG shows ST changes during exertion. Coronary artery disease likely. Started anti-anginal therapy. Echocardiogram and stress test ordered. Strict diabetic control essential.' }
    },
    {
      patient: p6._id, doctor: drSilva._id,
      appointmentDate: apptDate(daysAgo(14)), appointmentTime: '09:30',
      appointmentType: 'follow-up', status: 'completed',
      chiefComplaint: 'Follow-up post myocardial infarction',
      duration: 30,
      diagnosis: { primary: 'Post-MI follow-up, stable', secondary: ['Hypertension'], icd10Codes: ['I25.2', 'I10'] },
      vitalSigns: { bloodPressure: { systolic: 128, diastolic: 80 }, heartRate: 68, temperature: 36.7, weight: 80, height: 170 },
      notes: { doctor: 'Patient doing well post-MI. BP controlled on current regimen. Continue Atorvastatin and Metoprolol. Cardiac rehabilitation recommended.' }
    },
    {
      patient: p6._id, doctor: drSilva._id,
      appointmentDate: apptDate(daysAgo(3)), appointmentTime: '10:00',
      appointmentType: 'follow-up', status: 'completed',
      chiefComplaint: 'Routine cardiac review',
      duration: 20,
      diagnosis: { primary: 'Ischemic heart disease - stable', secondary: [], icd10Codes: ['I25.10'] },
      vitalSigns: { bloodPressure: { systolic: 124, diastolic: 76 }, heartRate: 65, temperature: 36.5, weight: 79, height: 170 },
      notes: { doctor: 'Stable. Echo shows preserved EF. Continue current medications. Next review in 3 months.' },
      rating: { patientRating: 4, patientFeedback: 'Good consultation.' }
    },

    // ── Dr. Fernando (Pediatrics) completions ────────────────────────────────
    {
      patient: p8._id, doctor: drFernando._id,
      appointmentDate: apptDate(daysAgo(20)), appointmentTime: '09:00',
      appointmentType: 'consultation', status: 'completed',
      chiefComplaint: 'High fever and rash for 2 days',
      duration: 30,
      diagnosis: { primary: 'Chickenpox (Varicella)', secondary: [], icd10Codes: ['B01.9'] },
      prescription: [
        { medication: 'Calamine Lotion', dosage: 'Apply topically', frequency: 'Three times daily', duration: '7 days', instructions: 'Apply to rash' },
        { medication: 'Paracetamol Syrup 250mg/5ml', dosage: '10ml', frequency: 'Every 6 hours if fever', duration: '5 days', instructions: 'Only when temperature above 38°C' }
      ],
      notes: { doctor: 'Classic varicella presentation. Home isolation for 7 days. Advise parents to watch for secondary bacterial infection.' }
    },
    {
      patient: p8._id, doctor: drFernando._id,
      appointmentDate: apptDate(daysAgo(7)), appointmentTime: '09:30',
      appointmentType: 'follow-up', status: 'completed',
      chiefComplaint: 'Post-varicella follow-up',
      duration: 15,
      diagnosis: { primary: 'Varicella - resolved', secondary: [], icd10Codes: ['B01.9'] },
      notes: { doctor: 'Rash healed. No scarring. Immunization schedule reviewed. General health good.' },
      rating: { patientRating: 5, patientFeedback: 'Very caring doctor, excellent with children.' }
    },
    {
      patient: p5._id, doctor: drFernando._id,
      appointmentDate: apptDate(daysAgo(12)), appointmentTime: '10:30',
      appointmentType: 'check-up', status: 'completed',
      chiefComplaint: 'Annual health check-up',
      duration: 30,
      notes: { doctor: 'Annual check-up. All parameters normal. Growth and development on track. Vaccination up to date.' }
    },

    // ── Cancelled / No-show ──────────────────────────────────────────────────
    {
      patient: p3._id, doctor: drPerera._id,
      appointmentDate: apptDate(daysAgo(8)), appointmentTime: '11:30',
      appointmentType: 'consultation', status: 'cancelled',
      chiefComplaint: 'Back pain',
      duration: 30,
      cancellation: { cancelledBy: 'patient', cancelledAt: daysAgo(9), reason: 'Schedule conflict' }
    },
    {
      patient: p2._id, doctor: drSilva._id,
      appointmentDate: apptDate(daysAgo(6)), appointmentTime: '11:00',
      appointmentType: 'follow-up', status: 'no-show',
      chiefComplaint: 'Cardiology follow-up',
      duration: 20
    },
    {
      patient: p5._id, doctor: drPerera._id,
      appointmentDate: apptDate(daysAgo(4)), appointmentTime: '10:30',
      appointmentType: 'consultation', status: 'cancelled',
      chiefComplaint: 'Skin rash',
      duration: 20,
      cancellation: { cancelledBy: 'staff', cancelledAt: daysAgo(4), reason: 'Doctor on leave' }
    }
  ];

  const histIds = [];
  for (const doc of histAppts) {
    const existing = await Appointment.findOne({
      patient: doc.patient, doctor: doc.doctor,
      appointmentDate: doc.appointmentDate, appointmentTime: doc.appointmentTime
    });
    if (existing) { histIds.push(existing._id); console.log(`  ↩  Historical appt exists`); continue; }
    const res = await insertAppt(doc);
    histIds.push(res.insertedId);
    console.log(`  ✅ Past appt [${doc.status}]: ${doc.appointmentTime} – ${doc.chiefComplaint.slice(0, 40)}`);
  }

  // ── 4. Today's appointments ─────────────────────────────────────────────────
  console.log('\n🏥 Today\'s appointments...');

  // Dr. Perera – full active queue
  const todayAppts = [
    // 1. Nimali → in_consultation
    {
      patient: p1._id, doctor: drPerera._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '08:30',
      appointmentType: 'consultation', status: 'in_consultation',
      chiefComplaint: 'Hypertension review and medication adjustment',
      duration: 30,
      checkIn: { time: new Date(TODAY.getTime() + 8*3600000 + 20*60000), method: 'qr-code', verifiedBy: recAyesha._id }
    },
    // 2. Lahiru → called (READY zone)
    {
      patient: p4._id, doctor: drPerera._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '09:00',
      appointmentType: 'follow-up', status: 'in_queue',
      chiefComplaint: 'Asthma management follow-up',
      duration: 20,
      checkIn: { time: new Date(TODAY.getTime() + 8*3600000 + 50*60000), method: 'qr-code', verifiedBy: recAyesha._id }
    },
    // 3. Dilani → waiting (READY zone)
    {
      patient: p7._id, doctor: drPerera._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '09:30',
      appointmentType: 'consultation', status: 'in_queue',
      chiefComplaint: 'Migraine headaches recurring',
      duration: 30,
      checkIn: { time: new Date(TODAY.getTime() + 9*3600000 + 15*60000), method: 'manual', verifiedBy: recAyesha._id }
    },
    // 4. Sashini → waiting (WAITING_POOL)
    {
      patient: p3._id, doctor: drPerera._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '10:00',
      appointmentType: 'consultation', status: 'in_queue',
      chiefComplaint: 'Lower back pain and fatigue',
      duration: 30,
      checkIn: { time: new Date(TODAY.getTime() + 9*3600000 + 45*60000), method: 'digital-card', verifiedBy: recAyesha._id }
    },
    // 5. Chamara → checked_in at reception
    {
      patient: p2._id, doctor: drPerera._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '10:30',
      appointmentType: 'check-up', status: 'checked_in',
      chiefComplaint: 'Annual general check-up',
      duration: 30,
      checkIn: { time: new Date(TODAY.getTime() + 10*3600000 + 10*60000), method: 'qr-code', verifiedBy: recAyesha._id }
    },
    // 6. Madhavi → scheduled (not arrived yet)
    {
      patient: p5._id, doctor: drPerera._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '11:00',
      appointmentType: 'consultation', status: 'scheduled',
      chiefComplaint: 'Skin rash and itching',
      duration: 20
    },

    // Dr. Silva – Cardiology queue
    // 7. Ruwan → in_consultation
    {
      patient: p6._id, doctor: drSilva._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '09:00',
      appointmentType: 'follow-up', status: 'in_consultation',
      chiefComplaint: 'Cardiac medication review and ECG follow-up',
      duration: 30,
      checkIn: { time: new Date(TODAY.getTime() + 8*3600000 + 45*60000), method: 'qr-code', verifiedBy: recKasun._id }
    },
    // 8. Chamara already in Dr. Perera. Let's add new patient for cardiology wait
    {
      patient: p2._id, doctor: drSilva._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '09:30',
      appointmentType: 'follow-up', status: 'in_queue',
      chiefComplaint: 'Angina and lipid profile review',
      duration: 30,
      checkIn: { time: new Date(TODAY.getTime() + 9*3600000 + 5*60000), method: 'manual', verifiedBy: recKasun._id }
    },

    // Dr. Fernando – Pediatrics (paused queue)
    // 9. Ashan → waiting
    {
      patient: p8._id, doctor: drFernando._id,
      appointmentDate: apptDate(TODAY), appointmentTime: '09:00',
      appointmentType: 'check-up', status: 'in_queue',
      chiefComplaint: 'Annual developmental check-up',
      duration: 30,
      checkIn: { time: new Date(TODAY.getTime() + 8*3600000 + 50*60000), method: 'qr-code', verifiedBy: recAyesha._id }
    }
  ];

  const todayApptDocs = [];
  for (const doc of todayAppts) {
    const existing = await Appointment.findOne({
      patient: doc.patient, doctor: doc.doctor,
      appointmentDate: doc.appointmentDate, appointmentTime: doc.appointmentTime
    });
    if (existing) {
      todayApptDocs.push(existing);
      console.log(`  ↩  Today appt exists: ${doc.appointmentTime}`);
      continue;
    }
    const res = await insertAppt(doc);
    const saved = await Appointment.findById(res.insertedId);
    todayApptDocs.push(saved);
    console.log(`  ✅ Today appt [${doc.status}]: ${doc.appointmentTime} – Dr.${doc.doctor === drPerera._id ? 'Perera' : doc.doctor === drSilva._id ? 'Silva' : 'Fernando'}`);
  }

  // Extract today's appointment documents by index
  const [tA1, tA2, tA3, tA4, tA5, tA6, tA7, tA8, tA9] = todayApptDocs;

  // ── 5. Queue Sessions ───────────────────────────────────────────────────────
  console.log('\n🎯 Queue Sessions...');
  const qDate = todayStr();

  const getOrCreateSession = async (doctor, department, room, overrides = {}) => {
    const existing = await DoctorQueueSession.findOne({ doctor: doctor._id, queueDate: qDate });
    if (existing) { console.log(`  ↩  Session exists: ${doctor.lastName}`); return existing; }
    const s = await DoctorQueueSession.create({
      doctor: doctor._id, department, room, queueDate: qDate,
      status: 'active', startedAt: new Date(TODAY.getTime() + 8*3600000),
      avgConsultationMinutes: 15, consultationsCompleted: 3,
      ...overrides
    });
    console.log(`  ✅ Queue session: Dr.${doctor.lastName} [${s.status}]`);
    return s;
  };

  const sessionPerera   = await getOrCreateSession(drPerera,   'General OPD', 'Room 01');
  const sessionSilva    = await getOrCreateSession(drSilva,    'Cardiology',  'Room 02');
  const sessionFernando = await getOrCreateSession(drFernando, 'Pediatrics',  'Room 03', {
    status: 'paused',
    pausedAt: new Date(TODAY.getTime() + 9*3600000 + 30*60000),
    pauseReason: 'Doctor attending emergency case'
  });

  // ── 6. Queue Entries (today's active queue) ─────────────────────────────────
  console.log('\n🔢 Queue Entries...');

  // Helper: safe upsert – by appointment ref (if set) or by the unique token key
  const upsertQueueEntry = async (doc) => {
    const ex = doc.appointment
      ? await QueueEntry.findOne({ appointment: doc.appointment })
      : await QueueEntry.findOne({ doctor: doc.doctor, queueDate: doc.queueDate, queueNumber: doc.queueNumber });
    if (ex) { console.log(`  ↩  Queue entry exists: ${ex.queueNumber}`); return ex; }
    const entry = await QueueEntry.create(doc);
    console.log(`  ✅ Queue [${entry.queueNumber}] ${entry.zone}/${entry.status} – ${entry.department}`);
    return entry;
  };

  // Dr. Perera queue entries
  const qe1 = await upsertQueueEntry({
    patient: p1._id, doctor: drPerera._id, appointment: tA1?._id || null,
    checkedInBy: recAyesha._id,
    room: 'Room 01', department: 'General OPD',
    tokenType: 'A', queueNumber: 'A001', sequenceNumber: 1,
    zone: 'CURRENT', status: 'in_consultation', sortOrder: 1,
    isLocked: true, patientsAheadCount: 0,
    priority: 'normal', priorityScore: 100,
    appointmentTime: '08:30',
    checkInTime: new Date(TODAY.getTime() + 8*3600000 + 20*60000),
    calledTime: new Date(TODAY.getTime() + 8*3600000 + 30*60000),
    consultationStartTime: new Date(TODAY.getTime() + 8*3600000 + 35*60000),
    estimatedWaitMinutes: 0, avgConsultationMinutes: 15,
    queueDate: qDate
  });

  const qe2 = await upsertQueueEntry({
    patient: p4._id, doctor: drPerera._id, appointment: tA2?._id || null,
    checkedInBy: recAyesha._id,
    room: 'Room 01', department: 'General OPD',
    tokenType: 'A', queueNumber: 'A002', sequenceNumber: 2,
    zone: 'READY', status: 'called', sortOrder: 2,
    isLocked: true, patientsAheadCount: 1,
    priority: 'normal', priorityScore: 200,
    appointmentTime: '09:00',
    checkInTime: new Date(TODAY.getTime() + 8*3600000 + 50*60000),
    calledTime: new Date(TODAY.getTime() + 8*3600000 + 55*60000),
    estimatedWaitMinutes: 15, avgConsultationMinutes: 15,
    queueDate: qDate
  });

  const qe3 = await upsertQueueEntry({
    patient: p7._id, doctor: drPerera._id, appointment: tA3?._id || null,
    checkedInBy: recAyesha._id,
    room: 'Room 01', department: 'General OPD',
    tokenType: 'A', queueNumber: 'A003', sequenceNumber: 3,
    zone: 'READY', status: 'waiting', sortOrder: 3,
    isLocked: true, patientsAheadCount: 2,
    priority: 'normal', priorityScore: 300,
    appointmentTime: '09:30',
    checkInTime: new Date(TODAY.getTime() + 9*3600000 + 15*60000),
    estimatedWaitMinutes: 30, avgConsultationMinutes: 15,
    queueDate: qDate
  });

  const qe4 = await upsertQueueEntry({
    patient: p3._id, doctor: drPerera._id, appointment: tA4?._id || null,
    checkedInBy: recAyesha._id,
    room: 'Room 01', department: 'General OPD',
    tokenType: 'A', queueNumber: 'A004', sequenceNumber: 4,
    zone: 'WAITING_POOL', status: 'waiting', sortOrder: 4,
    isLocked: false, patientsAheadCount: 3,
    priority: 'normal', priorityScore: 400,
    appointmentTime: '10:00',
    checkInTime: new Date(TODAY.getTime() + 9*3600000 + 45*60000),
    estimatedWaitMinutes: 45, avgConsultationMinutes: 15,
    queueDate: qDate
  });

  // Completed earlier today (Dr. Perera)
  await upsertQueueEntry({
    patient: p6._id, doctor: drPerera._id, appointment: null,
    checkedInBy: recAyesha._id,
    room: 'Room 01', department: 'General OPD',
    tokenType: 'W', queueNumber: 'W001', sequenceNumber: 10,
    zone: 'COMPLETED', status: 'completed', sortOrder: 0,
    isLocked: false, patientsAheadCount: 0,
    priority: 'normal', priorityScore: 100,
    isWalkIn: true,
    checkInTime: new Date(TODAY.getTime() + 7*3600000 + 50*60000),
    calledTime: new Date(TODAY.getTime() + 8*3600000),
    consultationStartTime: new Date(TODAY.getTime() + 8*3600000 + 5*60000),
    consultationEndTime: new Date(TODAY.getTime() + 8*3600000 + 18*60000),
    estimatedWaitMinutes: 0, avgConsultationMinutes: 13,
    queueDate: qDate
  });

  // Update session with current queue entry
  if (qe1 && !sessionPerera.currentQueueEntryId) {
    await DoctorQueueSession.findByIdAndUpdate(sessionPerera._id, { currentQueueEntryId: qe1._id });
  }

  // Dr. Silva queue entries
  const qe7 = await upsertQueueEntry({
    patient: p6._id, doctor: drSilva._id, appointment: tA7?._id || null,
    checkedInBy: recKasun._id,
    room: 'Room 02', department: 'Cardiology',
    tokenType: 'A', queueNumber: 'A001', sequenceNumber: 1,
    zone: 'CURRENT', status: 'in_consultation', sortOrder: 1,
    isLocked: true, patientsAheadCount: 0,
    priority: 'normal', priorityScore: 100,
    appointmentTime: '09:00',
    checkInTime: new Date(TODAY.getTime() + 8*3600000 + 45*60000),
    calledTime: new Date(TODAY.getTime() + 8*3600000 + 55*60000),
    consultationStartTime: new Date(TODAY.getTime() + 9*3600000),
    estimatedWaitMinutes: 0, avgConsultationMinutes: 20,
    queueDate: qDate
  });

  await upsertQueueEntry({
    patient: p2._id, doctor: drSilva._id, appointment: tA8?._id || null,
    checkedInBy: recKasun._id,
    room: 'Room 02', department: 'Cardiology',
    tokenType: 'A', queueNumber: 'A002', sequenceNumber: 2,
    zone: 'WAITING_POOL', status: 'waiting', sortOrder: 2,
    isLocked: false, patientsAheadCount: 1,
    priority: 'urgent', priorityScore: 50,
    appointmentTime: '09:30',
    checkInTime: new Date(TODAY.getTime() + 9*3600000 + 5*60000),
    estimatedWaitMinutes: 20, avgConsultationMinutes: 20,
    queueDate: qDate
  });

  if (qe7 && !sessionSilva.currentQueueEntryId) {
    await DoctorQueueSession.findByIdAndUpdate(sessionSilva._id, { currentQueueEntryId: qe7._id });
  }

  // Dr. Fernando queue entries (queue paused)
  await upsertQueueEntry({
    patient: p8._id, doctor: drFernando._id, appointment: tA9?._id || null,
    checkedInBy: recAyesha._id,
    room: 'Room 03', department: 'Pediatrics',
    tokenType: 'A', queueNumber: 'A001', sequenceNumber: 1,
    zone: 'WAITING_POOL', status: 'waiting', sortOrder: 1,
    isLocked: false, patientsAheadCount: 0,
    priority: 'normal', priorityScore: 100,
    appointmentTime: '09:00',
    checkInTime: new Date(TODAY.getTime() + 8*3600000 + 50*60000),
    estimatedWaitMinutes: 20, avgConsultationMinutes: 20,
    queueDate: qDate
  });

  // ── 7. Future appointments (next 7 days) ────────────────────────────────────
  console.log('\n📆 Future appointments...');

  const futureAppts = [
    { patient: p1._id, doctor: drPerera._id, appointmentDate: apptDate(daysAhead(2)), appointmentTime: '09:00', appointmentType: 'follow-up',    status: 'scheduled', chiefComplaint: 'BP medication review', duration: 20 },
    { patient: p2._id, doctor: drSilva._id,  appointmentDate: apptDate(daysAhead(3)), appointmentTime: '10:00', appointmentType: 'follow-up',    status: 'scheduled', chiefComplaint: 'Lipid profile review and angina assessment', duration: 30 },
    { patient: p3._id, doctor: drPerera._id, appointmentDate: apptDate(daysAhead(4)), appointmentTime: '10:30', appointmentType: 'consultation', status: 'scheduled', chiefComplaint: 'Lower back pain', duration: 30 },
    { patient: p5._id, doctor: drFernando._id,appointmentDate: apptDate(daysAhead(5)), appointmentTime: '09:00', appointmentType: 'check-up',    status: 'scheduled', chiefComplaint: 'Annual health check-up', duration: 30 },
    { patient: p6._id, doctor: drSilva._id,  appointmentDate: apptDate(daysAhead(7)), appointmentTime: '09:30', appointmentType: 'follow-up',    status: 'scheduled', chiefComplaint: 'Cardiac review and ECG', duration: 30 },
    { patient: p7._id, doctor: drPerera._id, appointmentDate: apptDate(daysAhead(1)), appointmentTime: '11:00', appointmentType: 'follow-up',    status: 'scheduled', chiefComplaint: 'Migraine treatment follow-up', duration: 20 },
    { patient: p4._id, doctor: drPerera._id, appointmentDate: apptDate(daysAhead(6)), appointmentTime: '09:00', appointmentType: 'follow-up',    status: 'confirmed', chiefComplaint: 'Asthma review', duration: 20 },
    { patient: p8._id, doctor: drFernando._id,appointmentDate: apptDate(daysAhead(2)), appointmentTime: '10:00', appointmentType: 'follow-up',   status: 'scheduled', chiefComplaint: 'Post-varicella check', duration: 15 },
  ];

  for (const doc of futureAppts) {
    const existing = await Appointment.findOne({
      patient: doc.patient, doctor: doc.doctor,
      appointmentDate: doc.appointmentDate, appointmentTime: doc.appointmentTime
    });
    if (existing) { console.log(`  ↩  Future appt exists`); continue; }
    await insertAppt(doc);
    console.log(`  ✅ Future appt [${doc.status}]: ${dateStr(doc.appointmentDate)} ${doc.appointmentTime}`);
  }

  // ── 8. Medical Records ──────────────────────────────────────────────────────
  console.log('\n📋 Medical Records...');

  const medRecordDefs = [
    {
      patient: p1._id, doctor: drPerera._id,
      createdBy: drPerera._id, recordType: 'diagnosis',
      title: 'Hypertension Diagnosis and Management Plan',
      description: 'Patient diagnosed with Stage 1 Hypertension. Started on Amlodipine 5mg OD. DASH diet and lifestyle modifications advised.',
      diagnosis: { primary: 'Essential Hypertension', secondary: [], icd10Codes: ['I10'], severity: 'moderate' },
      treatmentPlan: 'Amlodipine 5mg OD for 3 months. Monthly BP monitoring. Low sodium diet. Moderate aerobic exercise 30 min/day. Avoid stress.',
      vitalSigns: { bloodPressure: { systolic: 158, diastolic: 95 }, heartRate: 82, temperature: 36.8, weight: 62, height: 162 },
      followUp: { required: true, date: daysAhead(30), instructions: 'Return for BP review and medication assessment' },
      createdAt: daysAgo(25), updatedAt: daysAgo(25)
    },
    {
      patient: p1._id, doctor: drPerera._id,
      createdBy: drPerera._id, recordType: 'prescription',
      title: 'Prescription – Hypertension Medication',
      description: 'Amlodipine 5mg prescribed for blood pressure control.',
      prescriptions: [{ medication: 'Amlodipine 5mg', dosage: '5mg', frequency: 'Once daily in the morning', duration: '30 days', instructions: 'Take with or without food' }],
      createdAt: daysAgo(25), updatedAt: daysAgo(25)
    },
    {
      patient: p2._id, doctor: drSilva._id,
      createdBy: drSilva._id, recordType: 'diagnosis',
      title: 'Stable Angina and Hyperlipidemia Management',
      description: 'Patient presents with exertional chest pain. ECG shows lateral ST changes during stress test. Diagnosed with stable angina and hyperlipidemia.',
      diagnosis: { primary: 'Stable Angina Pectoris', secondary: ['Hyperlipidemia'], icd10Codes: ['I20.9', 'E78.5'], severity: 'high' },
      treatmentPlan: 'Aspirin 75mg OD, Atorvastatin 20mg ON, GTN spray PRN. Cardiac catheterization scheduled. Regular exercise within limits. Low fat diet.',
      vitalSigns: { bloodPressure: { systolic: 145, diastolic: 88 }, heartRate: 88, temperature: 36.9, weight: 85, height: 172 },
      labTests: [{ testName: 'Lipid Profile', orderedDate: daysAgo(22), priority: 'routine', status: 'completed' }, { testName: 'ECG Stress Test', orderedDate: daysAgo(22), priority: 'urgent', status: 'completed' }],
      followUp: { required: true, date: daysAhead(14), instructions: 'Review cardiac catheterization results' },
      createdAt: daysAgo(22), updatedAt: daysAgo(22)
    },
    {
      patient: p4._id, doctor: drPerera._id,
      createdBy: drPerera._id, recordType: 'diagnosis',
      title: 'Acute Asthma Exacerbation',
      description: 'Patient presented with acute bronchospasm. Mild to moderate exacerbation. Responded well to bronchodilator therapy.',
      diagnosis: { primary: 'Bronchial Asthma – Acute Exacerbation', secondary: [], icd10Codes: ['J45.901'], severity: 'moderate' },
      treatmentPlan: 'Salbutamol inhaler 2 puffs PRN, Budesonide inhaler 2 puffs BD. Avoid known triggers (dust, smoke, cold air). Peak flow monitoring.',
      vitalSigns: { bloodPressure: { systolic: 128, diastolic: 78 }, heartRate: 98, temperature: 37.1, weight: 78, height: 175, oxygenSaturation: 94 },
      createdAt: daysAgo(18), updatedAt: daysAgo(18)
    },
    {
      patient: p6._id, doctor: drSilva._id,
      createdBy: drSilva._id, recordType: 'diagnosis',
      title: 'Post-MI Cardiac Review – Stable',
      description: 'Patient recovering well following myocardial infarction 3 months ago. Current medications effective. Echo shows preserved ejection fraction.',
      diagnosis: { primary: 'Post-Myocardial Infarction – Stable', secondary: ['Hypertension', 'Dyslipidemia'], icd10Codes: ['I25.2', 'I10', 'E78.5'], severity: 'high' },
      treatmentPlan: 'Continue Atorvastatin 40mg ON, Metoprolol 50mg BD, Aspirin 75mg OD. Cardiac rehabilitation programme. Graded return to activity.',
      vitalSigns: { bloodPressure: { systolic: 128, diastolic: 80 }, heartRate: 68, temperature: 36.7, weight: 80, height: 170, oxygenSaturation: 98 },
      followUp: { required: true, date: daysAhead(90), instructions: '3-month cardiac review with repeat Echo' },
      createdAt: daysAgo(14), updatedAt: daysAgo(14)
    },
    {
      patient: p8._id, doctor: drFernando._id,
      createdBy: drFernando._id, recordType: 'diagnosis',
      title: 'Varicella (Chickenpox) – Diagnosis and Management',
      description: 'Child presents with characteristic vesicular rash in various stages, fever, malaise. Classic varicella confirmed.',
      diagnosis: { primary: 'Varicella Zoster – Uncomplicated', secondary: [], icd10Codes: ['B01.9'], severity: 'mild' },
      treatmentPlan: 'Symptomatic treatment. Calamine lotion for itch. Paracetamol for fever. Home isolation 7 days or until all lesions crusted.',
      vitalSigns: { temperature: 38.4, heartRate: 110, weight: 28, height: 125 },
      createdAt: daysAgo(20), updatedAt: daysAgo(20)
    }
  ];

  for (const rec of medRecordDefs) {
    const existing = await MedicalRecord.findOne({ patient: rec.patient, title: rec.title });
    if (existing) { console.log(`  ↩  Medical record exists: ${rec.title.slice(0,40)}`); continue; }
    await MedicalRecord.collection.insertOne(rec);
    console.log(`  ✅ Medical record: ${rec.title.slice(0, 50)}`);
  }

  // ── 9. Prescriptions ────────────────────────────────────────────────────────
  console.log('\n💊 Prescriptions...');

  const rxDefs = [
    {
      patient: p1._id, doctor: drPerera._id,
      prescriptionNumber: makeRxNum(),
      diagnosis: 'Essential Hypertension', indication: 'Blood pressure control',
      medications: [{ drugName: 'Amlodipine', genericName: 'Amlodipine Besylate', strength: '5mg', dosageForm: 'tablet', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', quantity: 30, instructions: 'Take in the morning', allergyChecked: true, interactionChecked: true }],
      status: 'active',
      safetyChecks: { allergyCheck: { performed: true, result: 'safe' }, interactionCheck: { performed: true, result: 'safe' } },
      electronicSignature: { signed: true, signedAt: daysAgo(25), signatureMethod: 'password' },
      prescribedDate: daysAgo(25),
      expiryDate: daysAhead(340),
      createdAt: daysAgo(25), updatedAt: daysAgo(25)
    },
    {
      patient: p2._id, doctor: drSilva._id,
      prescriptionNumber: makeRxNum(),
      diagnosis: 'Stable Angina, Hyperlipidemia', indication: 'Cardiovascular risk reduction and angina management',
      medications: [
        { drugName: 'Aspirin', genericName: 'Acetylsalicylic Acid', strength: '75mg', dosageForm: 'tablet', dosage: '1 tablet', frequency: 'Once daily', duration: '90 days', quantity: 90, instructions: 'Take with food', allergyChecked: true, interactionChecked: true },
        { drugName: 'Atorvastatin', genericName: 'Atorvastatin Calcium', strength: '20mg', dosageForm: 'tablet', dosage: '1 tablet', frequency: 'Once daily at bedtime', duration: '90 days', quantity: 90, instructions: 'Avoid grapefruit juice', allergyChecked: true, interactionChecked: true },
        { drugName: 'GTN Spray', genericName: 'Glyceryl Trinitrate', strength: '0.4mg/dose', dosageForm: 'inhaler', dosage: '1-2 sprays sublingual', frequency: 'PRN for chest pain', duration: '90 days', quantity: 1, instructions: 'Sit down before use. Seek emergency care if pain persists after 3 doses', allergyChecked: true, interactionChecked: true }
      ],
      status: 'active',
      electronicSignature: { signed: true, signedAt: daysAgo(22), signatureMethod: 'password' },
      prescribedDate: daysAgo(22),
      expiryDate: daysAhead(340),
      createdAt: daysAgo(22), updatedAt: daysAgo(22)
    },
    {
      patient: p4._id, doctor: drPerera._id,
      prescriptionNumber: makeRxNum(),
      diagnosis: 'Bronchial Asthma – Acute Exacerbation', indication: 'Bronchodilation and anti-inflammatory control',
      medications: [
        { drugName: 'Salbutamol Inhaler', genericName: 'Salbutamol Sulfate', strength: '100mcg/dose', dosageForm: 'inhaler', dosage: '2 puffs', frequency: 'PRN up to QID', duration: '30 days', quantity: 1, instructions: 'Shake before use. Rinse mouth after use.', allergyChecked: true, interactionChecked: true },
        { drugName: 'Budesonide Inhaler', genericName: 'Budesonide', strength: '200mcg/dose', dosageForm: 'inhaler', dosage: '2 puffs', frequency: 'Twice daily', duration: '30 days', quantity: 1, instructions: 'Morning and evening. Rinse mouth after use.', allergyChecked: true, interactionChecked: true }
      ],
      status: 'active',
      electronicSignature: { signed: true, signedAt: daysAgo(18), signatureMethod: 'password' },
      prescribedDate: daysAgo(18),
      expiryDate: daysAhead(340),
      createdAt: daysAgo(18), updatedAt: daysAgo(18)
    },
    {
      patient: p6._id, doctor: drSilva._id,
      prescriptionNumber: makeRxNum(),
      diagnosis: 'Ischemic Heart Disease, Hypertension', indication: 'Secondary prevention post-MI',
      medications: [
        { drugName: 'Atorvastatin', genericName: 'Atorvastatin Calcium', strength: '40mg', dosageForm: 'tablet', dosage: '1 tablet', frequency: 'Once daily at bedtime', duration: '90 days', quantity: 90, instructions: 'Do not stop without consulting doctor', allergyChecked: true, interactionChecked: true },
        { drugName: 'Metoprolol', genericName: 'Metoprolol Tartrate', strength: '50mg', dosageForm: 'tablet', dosage: '1 tablet', frequency: 'Twice daily', duration: '90 days', quantity: 180, instructions: 'Do not stop abruptly', allergyChecked: true, interactionChecked: true },
        { drugName: 'Aspirin', genericName: 'Acetylsalicylic Acid', strength: '75mg', dosageForm: 'tablet', dosage: '1 tablet', frequency: 'Once daily', duration: '90 days', quantity: 90, instructions: 'Take with food', allergyChecked: true, interactionChecked: true }
      ],
      status: 'active',
      electronicSignature: { signed: true, signedAt: daysAgo(14), signatureMethod: 'password' },
      prescribedDate: daysAgo(14),
      expiryDate: daysAhead(340),
      createdAt: daysAgo(14), updatedAt: daysAgo(14)
    }
  ];

  for (const rx of rxDefs) {
    const existing = await Prescription.findOne({ patient: rx.patient, doctor: rx.doctor, diagnosis: rx.diagnosis });
    if (existing) { console.log(`  ↩  Prescription exists`); continue; }
    await Prescription.collection.insertOne(rx);
    console.log(`  ✅ Prescription [${rx.prescriptionNumber}]: ${rx.diagnosis.slice(0,40)}`);
  }

  // ── 10. Consultation records ────────────────────────────────────────────────
  console.log('\n🩺 Consultation records...');

  // Active consultation for Nimali (qe1)
  if (qe1) {
    const cEx = await Consultation.findOne({ queueEntry: qe1._id });
    if (!cEx) {
      await Consultation.create({
        queueEntry: qe1._id,
        appointment: tA1?._id || null,
        doctor: drPerera._id, patient: p1._id,
        queueDate: qDate,
        startedAt: new Date(TODAY.getTime() + 8*3600000 + 35*60000),
        status: 'in_progress',
        notes: 'Patient presenting for hypertension follow-up. BP has improved significantly on Amlodipine. Reviewing medication compliance and lifestyle changes.'
      });
      console.log('  ✅ Active consultation: Nimali ↔ Dr.Perera');
    } else { console.log('  ↩  Consultation exists: Nimali'); }
  }

  // Active consultation for Ruwan (qe7)
  if (qe7) {
    const cEx2 = await Consultation.findOne({ queueEntry: qe7._id });
    if (!cEx2) {
      await Consultation.create({
        queueEntry: qe7._id,
        appointment: tA7?._id || null,
        doctor: drSilva._id, patient: p6._id,
        queueDate: qDate,
        startedAt: new Date(TODAY.getTime() + 9*3600000),
        status: 'in_progress',
        notes: 'Post-MI review. Patient reports good tolerance to medications. No chest pain episodes. Reviewing ECG and discussing cardiac rehab program.'
      });
      console.log('  ✅ Active consultation: Ruwan ↔ Dr.Silva');
    } else { console.log('  ↩  Consultation exists: Ruwan'); }
  }

  // ── 11. Notifications ───────────────────────────────────────────────────────
  console.log('\n🔔 Notifications...');

  const notifDefs = [
    {
      recipient: p1._id,
      type: 'appointment-reminder',
      title: 'Appointment Reminder – Tomorrow',
      message: `You have an appointment with Dr. Perera (General Medicine) on ${dateStr(daysAhead(2))} at 09:00. Please arrive 15 minutes early.`,
      isRead: false, createdAt: daysAgo(1), updatedAt: daysAgo(1)
    },
    {
      recipient: p2._id,
      type: 'appointment-reminder',
      title: 'Upcoming Cardiology Appointment',
      message: `Reminder: Cardiology follow-up with Dr. Silva on ${dateStr(daysAhead(3))} at 10:00. Please bring your latest blood reports.`,
      isRead: false, createdAt: new Date(), updatedAt: new Date()
    },
    {
      recipient: p4._id,
      type: 'appointment-reminder',
      title: 'Asthma Review Appointment Confirmed',
      message: `Your appointment with Dr. Perera on ${dateStr(daysAhead(6))} at 09:00 is confirmed. Please bring your peak flow diary.`,
      isRead: true, readAt: daysAgo(1), createdAt: daysAgo(2), updatedAt: daysAgo(1)
    },
    {
      recipient: p6._id,
      type: 'appointment-reminder',
      title: 'Cardiac Follow-up Reminder',
      message: `Your cardiac review with Dr. Silva is scheduled for ${dateStr(daysAhead(7))} at 09:30. Please ensure you have taken your morning medications.`,
      isRead: false, createdAt: new Date(), updatedAt: new Date()
    },
    {
      recipient: p3._id,
      type: 'system',
      title: 'Identity Verification Pending',
      message: 'Your identity verification is currently under review. Please visit the registration desk with your NIC to expedite the process.',
      isRead: false, createdAt: daysAgo(3), updatedAt: daysAgo(3)
    },
    {
      recipient: p6._id,
      type: 'appointment-reminder',
      title: 'Queue Update – You are next',
      message: 'You have been called to Room 02. Please proceed to Dr. Silva\'s consultation room now.',
      isRead: true, readAt: new Date(TODAY.getTime() + 8*3600000 + 55*60000),
      createdAt: new Date(TODAY.getTime() + 8*3600000 + 55*60000),
      updatedAt: new Date(TODAY.getTime() + 8*3600000 + 55*60000)
    }
  ];

  for (const n of notifDefs) {
    const ex = await Notification.findOne({ recipient: n.recipient, title: n.title });
    if (ex) { console.log(`  ↩  Notification exists`); continue; }
    await Notification.create(n);
    console.log(`  ✅ Notification → ${n.title.slice(0, 50)}`);
  }

  // ── 10. Departments ──────────────────────────────────────────────────────────
  console.log('\n🏥 Departments...');

  const DEPT_DEFS = [
    { name: 'General OPD',    code: 'OPD',     description: 'General outpatient department', averageConsultationMinutes: 10 },
    { name: 'Cardiology',     code: 'CARDIO',  description: 'Heart and cardiovascular care',  averageConsultationMinutes: 20 },
    { name: 'Pediatrics',     code: 'PEDS',    description: 'Child health and development',   averageConsultationMinutes: 15 },
    { name: 'Orthopedics',    code: 'ORTHO',   description: 'Bone and joint care',            averageConsultationMinutes: 20 },
    { name: 'Neurology',      code: 'NEURO',   description: 'Brain and nervous system',       averageConsultationMinutes: 25 },
    { name: 'Dermatology',    code: 'DERM',    description: 'Skin conditions and treatment',  averageConsultationMinutes: 12 },
    { name: 'Ophthalmology',  code: 'OPHTHAL', description: 'Eye care and treatment',         averageConsultationMinutes: 15 },
    { name: 'ENT',            code: 'ENT',     description: 'Ear, nose and throat',           averageConsultationMinutes: 12 },
  ];

  const deptMap = {}; // code → Department document
  for (const def of DEPT_DEFS) {
    let dept = await Department.findOne({ code: def.code });
    if (!dept) {
      dept = await Department.create({ ...def, status: 'active', createdBy: admin._id });
      console.log(`  ✅ Department: ${dept.name} (${dept.code})`);
    } else {
      console.log(`  ↩  Department exists: ${dept.code}`);
    }
    deptMap[def.code] = dept;
  }

  // ── 11. Global Queue Policy ───────────────────────────────────────────────────
  console.log('\n⚙️  Queue Policy...');
  const existingPolicy = await QueuePolicy.findOne({ doctorId: null, departmentId: null });
  if (!existingPolicy) {
    await QueuePolicy.create({
      doctorId: null,
      departmentId: null,
      earlyCheckInMinutes: 30,
      gracePeriodMinutes: 15,
      readyZoneSize: 3,
      averageConsultationMinutes: 10,
      walkInPriorityRule: 'after_appointments',
      lateArrivalRule: 'end_of_pool',
      lateArrivalInsertionRule: 'next_after_current',
      latePenaltyPositions: 5,
      emergencyOverrideAllowed: true,
      sessionAutoCloseMinutes: 0,
      appointmentCapacityPercentage: 65,
      walkInCapacityPercentage: 25,
      emergencyBufferPercentage: 5,
      tokenScope: 'dept_date_session',
      noShowCutoffMinutes: 0
    });
    console.log('  ✅ Global queue policy created');
  } else {
    console.log('  ↩  Global policy exists');
  }

  // ── 12. Time Blocks (next 14 days for OPD, Cardiology, Pediatrics) ───────────
  console.log('\n🕐 Time Blocks...');

  // Block templates per department
  const BLOCK_TEMPLATES = {
    OPD: [
      { startTime: '08:00', endTime: '09:00', sessionName: 'Block 1 (Morning Early)',  totalCapacity: 30, reportingOffsetMinutes: 15 },
      { startTime: '09:00', endTime: '10:00', sessionName: 'Block 2 (Morning)',         totalCapacity: 30, reportingOffsetMinutes: 15 },
      { startTime: '10:00', endTime: '11:00', sessionName: 'Block 3 (Mid-Morning)',     totalCapacity: 30, reportingOffsetMinutes: 15 },
      { startTime: '14:00', endTime: '15:00', sessionName: 'Block 4 (Afternoon)',       totalCapacity: 25, reportingOffsetMinutes: 15 },
      { startTime: '15:00', endTime: '16:00', sessionName: 'Block 5 (Late Afternoon)',  totalCapacity: 25, reportingOffsetMinutes: 15 },
    ],
    CARDIO: [
      { startTime: '09:00', endTime: '10:00', sessionName: 'Morning Session',           totalCapacity: 12, reportingOffsetMinutes: 15 },
      { startTime: '10:00', endTime: '11:00', sessionName: 'Mid-Morning Session',       totalCapacity: 12, reportingOffsetMinutes: 15 },
      { startTime: '14:00', endTime: '15:30', sessionName: 'Afternoon Session',         totalCapacity: 12, reportingOffsetMinutes: 15 },
    ],
    PEDS: [
      { startTime: '08:30', endTime: '09:30', sessionName: 'Morning Block',             totalCapacity: 15, reportingOffsetMinutes: 15 },
      { startTime: '09:30', endTime: '10:30', sessionName: 'Late Morning Block',        totalCapacity: 15, reportingOffsetMinutes: 15 },
      { startTime: '13:30', endTime: '14:30', sessionName: 'Afternoon Block',           totalCapacity: 15, reportingOffsetMinutes: 15 },
    ],
  };

  const CAPACITY_POLICY = {
    appointmentCapacityPercentage: 65,
    walkInCapacityPercentage: 25,
    emergencyBufferPercentage: 5
  };

  let blocksCreated = 0;
  let blocksSkipped = 0;

  for (const [code, templates] of Object.entries(BLOCK_TEMPLATES)) {
    const dept = deptMap[code];
    if (!dept) continue;

    // Generate blocks for today through next 14 days
    for (let i = 0; i <= 14; i++) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() + i);
      const dateStr2 = d.toISOString().slice(0, 10);

      for (const tpl of templates) {
        const exists = await TimeBlock.findOne({
          departmentId: dept._id,
          doctorId: null,
          date: dateStr2,
          startTime: tpl.startTime
        });
        if (exists) { blocksSkipped++; continue; }

        const apptCap  = Math.floor(tpl.totalCapacity * CAPACITY_POLICY.appointmentCapacityPercentage / 100);
        const walkCap  = Math.floor(tpl.totalCapacity * CAPACITY_POLICY.walkInCapacityPercentage / 100);
        const emergBuf = Math.floor(tpl.totalCapacity * CAPACITY_POLICY.emergencyBufferPercentage / 100);
        const opBuf    = Math.max(0, tpl.totalCapacity - apptCap - walkCap - emergBuf);

        await TimeBlock.create({
          departmentId:            dept._id,
          doctorId:                null,
          date:                    dateStr2,
          startTime:               tpl.startTime,
          endTime:                 tpl.endTime,
          sessionName:             tpl.sessionName,
          totalCapacity:           tpl.totalCapacity,
          appointmentCapacity:     apptCap,
          walkInCapacity:          walkCap,
          emergencyBuffer:         emergBuf,
          operationalBuffer:       opBuf,
          reportingOffsetMinutes:  tpl.reportingOffsetMinutes,
          status:                  'active',
          createdBy:               admin._id
        });
        blocksCreated++;
      }
    }
    console.log(`  ✅ ${code}: blocks created/verified for 15 days`);
  }

  console.log(`  📊 Total: ${blocksCreated} new blocks, ${blocksSkipped} already existed`);

  // ── Done ─────────────────────────────────────────────────────────────────────
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  MediQueue Demo Seed Complete — All accounts use the same password');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  PASSWORD FOR ALL ACCOUNTS:  ${DEMO_PASSWORD}`);
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  ROLE          EMAIL                          ');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  Admin         admin@mediqueue.lk             ');
  console.log('  Receptionist  receptionist@mediqueue.lk      ');
  console.log('  Receptionist  receptionist2@mediqueue.lk     ');
  console.log('  Doctor        dr.perera@mediqueue.lk         (General Medicine)');
  console.log('  Doctor        dr.silva@mediqueue.lk          (Cardiology)');
  console.log('  Doctor        dr.fernando@mediqueue.lk       (Pediatrics)');
  console.log('  Patient       patient1@mediqueue.lk          (Nimali – IN CONSULTATION)');
  console.log('  Patient       patient2@mediqueue.lk          (Chamara – Checked In)');
  console.log('  Patient       patient3@mediqueue.lk          (Sashini – Waiting #4)');
  console.log('  Patient       patient4@mediqueue.lk          (Lahiru – Called #2)');
  console.log('  Patient       patient5@mediqueue.lk          (Madhavi – Scheduled)');
  console.log('  Patient       patient6@mediqueue.lk          (Ruwan – IN CONSULTATION)');
  console.log('  Patient       patient7@mediqueue.lk          (Dilani – Waiting #3)');
  console.log('  Patient       patient8@mediqueue.lk          (Ashan – Pediatrics)');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  QUEUE STATE (General OPD – Dr. Perera):');
  console.log('    A001  Nimali Kumari       → CURRENT / in_consultation');
  console.log('    A002  Lahiru Rajapaksha   → READY   / called');
  console.log('    A003  Dilani Jayasinghe   → READY   / waiting');
  console.log('    A004  Sashini Wickramasinghe → WAITING_POOL / waiting');
  console.log('    W001  (walk-in)           → COMPLETED');
  console.log('');
  console.log('  QUEUE STATE (Cardiology – Dr. Silva):');
  console.log('    A001  Ruwan Mendis        → CURRENT / in_consultation');
  console.log('    A002  Chamara Dissanayake → WAITING_POOL / waiting [urgent]');
  console.log('');
  console.log('  QUEUE STATE (Pediatrics – Dr. Fernando):  ⏸ PAUSED');
  console.log('    A001  Ashan Weerasinghe   → WAITING_POOL / waiting');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  App:    http://localhost:3000');
  console.log('  Server: http://localhost:5000');
  console.log('  Queue:  http://localhost:3000/display');
  console.log('═══════════════════════════════════════════════════════════════════');

  await mongoose.disconnect();
};

seed().catch(err => {
  console.error('❌ Seed failed:', err.message, err.stack);
  mongoose.disconnect();
  process.exit(1);
});
