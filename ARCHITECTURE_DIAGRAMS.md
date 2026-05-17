# 🏗️ MediQueue System Architecture Diagram

**Visual guide to understand the system structure**

---

## 📐 SYSTEM OVERVIEW

```
┌─────────────────────────────────────────────────────────────────┐
│                         USERS                                    │
│  👤 Patient  👨‍⚕️ Doctor  📝 Receptionist  📊 Manager  🔐 Admin   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FRONTEND (React.js)                             │
│                  Port: 3000                                      │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │   Pages        │  │  Components    │  │   Services       │  │
│  │  - Login       │  │  - Dashboard   │  │  - API calls     │  │
│  │  - Booking     │  │  - Forms       │  │  - Axios         │  │
│  │  - Dashboard   │  │  - Cards       │  │  - JWT storage   │  │
│  └────────────────┘  └────────────────┘  └──────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         Hooks (useAuth, useAppointments, etc.)             │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────────┘
                                │ HTTP Requests (Axios)
                                │ Authorization: Bearer <JWT>
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  BACKEND (Node.js + Express)                     │
│                  Port: 5000                                      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              MIDDLEWARE LAYER                             │  │
│  │  ┌──────────┐  ┌───────────┐  ┌────────────────────┐    │  │
│  │  │   Auth   │→ │ Authorize │→ │   Error Handler    │    │  │
│  │  │  (JWT)   │  │  (Roles)  │  │  (Try-Catch)       │    │  │
│  │  └──────────┘  └───────────┘  └────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  ROUTES (API Endpoints)                   │  │
│  │  /api/auth           - Login, Register, Token           │  │
│  │  /api/users          - User CRUD operations             │  │
│  │  /api/appointments   - Booking, View, Cancel            │  │
│  │  /api/medical-records - Patient records                 │  │
│  │  /api/prescriptions  - Medication orders               │  │
│  │  /api/doctor         - Doctor-specific operations       │  │
│  │  /api/manager        - Reports & Analytics              │  │
│  │  /api/health-cards   - Digital health cards             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                               ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   CONTROLLERS                             │  │
│  │  - Receives HTTP requests                                │  │
│  │  - Validates input                                       │  │
│  │  - Calls appropriate service                             │  │
│  │  - Returns HTTP response                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                               ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    SERVICES (Business Logic)              │  │
│  │  - AppointmentBookingService                             │  │
│  │  - DoctorService                                         │  │
│  │  - PatientAuthService                                    │  │
│  │  - ManagerService                                        │  │
│  │  - SlotManagementService                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                               ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   REPOSITORIES (Data Access)              │  │
│  │  - UserRepository                                        │  │
│  │  - AppointmentRepository                                 │  │
│  │  - MedicalRecordRepository                               │  │
│  │  - Mongoose queries & aggregations                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE (MongoDB)                            │
│                    Port: 27017                                   │
│                                                                   │
│  Collections:                                                    │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐         │
│  │   users     │ │ appointments │ │ medicalrecords   │         │
│  └─────────────┘ └──────────────┘ └──────────────────┘         │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐         │
│  │prescriptions│ │ healthcards  │ │  doctorslots     │         │
│  └─────────────┘ └──────────────┘ └──────────────────┘         │
│  ┌─────────────┐ ┌──────────────┐                               │
│  │   reports   │ │  auditlogs   │                               │
│  └─────────────┘ └──────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔐 AUTHENTICATION FLOW

```
┌──────────┐                                  ┌──────────┐
│  Client  │                                  │  Server  │
└─────┬────┘                                  └────┬─────┘
      │                                            │
      │  1. POST /api/auth/login                  │
      │     { email, password }                   │
      ├──────────────────────────────────────────>│
      │                                            │
      │                                       2. Check DB
      │                                       3. bcrypt.compare()
      │                                       4. Generate JWT
      │                                            │
      │  5. Return { success, token, user }       │
      │<──────────────────────────────────────────┤
      │                                            │
   6. Store token in localStorage                 │
      │                                            │
      │  7. Subsequent requests include:          │
      │     Authorization: Bearer <token>         │
      ├──────────────────────────────────────────>│
      │                                            │
      │                                    8. auth middleware
      │                                    9. jwt.verify()
      │                                    10. req.user = decoded
      │                                            │
      │  11. Protected resource                   │
      │<──────────────────────────────────────────┤
      │                                            │
