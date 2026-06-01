const mongoose = require('mongoose');
const QRCode = require('qrcode');

mongoose.connect('mongodb+srv://pathinayakepud22_db_user:Piyu123@cluster0.3unpknk.mongodb.net/')
  .then(async () => {
    const HealthCard = require('../models/HealthCard');
    const User = require('../models/User');

    const cards = await HealthCard.find().populate('patient');
    for (let card of cards) {
      if (!card.patient) continue;

      const qrData = {
        cardNumber: card.cardNumber,
        patientId: card.patient._id.toString(),
        name: `${card.patient.firstName} ${card.patient.lastName}`,
        dob: card.patient.dateOfBirth ? new Date(card.patient.dateOfBirth).toISOString().split('T')[0] : 'N/A',
        bloodGroup: card.bloodGroup || card.patient.bloodType || 'Unknown',
        allergies: card.patient.allergies?.length ? card.patient.allergies.map(a => typeof a === 'string' ? a : a.allergen).join(', ') : 'None',
        emergencyContact: card.patient.emergencyContact?.phone || card.patient.phone || 'Not provided'
      };

      card.qrCode = await QRCode.toDataURL(JSON.stringify(qrData));
      await card.save();
    }
    console.log('Successfully updated', cards.length, 'QR codes!');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
