const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const User = require('./models/User');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/mediqueue', { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Connected");

  // find any patient with appointments
  const appts = await Appointment.find({}).sort({ createdAt: -1 }).limit(10);
  console.log("Sample appointments:");
  for (const a of appts) {
    console.log(`- ${a._id}: patient=${a.patient}, date=${a.appointmentDate}, status=${a.status}`);
  }

  mongoose.disconnect();
}
run();