```

---

## 📅 APPOINTMENT BOOKING FLOW

```
┌─────────┐                                            ┌──────────┐
│ Patient │                                            │  Backend │
└────┬────┘                                            └────┬─────┘
     │                                                      │
     │  1. GET /api/users?role=doctor                      │
     ├────────────────────────────────────────────────────>│
     │                                                2. Find doctors
     │  3. Return [{ doctor1 }, { doctor2 }...]            │
     │<────────────────────────────────────────────────────┤
     │                                                      │
     │ [User selects doctor: Dr. Smith]                    │
     │                                                      │
     │  4. GET /api/doctor/:id/slots?date=2024-03-15       │
     ├────────────────────────────────────────────────────>│
     │                                                5. Find slots
     │                                                6. Check availability
     │  7. Return [{ time: "10:00", isBooked: false }]     │
     │<────────────────────────────────────────────────────┤
     │                                                      │
     │ [User selects time: 10:00 AM]                       │
     │ [User enters chief complaint]                       │
     │                                                      │
     │  8. POST /api/appointments                          │
     │     { doctorId, date, time, complaint }             │
     ├────────────────────────────────────────────────────>│
     │                                                      │
     │                                            9. Validate data
     │                                           10. Check slot still free
     │                                           11. Create appointment
     │                                           12. Mark slot as booked
     │                                           13. Send notification
     │                                                      │
     │ 14. Return { success, appointment }                 │
     │     Message: "Healthcare is now free!"              │
     │<────────────────────────────────────────────────────┤
     │                                                      │
     │ [Show success toast with green checkmark]           │
     │                                                      │
```

---

## 👨‍⚕️ DOCTOR CONSULTATION FLOW

```
┌────────┐                                              ┌──────────┐
│ Doctor │                                              │  Backend │
└───┬────┘                                              └────┬─────┘
    │                                                        │
    │  1. GET /api/doctor/appointments?date=today           │
    ├──────────────────────────────────────────────────────>│
    │                                           2. Find appointments
    │                                           3. Populate patient data
    │  4. Return [{ appointment, patient, healthCard }]     │
    │<──────────────────────────────────────────────────────┤
    │                                                        │
    │ [Doctor clicks on patient "Sarah Johnson"]            │
    │ [Views: Allergies, Blood Type, Chief Complaint]       │
    │                                                        │
    │  5. PUT /api/appointments/:id                         │
    │     { status: "in-progress" }                         │
    ├──────────────────────────────────────────────────────>│
    │                                           6. Update status
    │  7. Return { success }                                │
    │<──────────────────────────────────────────────────────┤
    │                                                        │
    │ [Doctor examines patient]                             │
    │ [Enters diagnosis, treatment plan]                    │
    │                                                        │
    │  8. POST /api/medical-records                         │
    │     { patientId, diagnosis, treatment, vitalSigns }   │
    ├──────────────────────────────────────────────────────>│
    │                                           9. Create record
    │ 10. Return { success, recordId }                      │
    │<──────────────────────────────────────────────────────┤
    │                                                        │
    │  11. POST /api/prescriptions                          │
    │      { medications[], instructions }                  │
    ├──────────────────────────────────────────────────────>│
    │                                          12. Create prescription
    │ 13. Return { success, prescriptionId }                │
    │<──────────────────────────────────────────────────────┤
    │                                                        │
    │  14. PUT /api/appointments/:id                        │
    │      { status: "completed" }                          │
    ├──────────────────────────────────────────────────────>│
    │                                          15. Update status
    │                                          16. Log audit trail
    │ 17. Return { success }                                │
    │<──────────────────────────────────────────────────────┤
    │                                                        │
```

---

## 📊 DATA RELATIONSHIPS

```
                        ┌──────────┐
                        │   User   │
                        │  (Base)  │
                        └────┬─────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐  ┌────▼────┐  ┌──────▼──────┐
        │  Patient  │  │ Doctor  │  │ Staff/Admin │
        └─────┬─────┘  └────┬────┘  └─────────────┘
              │             │
              │             │
    ┌─────────┼─────────────┘
    │         │
    ▼         ▼
