const mongoose = require('mongoose');

const dispenseSchema = new mongoose.Schema({
  prescription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prescription',
    required: true,
    index: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  dispensedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Snapshot of what was actually issued
  itemsDispensed: [{
    drugName:    { type: String, required: true },
    strength:    String,
    dosageForm:  String,
    quantity:    { type: Number, required: true },
    batchNumber: String,
    notes:       String
  }],

  dispensedAt: {
    type: Date,
    default: Date.now
  },

  notes: {
    type: String,
    maxlength: 500
  }
}, {
  timestamps: true
});

dispenseSchema.index({ prescription: 1, dispensedAt: -1 });
dispenseSchema.index({ patient: 1, dispensedAt: -1 });

module.exports = mongoose.model('Dispense', dispenseSchema);
