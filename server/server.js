const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Don't start with missing or placeholder secrets - a known JWT secret would let
// anyone forge tokens. In production this is fatal; in dev it's just a warning.
function validateRequiredSecrets() {
  const PLACEHOLDER_MARKERS = [
    'your_', 'change_in_production', 'super_secret_jwt_key_here',
    'refresh_token_secret_here', 'dev_file_url_secret',
  ];
  const isPlaceholder = (v) =>
    !v || v.length < 32 || PLACEHOLDER_MARKERS.some((m) => v.toLowerCase().includes(m));

  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const problems = required.filter((k) => isPlaceholder(process.env[k]));

  // FILE_URL_SECRET falls back to JWT_SECRET, so only flag it if it's a placeholder value.
  if (process.env.FILE_URL_SECRET && isPlaceholder(process.env.FILE_URL_SECRET)) {
    problems.push('FILE_URL_SECRET');
  }

  if (problems.length === 0) return;

  const msg =
    `Insecure/placeholder secret(s): ${problems.join(', ')}. ` +
    `Generate strong values, e.g. node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`;

  if (process.env.NODE_ENV === 'production') {
    console.error(`FATAL: ${msg}`);
    process.exit(1);
  } else {
    console.warn(`⚠️  ${msg}`);
  }
}
validateRequiredSecrets();

const { connectMongo } = require('./config/mongo');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const appointmentRoutes = require('./routes/appointments');
const medicalRecordRoutes = require('./routes/medicalRecords');
const reportRoutes = require('./routes/reports');
const generatedReportRoutes = require('./routes/generatedReports');
const reportGenerationRoutes = require('./routes/reportGeneration');
const adminRoutes = require('./routes/admin');
const healthCardRoutes = require('./routes/healthCards');
const documentRoutes = require('./routes/documents');
const chatbotRoutes = require('./routes/chatbot');
const doctorRoutes = require('./routes/doctor');
const queueRoutes = require('./routes/queue');
const checkinRoutes = require('./routes/checkin');
const leaveRoutes = require('./routes/leave');
const notificationRoutes = require('./routes/notifications');
const departmentRoutes = require('./routes/departments');
const timeBlockRoutes = require('./routes/timeBlocks');
const receptionRoutes = require('./routes/reception');
const prescriptionRoutes = require('./routes/prescriptions');
const dispensaryRoutes = require('./routes/dispensary');
const roomRoutes = require('./routes/rooms');
const fileRoutes = require('./routes/files');
const contactRoutes = require('./routes/contact');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const app = express();

// Trust the first proxy hop (Vercel / load balancer) so req.ip reflects the
// real client IP — required for rate limiting and account lockout to work
// correctly. Without this, all clients appear to share the proxy's IP.
app.set('trust proxy', 1);

const server = createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Make io accessible to routes
app.set('io', io);

// MongoDB Connection — server only starts listening after DB is ready
connectMongo(mongoose)
.then(async ({ source, fallbackFrom, atlasErrorKind }) => {
  const fallbackNote = fallbackFrom ? ` (fallback from ${fallbackFrom})` : '';
  console.log(`MongoDB connected successfully [${source}]${fallbackNote}`);

  if (atlasErrorKind) {
    console.warn(`MongoDB Atlas connection failed (${atlasErrorKind}); using local fallback.`);
  }

  // Grandfather pre-existing clinical accounts so the new credential gate does
  // not lock out staff created before verification existed. Accounts whose
  // status is the legacy schema default ('unverified' / unset) are trusted;
  // accounts explicitly created as 'pending' via the admin workflow are left
  // for an admin to verify. (One-time no-op once all rows are migrated.)
  try {
    const User = require('./models/User');
    const result = await User.updateMany(
      {
        role: { $in: ['doctor', 'pharmacist', 'receptionist', 'staff'] },
        $or: [
          { credentialVerificationStatus: 'unverified' },
          { credentialVerificationStatus: { $exists: false } },
        ],
      },
      { $set: { credentialVerificationStatus: 'verified' } }
    );
    if (result.modifiedCount > 0) {
      console.log(`Grandfathered ${result.modifiedCount} existing clinical account(s) to credential-verified.`);
    }
  } catch (error) {
    console.error('Error grandfathering clinical credentials:', error.message);
  }

  // Drop the old appointment slot uniqueness index (renamed to unique_active_booking_slot
  // which now includes 'booked' status). Safe to run on every startup — silent no-op if gone.
  try {
    const Appointment = require('./models/Appointment');
    await Appointment.collection.dropIndex('unique_active_patient_doctor_slot');
    console.log('Dropped legacy index unique_active_patient_doctor_slot (replaced by unique_active_booking_slot).');
  } catch {
    // Index already removed or never existed — nothing to do
  }

  // Start server only after DB connection is confirmed
  const PORT = process.env.PORT || 5000;
  if (process.env.NODE_ENV !== 'test') {
    server.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
      console.log(`API Base URL: http://localhost:${PORT}/api`);
      console.log(`Health Check: http://localhost:${PORT}/health`);
    });
  }
})
.catch(err => {
  console.error('MongoDB connection error:', err);

  if (err && err.mongoErrorKind === 'auth') {
    console.error(
      'Hint: Authentication failed. Verify the Atlas database user/password (not your Atlas login). ' +
        'If your password has special characters, URL-encode it. Also ensure `authSource=admin` is present in the URI.'
    );
  } else if (err && err.mongoErrorKind === 'ip-whitelist') {
    console.error('Hint: Atlas network access blocked. Add your IP (or 0.0.0.0/0 for dev) in Atlas Network Access.');
  } else if (err && err.mongoErrorKind === 'network') {
    console.error('Hint: Network/server selection failure. Check DNS, connectivity, and that the cluster is reachable.');
  }

  process.exit(1);
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com", "http://localhost:5000", "http://localhost:3000"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "http://localhost:5000", "http://localhost:3000", "ws://localhost:5000", "ws://localhost:3000"]
    }
  }
}));