┌──────────────────┐
│   Appointment    │
│  - patient: Ref  │
│  - doctor: Ref   │
│  - date, time    │
│  - status        │
└────────┬─────────┘
         │
         │ Referenced by
         │
    ┌────┴─────┬─────────────┬──────────────┐
    │          │             │              │
    ▼          ▼             ▼              ▼
┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Medical │ │Prescrip- │ │  Doctor  │ │  Audit   │
│ Record  │ │  tion    │ │   Slot   │ │   Log    │
└─────────┘ └──────────┘ └──────────┘ └──────────┘
    │
    │ Contains
    │
    ▼
┌──────────┐
│Documents │
│(uploads) │
└──────────┘

Patient also has:
    ├─> HealthCard (1:1)
    ├─> MedicalRecords (1:many)
    ├─> Prescriptions (1:many)
    └─> Appointments (1:many)
```

---

## 🛡️ SECURITY LAYERS

```
┌─────────────────────────────────────────────────────────┐
│                   INCOMING REQUEST                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   1. Rate Limiter    │ ← 1000 requests/15min (dev)
              │   Prevents DDoS       │
              └──────────┬───────────┘
                         │ PASS
                         ▼
              ┌──────────────────────┐
              │   2. CORS Check      │ ← Allow only localhost:3000
              │   Origin validation   │
              └──────────┬───────────┘
                         │ PASS
                         ▼
              ┌──────────────────────┐
              │  3. Helmet Headers   │ ← Security headers
              │  XSS, clickjacking   │
              └──────────┬───────────┘
                         │ PASS
                         ▼
              ┌──────────────────────┐
              │ 4. Input Sanitize    │ ← Clean NoSQL injection
              │ mongoSanitize, XSS   │
              └──────────┬───────────┘
                         │ PASS
                         ▼
              ┌──────────────────────┐
              │ 5. JWT Auth          │ ← Verify token
              │ Extract user info    │
              └──────────┬───────────┘
                         │ PASS
                         ▼
              ┌──────────────────────┐
              │ 6. Role Check        │ ← authorize('doctor')
              │ Verify permissions   │
              └──────────┬───────────┘
                         │ PASS
                         ▼
              ┌──────────────────────┐
              │ 7. Validation        │ ← Check required fields
              │ Business rules       │
              └──────────┬───────────┘
                         │ PASS
                         ▼
              ┌──────────────────────┐
              │  8. Controller       │
              │  Process request     │
              └──────────────────────┘
```

---

## 🔄 MVC ARCHITECTURE PATTERN

```
┌───────────────────────────────────────────────────────────┐
│                        REQUEST                            │
│                           ↓                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  CONTROLLER                         │  │
│  │  - Receives HTTP request                           │  │
│  │  - Extracts parameters                             │  │
│  │  - Validates basic input                           │  │
│  │  - Calls service layer                             │  │
│  │  - Formats response                                │  │
│  │  Example: AppointmentController.bookAppointment()  │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       ↓                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  SERVICE                            │  │
│  │  - Contains business logic                         │  │
│  │  - Validates business rules                        │  │
│  │  - Orchestrates multiple operations                │  │
│  │  - Transaction management                          │  │
│  │  - Calls repositories                              │  │
│  │  Example: AppointmentBookingService.createAppt()   │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       ↓                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │                 REPOSITORY                          │  │
│  │  - Database operations only                        │  │
│  │  - Mongoose queries                                │  │
│  │  - CRUD operations                                 │  │
│  │  - No business logic                               │  │
│  │  Example: AppointmentRepository.create()           │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       ↓                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │                    MODEL                            │  │
│  │  - Schema definition                               │  │
│  │  - Data validation                                 │  │
│  │  - Virtual fields                                  │  │
│  │  - Pre/post hooks                                  │  │
│  │  Example: Appointment.js (Mongoose schema)         │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       ↓                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  DATABASE                           │  │
│  │  MongoDB Collection: appointments                  │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘

