const express = require('express');
const router = express.Router();

// Import middleware
const auth = require('../middleware/auth');
const requireVerifiedCredentials = require('../middleware/requireVerifiedCredentials');
const {
  validatePatientSearch,
  validatePatientId,
  validateRecordId,
  validateTreatmentNote,
  validateTreatmentNoteUpdate,
  validateAvailability,
  validateDoctorRole,
  sanitizeInput
} = require('../middleware/doctorValidation');

// Import controller
const DoctorController = require('../controllers/DoctorController');

// Doctor routes - all require auth + doctor role

// Middleware for all doctor routes
router.use(auth);
router.use(validateDoctorRole);
router.use(requireVerifiedCredentials); // block until admin verifies credentials
router.use(sanitizeInput);

// Patient search and access

// GET /api/doctor/patients/search - search patients with filters
router.get('/patients/search',
  validatePatientSearch,
  DoctorController.searchPatients
);

// Get recent patients for quick access
// GET /api/doctor/patients/recent?limit=10
router.get('/patients/recent',
  DoctorController.getRecentPatients
);

// Get patient management dashboard
// GET /api/doctor/patients/dashboard
router.get('/patients/dashboard',
  DoctorController.getPatientDashboard
);

// Get patient list with enhanced filtering
// GET /api/doctor/patients/list?searchQuery=John&gender=male&page=1&limit=25
router.get('/patients/list',
  DoctorController.getPatientList
);

// Get comprehensive patient profile (replaces medical records tab)
// GET /api/doctor/patients/:patientId/profile
router.get('/patients/:patientId/profile',
  validatePatientId,
  DoctorController.getPatientProfile
);

// GET /api/doctor/patients/:patientId/medical-history - full history (old endpoint)
router.get('/patients/:patientId/medical-history',
  validatePatientId,
  DoctorController.getPatientMedicalHistory
);

// Treatment notes

// POST /api/doctor/patients/:patientId/treatment-notes - add a note
router.post('/patients/:patientId/treatment-notes',
  validatePatientId,
  validateTreatmentNote,
  DoctorController.addTreatmentNote
);

// PUT /api/doctor/treatment-notes/:recordId - update a note
router.put('/treatment-notes/:recordId',
  validateRecordId,
  validateTreatmentNoteUpdate,
  DoctorController.updateTreatmentNote
);

// Schedule

// GET /api/doctor/schedule - schedule and upcoming appointments
router.get('/schedule',
  DoctorController.getSchedule
);

// PUT /api/doctor/availability - update availability
router.put('/availability',
  validateAvailability,
  DoctorController.updateAvailability
);

// Slots

// Get doctor's slots for specific date(s)
// GET /api/doctor/slots?startDate=2024-01-15&endDate=2024-01-15
router.get('/slots',
  DoctorController.getSlots
);

// Create new time slots
// POST /api/doctor/slots
router.post('/slots',
  DoctorController.createSlots
);

// Block specific slots (make unavailable)
// POST /api/doctor/slots/block
router.post('/slots/block',
  DoctorController.blockSlots
);

// Unblock previously blocked slots
// POST /api/doctor/slots/unblock
router.post('/slots/unblock',
  DoctorController.unblockSlots
);

// Quick block slots for time range (emergency)
// POST /api/doctor/slots/quick-block
router.post('/slots/quick-block',
  DoctorController.quickBlockSlots
);

// Get today's schedule with slot details
// GET /api/doctor/slots/today
router.get('/slots/today',
  DoctorController.getTodaySchedule
);

// Get available slots for patient booking (public)
// GET /api/doctor/slots/available?doctorId=123&date=2024-01-15
router.get('/slots/available',
  DoctorController.getAvailableSlots
);

// Dashboard

// Get doctor's dashboard summary
// GET /api/doctor/dashboard
router.get('/dashboard',
  DoctorController.getDashboard
);

// Error handling for this router
router.use((error, req, res, next) => {
  console.error('Doctor router error:', error);

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(error.errors).map(err => err.message)
    });
  }
  
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }
  
  // Default error response
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

module.exports = router;
