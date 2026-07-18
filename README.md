# MediQueue

MediQueue is a healthcare queue and appointment management system which has mainly designed for outpatient clinics (OPD). Patients can book appointments and receive queue tokens, while staff, doctors, and administrators manage clinic operations through dedicated portals.

## Features

- Appointment booking with time blocks and queue tokens
- Live queue display (updates in real time with Socket.io)
- Role-based access: patient, doctor, staff, receptionist, admin, pharmacist
- Doctor portal — patient records, consultation notes, prescriptions
- Reception desk — check-in, walk-ins, queue control
- Dispensary/pharmacy for handling prescriptions
- NIC / document verification with file uploads (Cloudinary)
- JWT auth with access + refresh tokens
- Patient pages are mobile-first

## Tech Stack

- **Frontend:** React, React Router, Tailwind CSS, Socket.io client
- **Backend:** Node.js, Express, Mongoose
- **Database:** MongoDB 
- **Uploads:** Cloudinary
- **Tests:** Jest

## Project Structure

```
MediQueue/
├── client/        # React app (patient + staff UI)
│   └── src/
│       ├── components/
│       ├── pages/
│       └── services/
└── server/        # Express API
    ├── routes/
    ├── controllers/
    ├── services/
    ├── models/
    └── middleware/
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- A MongoDB database (MongoDB Atlas, or a local mongod)

### 1. Backend

```bash
cd server
npm install
cp .env.example .env      # then fill in your values (Mongo URI, JWT secrets, etc.)
npm run dev               # starts on http://localhost:5000
```

### 2. Frontend

```bash
cd client
npm install
cp .env.example .env      # set REACT_APP_API_URL and REACT_APP_SOCKET_URL
npm start                 # starts on http://localhost:3000
```

## Environment Variables

Both `client/` and `server/` have their own `.env`. Copy the matching
`.env.example` and fill in real values — the example files list everything that's
needed. The real `.env` files are gitignored and should never be committed.

## Running Tests

```bash
cd server
npm test
```