// Rate limiting - More lenient for development
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100, // 1000 requests in dev, 100 in production
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing (needed for httpOnly refresh token cookies)
app.use(cookieParser());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(hpp());

// Compression middleware
app.use(compression());

// CORS - Enhanced configuration
app.use(cors({
  origin: [
    process.env.CLIENT_URL || "http://localhost:3000",
    "http://localhost:3000",
    "http://localhost:5000"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// NOTE: The previous public `express.static('/uploads')` mount was removed —
// it exposed medical documents and NIC scans to anyone who could guess a
// filename. Protected uploads are now served ONLY via `/api/files/*`, which
// requires a short-lived HMAC signature minted by authorised API responses
// (see routes/files.js + utils/signedFileUrl.js).

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'MediQueue API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/logo192.png', (req, res) => res.status(204).end());
app.get('/manifest.json', (req, res) => res.status(204).end());
app.get('/*.hot-update.json', (req, res) => res.status(204).end());

// Handle preflight OPTIONS requests for all routes
app.options('*', (req, res) => {
  res.status(200).end();
});

// Log incoming requests in development only. URLs can contain sensitive path
// tokens (e.g. password-reset links), so this is never enabled in production.
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
    next();
  });
}

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/medical-records', medicalRecordRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/generated-reports', generatedReportRoutes);
app.use('/api/report-generation', reportGenerationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/health-cards', healthCardRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/doctor', leaveRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/check-in', checkinRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/time-blocks', timeBlockRoutes);
app.use('/api/reception', receptionRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/dispensary', dispensaryRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/contact', contactRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });

  // Handle appointment notifications
  socket.on('appointment-update', (data) => {
    // Emit to specific user
    io.to(data.userId).emit('notification', {
      type: 'appointment',
      message: data.message,
      timestamp: new Date()
    });
  });

  // Handle queue room subscriptions (display screens + patients)
  socket.on('queue:join-room', (room) => {
    socket.join(`queue-room-${room}`);
    console.log(`Socket ${socket.id} joined queue room: ${room}`);
  });

  socket.on('queue:leave-room', (room) => {
    socket.leave(`queue-room-${room}`);
  });

  // Display screen subscribes to all queue updates
  socket.on('queue:subscribe-display', () => {
    socket.join('queue-display');
    console.log(`Display screen connected: ${socket.id}`);
  });

  // Doctor subscribes to their own queue channel
  socket.on('queue:subscribe-doctor', (doctorId) => {
    socket.join(`doctor-queue-${doctorId}`);
  });

  // Patient subscribes to their own status updates
  socket.on('queue:subscribe-patient', (patientId) => {
    socket.join(patientId);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Debug middleware to log unmatched routes (development only — URLs may carry
// sensitive path tokens).
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`Unmatched route: ${req.method} ${req.path}`);
    next();
  });
}

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

module.exports = app;

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Unhandled Rejection: ${err.message}`);
  if (server && typeof server.close === 'function') {
    server.close(() => {
      process.exit(1);
    });
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});