Benefits:
✅ Separation of Concerns
✅ Easy to Test (mock each layer)
✅ Easy to Maintain
✅ Reusable Components
```

---

## 🎯 ROLE-BASED ACCESS CONTROL (RBAC)

```
┌─────────────────────────────────────────────────────────────┐
│                    ENDPOINT PROTECTION                       │
└─────────────────────────────────────────────────────────────┘

Request → auth → authorize(['doctor', 'staff']) → Controller
                    ↑
                    │
        Checks if req.user.role is in allowed array

Example Route:
router.get('/appointments',
  auth,                          ← Verify JWT token
  authorize('patient', 'doctor'), ← Check role
  controller.getAppointments     ← If PASS, execute
);

Permission Matrix:
┌──────────────────┬────────┬────────┬──────┬─────────┬───────┐
│ Action           │Patient │Doctor  │Staff │Manager  │Admin  │
├──────────────────┼────────┼────────┼──────┼─────────┼───────┤
│Book Appointment  │   ✓    │   ✗    │  ✗   │    ✗    │  ✗    │
│View Own Records  │   ✓    │   ✓    │  ✗   │    ✗    │  ✗    │
│Create Record     │   ✗    │   ✓    │  ✗   │    ✗    │  ✗    │
│Write Prescription│   ✗    │   ✓    │  ✗   │    ✗    │  ✗    │
│Generate Reports  │   ✗    │   ✗    │  ✗   │    ✓    │  ✓    │
│Manage Users      │   ✗    │   ✗    │  ✗   │    ✗    │  ✓    │
│Check-in Patient  │   ✗    │   ✗    │  ✓   │    ✗    │  ✗    │
│View All Patients │   ✗    │   ✗    │  ✗   │    ✓    │  ✓    │
└──────────────────┴────────┴────────┴──────┴─────────┴───────┘
```

---

## 📂 FILE STRUCTURE EXPLAINED

```
MediQueue/
│
├── client/                     ← FRONTEND
│   ├── public/
│   │   └── index.html         ← Main HTML file
│   │
│   └── src/
│       ├── App.js             ← Root component, routing
│       ├── index.js           ← React entry point
│       │
│       ├── pages/             ← Full page components
│       │   ├── auth/          ← Login, Register
│       │   ├── patient/       ← Patient portal
│       │   ├── doctor/        ← Doctor portal
│       │   ├── admin/         ← Admin dashboard
│       │   └── manager/       ← Manager dashboard
│       │
│       ├── components/        ← Reusable UI parts
│       │   ├── Layout.js      ← Header, sidebar
│       │   ├── Cards/         ← Card components
│       │   └── Forms/         ← Form components
│       │
│       ├── services/          ← API communication
│       │   └── api.js         ← Axios calls to backend
│       │
│       ├── hooks/             ← Custom React hooks
│       │   ├── useAuth.js     ← Authentication hook
│       │   └── useApi.js      ← API call hook
│       │
│       └── contexts/          ← React Context (state)
│           └── AuthContext.js ← Global auth state
│
└── server/                    ← BACKEND
    ├── server.js              ← Express app entry
    │
    ├── models/                ← Database schemas
    │   ├── User.js            ← User model (all roles)
    │   ├── Appointment.js     ← Appointment model
    │   ├── MedicalRecord.js   ← Medical record model
    │   └── ...
    │
    ├── controllers/           ← Request handlers
    │   ├── AppointmentController.js
    │   ├── DoctorController.js
    │   └── ...
    │
    ├── services/              ← Business logic
    │   ├── AppointmentBookingService.js
    │   ├── DoctorService.js
    │   └── ...
    │
    ├── repositories/          ← Database operations
    │   ├── AppointmentRepository.js
    │   ├── UserRepository.js
    │   └── ...
    │
    ├── routes/                ← API endpoints
    │   ├── auth.js            ← /api/auth/*
    │   ├── appointments.js    ← /api/appointments/*
    │   ├── doctor.js          ← /api/doctor/*
    │   └── ...
    │
    ├── middleware/            ← Request interceptors
    │   ├── auth.js            ← JWT verification
    │   ├── authorize.js       ← Role checking
    │   └── errorHandler.js    ← Error handling
    │
    ├── config/                ← Configuration
    │   └── mongo.js           ← MongoDB connection
    │
    ├── utils/                 ← Helper functions
    │   ├── errors.js          ← Custom error classes
    │   └── Logger.js          ← Logging utility
    │
    └── scripts/               ← Setup scripts
        ├── setupAdmin.js      ← Create admin user
        └── setupReceptionist.js
```

---

## 🌐 API ENDPOINT MAP

```
/api
├── /auth
│   ├── POST   /register       ← Create new user
│   ├── POST   /login          ← Get JWT token
│   ├── GET    /me             ← Get current user
│   └── POST   /logout         ← Invalidate token
│
├── /users
│   ├── GET    /               ← List users (admin)
│   ├── GET    /:id            ← Get user by ID
│   ├── PUT    /:id            ← Update user
│   ├── DELETE /:id            ← Delete user (admin)
│   └── GET    /search?q=      ← Search users
│
├── /appointments
│   ├── GET    /               ← List appointments
│   ├── POST   /               ← Book appointment (FREE!)
│   ├── GET    /:id            ← Get appointment
│   ├── PUT    /:id            ← Update appointment
│   ├── DELETE /:id            ← Cancel appointment
│   └── GET    /patient/:id    ← Patient's appointments
│
├── /doctor
│   ├── GET    /appointments   ← Doctor's appointments
│   ├── GET    /slots          ← Available slots
│   ├── POST   /slots          ← Create slot
│   ├── PUT    /slots/:id      ← Update slot
│   └── GET    /patients       ← Doctor's patients
│
├── /medical-records
│   ├── GET    /               ← List records
│   ├── POST   /               ← Create record
│   ├── GET    /:id            ← Get record
│   ├── PUT    /:id            ← Update record
│   └── GET    /patient/:id    ← Patient's records
│
├── /prescriptions
│   ├── GET    /               ← List prescriptions
│   ├── POST   /               ← Create prescription
│   ├── GET    /:id            ← Get prescription
│   └── GET    /patient/:id    ← Patient's prescriptions
│
├── /health-cards
│   ├── GET    /patient/:id    ← Get patient's card
│   ├── POST   /               ← Create card
│   ├── PUT    /:id            ← Update card
│   └── POST   /validate       ← Validate card
│
└── /manager
    ├── GET    /dashboard/overview     ← Analytics
    ├── GET    /reports/patient-visits ← Patient report
    ├── GET    /reports/staff-util     ← Staff report
    └── GET    /reports/financial      ← Financial (FREE)
```

---

## 💾 DATABASE SCHEMA SUMMARY

```
users
├── _id (ObjectId)
├── firstName, lastName
├── email (unique)
├── password (hashed)
├── role: patient|doctor|staff|manager|receptionist
├── phone, dateOfBirth, gender
├── digitalHealthCardId (unique)
├── bloodType: A+|A-|B+|B-|AB+|AB-|O+|O-
├── allergies: [{ allergen, severity }]
├── chronicConditions: []
├── specialization (doctors only)
└── timestamps: createdAt, updatedAt

appointments
├── _id (ObjectId)
├── patient → users._id
├── doctor → users._id
├── appointmentDate (Date)
├── appointmentTime (String)
├── appointmentType: consultation|follow-up|emergency
├── status: scheduled|confirmed|in-progress|completed|cancelled
├── chiefComplaint (String)
└── timestamps

medicalrecords
├── _id (ObjectId)
├── patient → users._id
├── doctor → users._id
├── appointment → appointments._id
├── diagnosis (String)
├── treatment (String)
├── vitalSigns: { bloodPressure, heartRate, temp, weight, height }
├── prescriptions: [prescription_ids]
└── timestamps

prescriptions
├── _id (ObjectId)
├── patient → users._id
├── doctor → users._id
├── medications: [{ drugName, dosage, frequency, duration }]
├── status: active|completed|cancelled
└── timestamps
```

---

**Use this diagram to quickly explain system architecture during your evaluation!** 🎯
