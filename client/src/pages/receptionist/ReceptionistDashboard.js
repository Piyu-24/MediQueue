import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  MagnifyingGlassIcon,
  IdentificationIcon,
  ClipboardDocumentListIcon,
  DocumentMagnifyingGlassIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  UserIcon,
  PhoneIcon,
  EnvelopeIcon,
  CalendarIcon,
  ShieldCheckIcon,
  QrCodeIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  XMarkIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  PrinterIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import api, { authAPI, userAPI, medicalRecordsAPI, healthCardAPI, queueAPI, appointmentAPI, receptionAPI, departmentAPI, roomAPI, documentAPI } from '../../services/api';
import socketService from '../../services/socket';
import { resolveFileUrl } from '../../utils/fileUrl';
import toast from 'react-hot-toast';

// Static fallback room list used only if API is unavailable
const FALLBACK_ROOMS = ['Room 01', 'Room 02', 'Room 03', 'Room 04', 'Room 05'];

// ── Helper: format time for display ─────────────────────────────────────────
const formatTime = (t) => {
  if (!t) return 'N/A';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
};

// ── Pick the best appointment to auto-select after QR check-in ───────────────
// Sorts by appointmentTime ascending; picks earliest upcoming (>= now).
// If all have passed, picks the latest one of the day.
// Appointments with no time (block-based OPD) are treated as upcoming.
const selectBestAppointment = (appointments) => {
  if (!appointments?.length) return null;
  const sorted = [...appointments].sort((a, b) => {
    if (!a.appointmentTime && !b.appointmentTime) return 0;
    if (!a.appointmentTime) return 1;
    if (!b.appointmentTime) return -1;
    return a.appointmentTime.localeCompare(b.appointmentTime);
  });
  const nowTime = new Date().toTimeString().slice(0, 5); // "HH:MM"
  const upcoming = sorted.filter(a => !a.appointmentTime || a.appointmentTime >= nowTime);
  return upcoming.length > 0 ? upcoming[0] : sorted[sorted.length - 1];
};

// ── Queue slip print helper ──────────────────────────────────────────────────
const printQueueSlip = (queueEntry, isWalkIn = false) => {
  const { queueNumber, tokenType, patient, doctor, room, department, estimatedWaitMinutes, checkInTime, appointment, timeBlockId } = queueEntry;
  const patientName = `${patient?.firstName || ''} ${patient?.lastName || ''}`.trim();
  const doctorName = `Dr. ${doctor?.firstName || ''} ${doctor?.lastName || ''}`.trim();
  const time = new Date(checkInTime).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' });
  const date = new Date().toLocaleDateString('en-LK');

  // Time block label — printed above the token so identical tokens across blocks
  // (e.g. A001 in Block 1 vs Block 6) can't be confused.
  const tb = timeBlockId && typeof timeBlockId === 'object' ? timeBlockId : null;
  const blockLabel = tb?.startTime
    ? `${formatTime(tb.startTime)} - ${formatTime(tb.endTime)}${tb.sessionName ? ' ' + tb.sessionName : ''}`
    : '';

  const tokenColor = tokenType === 'E' ? '#dc2626' : tokenType === 'W' ? '#d97706' : '#2563eb';
  const patientTypeLabel = tokenType === 'E' ? 'Emergency' : tokenType === 'W' ? 'Walk-in' : 'Appointment';
  const importantMsg = 'Please wait until your token number is displayed or announced.\nQueue order may change due to emergency cases or consultation duration.\n\nThank you.';

  const slipHTML = `
    <html><head><title>Queue Token Slip</title>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; padding: 20px; max-width: 320px; margin: 0 auto; }
      .token-no { font-size: 80px; font-weight: bold; color: ${tokenColor}; margin: 16px 0; letter-spacing: 4px; }
      .divider { border-top: 2px dashed #ccc; margin: 10px 0; }
      .row { display: flex; justify-content: space-between; margin: 3px 0; font-size: 13px; }
      .label { color: #6b7280; }
      .value { font-weight: 600; color: #1f2937; }
      .title { font-size: 18px; font-weight: bold; color: #1f2937; }
      .sub { font-size: 11px; color: #9ca3af; }
      .msg { font-size: 11px; color: #374151; margin-top: 8px; line-height: 1.4; border: 1px solid #e5e7eb; padding: 8px; border-radius: 4px; text-align: left; white-space: pre-line; }
      .badge { display: inline-block; background: ${tokenColor}20; color: ${tokenColor}; font-size: 11px; font-weight: bold; padding: 2px 10px; border-radius: 20px; margin-bottom: 4px; }
      .block { font-size: 16px; font-weight: bold; color: #1f2937; margin-top: 6px; }
    </style></head>
    <body onload="window.print();window.close()">
      <div class="title">MediQueue OPD</div>
      <div class="sub">${date}</div>
      <div class="divider"></div>
      <div class="badge">${patientTypeLabel}</div>
      ${blockLabel ? `<div class="block">${blockLabel}</div>` : ''}
      <div class="token-no">${queueNumber}</div>
      <div class="divider"></div>
      <div class="row"><span class="label">Patient:</span><span class="value">${patientName}</span></div>
      <div class="row"><span class="label">Doctor:</span><span class="value">${doctorName}</span></div>
      <div class="row"><span class="label">Room:</span><span class="value">${room}</span></div>
      <div class="row"><span class="label">Department:</span><span class="value">${department}</span></div>
      ${appointment?.appointmentTime ? `<div class="row"><span class="label">Appt. Time:</span><span class="value">${appointment.appointmentTime}</span></div>` : ''}
      <div class="divider"></div>
      <div class="msg">${importantMsg}</div>
    </body></html>
  `;

  const win = window.open('', '_blank', 'width=370,height=650');
  if (win) { win.document.write(slipHTML); win.document.close(); }
};

// ────────────────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────────────────
const ReceptionistDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('checkin');

  // ── Department + Room data (loaded once on mount) ────────────────────────
  const [deptList, setDeptList] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  // true when the selected department has admin-managed rooms (e.g. OPD)
  // determined from actual Room docs — NOT from hasMultipleRooms DB field
  const [deptIsMultiRoom, setDeptIsMultiRoom] = useState(false);

  // ── Check-in tab state ────────────────────────────────────────────────────
  const [qrInput, setQrInput] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [validatedData, setValidatedData] = useState(null); // result of /validate-qr
  const [checkInForm, setCheckInForm] = useState({
    room: '',        // display string e.g. "OPD-01"
    roomId: '',      // Room._id
    department: '',  // department name string
    departmentId: '', // Department._id
    doctorId: '',
    appointmentId: '',
    isWalkIn: false,
    notes: '',
    priority: 'normal'
  });
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [completedEntry, setCompletedEntry] = useState(null); // after successful check-in
  const [completedUnverified, setCompletedUnverified] = useState(false); // patient was still unverified at check-in
  const qrInputRef = useRef(null);
  const html5QrCodeRef = useRef(null);
  const qrReaderId = 'qr-reader';

  // ── Walk-in Registration state ────────────────────────────────────────────
  const [showWalkInForm, setShowWalkInForm] = useState(false);
  const [walkInForm, setWalkInForm] = useState({
    firstName: '', lastName: '', phone: '', email: '', dateOfBirth: '', gender: 'male', nic: '', nicSeenAndVerified: false
  });
  const [walkInLoading, setWalkInLoading] = useState(false);

  // ── Today's Queue tab state ───────────────────────────────────────────────
  const [todaysQueue, setTodaysQueue] = useState([]);
  const [bookedNotArrived, setBookedNotArrived] = useState([]);
  const [queueSummary, setQueueSummary] = useState(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueFilter, setQueueFilter] = useState('all');
  // Doctor assignment modal state
  const [assignDoctorEntry, setAssignDoctorEntry] = useState(null);

  // ── Appointment Lookup tab state ──────────────────────────────────────────
  const [apptLookupQuery, setApptLookupQuery] = useState({ reference: '', name: '', phone: '' });
  const [apptLookupResults, setApptLookupResults] = useState([]);
  const [apptLookupLoading, setApptLookupLoading] = useState(false);
  const [eligibility, setEligibility] = useState(null); // result for selected appointment

  // ── Patient Search tab state ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);

  // ── Identity Verification tab state ──────────────────────────────────────
  const [patientsForVerification, setPatientsForVerification] = useState([]);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [nicImageUrl, setNicImageUrl] = useState(null);
  const [verificationNote, setVerificationNote] = useState('');
  // Inline NIC verification from the QR check-in screen (no tab switch needed)
  const [inlineVerifyLoading, setInlineVerifyLoading] = useState(false);

  // ── Lab Upload tab state ──────────────────────────────────────────────────
  const [patientMedicalHistory, setPatientMedicalHistory] = useState([]);
  // Documents fetched from the shared Document collection (same store patient
  // self-uploads use, and the one the doctor's Documents tab reads).
  const [patientDocuments, setPatientDocuments] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [uploadLoading, setUploadLoading] = useState(false);

  const tabs = [
    { id: 'checkin', name: 'QR Check-in', icon: QrCodeIcon },
    { id: 'apptlookup', name: 'Appointment Check-in', icon: CalendarIcon },
    { id: 'queue', name: "Today's Queue", icon: ClipboardDocumentListIcon },
    { id: 'search', name: 'Patient Search', icon: MagnifyingGlassIcon },
    { id: 'verify', name: 'Verify Identity', icon: ShieldCheckIcon },
    { id: 'records', name: 'Upload Lab Tests', icon: DocumentArrowUpIcon }
  ];

  // ── Load departments once on mount ────────────────────────────────────────
  useEffect(() => {
    departmentAPI.getDepartments({ status: 'active' })
      .then(res => { if (res.data.success) setDeptList(res.data.data || []); })
      .catch(() => {});
  }, []);

  // ── Resolve rooms when department changes ────────────────────────────────
  // Data-driven: fetch actual Room documents and check isAutoManaged to determine
  // whether to show a dropdown (multi-room, e.g. OPD) or auto-assign (single room).
  // Does NOT rely on hasMultipleRooms field which may not be set in existing DB records.
  const handleDepartmentChange = async (deptId, deptName) => {
    setCheckInForm(p => ({ ...p, department: deptName, departmentId: deptId, room: '', roomId: '' }));
    setAvailableRooms([]);
    setDeptIsMultiRoom(false);
    if (!deptId) return;

    const dept = deptList.find(d => d._id === deptId);
    setRoomsLoading(true);
    try {
      // Fetch ALL rooms for this department (no status filter) to determine the mode
      const res = await roomAPI.getRooms({ departmentId: deptId });
      const allRooms   = res.data.success ? res.data.data : [];
      const adminRooms = allRooms.filter(r => !r.isAutoManaged);  // admin-managed (OPD-style)
      const autoRoom   = allRooms.find(r => r.isAutoManaged);     // single auto-managed room

      if (adminRooms.length > 0) {
        // Multi-room department (OPD): show only available admin rooms in dropdown
        setDeptIsMultiRoom(true);
        setAvailableRooms(adminRooms.filter(r => r.effectiveStatus === 'available'));
      } else if (autoRoom) {
        // Single-room department: auto-assign if available
        setDeptIsMultiRoom(false);
        if (autoRoom.effectiveStatus === 'unavailable') {
          toast.error(`${autoRoom.displayName} is currently unavailable (department inactive).`);
        } else {
          setCheckInForm(p => ({ ...p, room: autoRoom.roomNumber, roomId: autoRoom._id }));
        }
      } else {
        // No rooms in DB yet — derive fallback code from dept code
        setDeptIsMultiRoom(false);
        if (dept) setCheckInForm(p => ({ ...p, room: `${dept.code}-01`, roomId: '' }));
      }
    } catch {
      setDeptIsMultiRoom(false);
      if (dept) setCheckInForm(p => ({ ...p, room: `${dept.code}-01`, roomId: '' }));
    } finally {
      setRoomsLoading(false);
    }
  };

  // ── Refresh OPD rooms without re-selecting department ────────────────────
  const refreshRooms = async () => {
    if (!checkInForm.departmentId || !deptIsMultiRoom) return;
    setRoomsLoading(true);
    setAvailableRooms([]);
    try {
      const res = await roomAPI.getRooms({ departmentId: checkInForm.departmentId });
      if (res.data.success) {
        const adminRooms = (res.data.data || []).filter(r => !r.isAutoManaged);
        setAvailableRooms(adminRooms.filter(r => r.effectiveStatus === 'available'));
      }
    } catch { toast.error('Could not refresh rooms'); }
    finally { setRoomsLoading(false); }
  };

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'queue') fetchTodaysQueue();
    if (activeTab === 'verify') fetchPatientsForVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, filterStatus]);

  useEffect(() => {
    if (activeTab === 'checkin') {
      setTimeout(() => qrInputRef.current?.focus(), 100);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'checkin') {
      stopQrScanner();
    }
    return () => {
      stopQrScanner();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (selectedPatient && activeTab === 'records') {
      fetchPatientMedicalHistory(selectedPatient._id);
      fetchPatientDocuments(selectedPatient._id);
    }
    if (selectedPatient && activeTab === 'verify') {
      if (selectedPatient.nicDocument) fetchNicImage(selectedPatient._id);
      else setNicImageUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient, activeTab]);

  // ── Socket.io: auto-refresh Today's Queue when any queue event fires ─────────
  useEffect(() => {
    const handleQueueEvent = () => {
      if (activeTab === 'queue') fetchTodaysQueue();
    };
    socketService.on('queue:created', handleQueueEvent);
    socketService.on('queue:updated', handleQueueEvent);
    socketService.on('queue:completed', handleQueueEvent);
    socketService.on('queue:called', handleQueueEvent);
    socketService.on('queue:recalculated', handleQueueEvent);
    socketService.on('queue:paused', handleQueueEvent);
    socketService.on('queue:resumed', handleQueueEvent);

    return () => {
      socketService.off('queue:created', handleQueueEvent);
      socketService.off('queue:updated', handleQueueEvent);
      socketService.off('queue:completed', handleQueueEvent);
      socketService.off('queue:called', handleQueueEvent);
      socketService.off('queue:recalculated', handleQueueEvent);
      socketService.off('queue:paused', handleQueueEvent);
      socketService.off('queue:resumed', handleQueueEvent);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Walk-in patient full registration ────────────────────────────────────
  const handleNewWalkIn = async () => {
    const { firstName, lastName, phone, dateOfBirth } = walkInForm;
    if (!firstName.trim() || !lastName.trim()) { toast.error('First and last name are required'); return; }
    if (!phone.trim()) { toast.error('Phone number is required'); return; }
    if (!walkInForm.nic?.trim()) { toast.error('NIC number is required'); return; }

    try {
      setWalkInLoading(true);

      // Use the new reception endpoint — registers patient + auto-issues health card in one call
      const registerRes = await receptionAPI.registerPatient({
        firstName:          firstName.trim(),
        lastName:           lastName.trim(),
        phone:              phone.trim(),
        email:              walkInForm.email?.trim() || undefined,
        nicNumber:          walkInForm.nic?.trim() || undefined,
        dateOfBirth:        dateOfBirth || undefined,
        gender:             walkInForm.gender,
        hasSmartphone:      false,
        nicSeenAndVerified: walkInForm.nicSeenAndVerified,
      });

      if (!registerRes.data.success) throw new Error(registerRes.data.message);
      const { patient, healthCard } = registerRes.data.data;

      setShowWalkInForm(false);
      setWalkInForm({ firstName: '', lastName: '', phone: '', email: '', dateOfBirth: '', gender: 'male', nic: '', nicSeenAndVerified: false });

      // Auto-fill the QR / card input so the receptionist can proceed to check-in
      setQrInput(healthCard.cardNumber);

      const verifiedMsg = patient.identityVerificationStatus === 'verified'
        ? ' Identity verified (NIC seen).'
        : ' Identity pending — verify NIC at first visit.';
      toast.success(
        `Registered! Health Card: ${healthCard.cardNumber}.${verifiedMsg} QR field pre-filled — complete check-in below.`,
        { duration: 8000 }
      );

      // Auto-validate the new card
      setTimeout(() => handleValidateQR(healthCard.cardNumber), 300);
    } catch (err) {
      // If patient already exists, surface the existing patient ID so reception can proceed
      if (err.response?.status === 409 && err.response?.data?.data?.existingPatientId) {
        toast.error(err.response.data.message + ' Use Patient Search to find them.');
      } else {
        toast.error(err.response?.data?.message || err.message || 'Registration failed');
      }
    } finally {
      setWalkInLoading(false);
    }
  };

  const fetchTodaysQueue = async () => {
    try {
      setQueueLoading(true);
      // Use the richer reception endpoint that includes booked-not-arrived appointments
      const res = await receptionAPI.getTodayQueue({});
      if (res.data.success) {
        const data = res.data.data;
        // Combine all active queue entries for the main list
        const allEntries = [
          ...(data.queue?.current   || []),
          ...(data.queue?.ready     || []),
          ...(data.queue?.waiting   || []),
          ...(data.queue?.lateQueue || []),
          ...(data.queue?.walkIns   || []),
          ...(data.queue?.emergencies || [])
        ];
        // Deduplicate by _id
        const seen = new Set();
        const unique = allEntries.filter(e => { if (seen.has(e._id)) return false; seen.add(e._id); return true; });
        setTodaysQueue(unique);
        // Store booked-not-arrived for display
        setBookedNotArrived(data.appointments?.bookedNotArrived || []);
        setQueueSummary(data.summary || null);
      }
    } catch {
      // Fallback to legacy queue endpoint
      try {
        const res = await queueAPI.getQueue({});
        if (res.data.success) setTodaysQueue(res.data.data.queueEntries || []);
      } catch { toast.error('Failed to load queue'); }
    } finally {
      setQueueLoading(false);
    }
  };

  const handleValidateQR = async (overrideCard) => {
    const resolveCardValue = (value) => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        if (typeof value.data === 'string') return value.data;
      }
      return value == null ? '' : String(value);
    };
    const cardValue = resolveCardValue(overrideCard ?? qrInput);
    const normalizedCardValue = cardValue.trim();
    if (!normalizedCardValue) { toast.error('Enter a QR code or Health Card ID'); return; }
    if (normalizedCardValue.startsWith('data:image/') || normalizedCardValue.startsWith('data:text/')) {
      toast.error('You pasted an image URL. Please type the Card ID or use the camera to scan.');
      return;
    }
    try {
      setQrLoading(true);
      setValidatedData(null);
      setCompletedEntry(null);
      let payload = { cardNumber: normalizedCardValue.toUpperCase() };
      if (normalizedCardValue.startsWith('{') || normalizedCardValue.includes('"cardNumber"')) {
        try {
          JSON.parse(normalizedCardValue);
          payload = { qrData: normalizedCardValue };
        } catch {
          // Keep cardNumber payload when QR data is not valid JSON
        }
      }
      const res = await queueAPI.validateQR(payload);
      if (res.data.success) {
        const data = res.data.data;
        setValidatedData(data);
        // Pre-fill form using the earliest upcoming appointment of the day
        if (data.todaysAppointments?.length > 0) {
          const appt = selectBestAppointment(data.todaysAppointments);
          const deptName = appt.departmentId?.name || appt.doctor?.department || appt.department || '';
          // departmentId may be a populated object or a raw ObjectId string
          const rawDeptId = typeof appt.departmentId === 'object'
            ? appt.departmentId?._id
            : appt.departmentId;
          // Fall back to matching by name if the ID isn't directly available
          const matchedDept = rawDeptId
            ? null
            : deptList.find(d => d.name === deptName || d.name.toLowerCase() === deptName.toLowerCase());
          const resolvedDeptId = rawDeptId || matchedDept?._id || '';

          setCheckInForm(prev => ({
            ...prev,
            doctorId:     appt.doctor?._id || '',
            appointmentId: appt._id,
            department:   deptName,
            departmentId: resolvedDeptId
          }));

          // Trigger room resolution for the pre-filled department
          if (resolvedDeptId) handleDepartmentChange(resolvedDeptId, deptName);
        }
        if (data.alreadyCheckedIn) {
          toast.info(`${data.patient.firstName} is already in the queue today`);
        } else {
          toast.success('Health card validated! Complete check-in below.');
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Validation failed');
    } finally {
      setQrLoading(false);
    }
  };

  const handleAppointmentSwitch = (apptId) => {
    if (!apptId) {
      setCheckInForm(p => ({ ...p, appointmentId: '', doctorId: '', department: '', departmentId: '' }));
      return;
    }
    const appt = (validatedData?.todaysAppointments || []).find(a => a._id === apptId);
    if (!appt) return;
    const deptName = appt.departmentId?.name || appt.doctor?.department || appt.department || '';
    const deptId   = appt.departmentId?._id  || '';
    setCheckInForm(p => ({
      ...p,
      appointmentId: appt._id,
      doctorId:      appt.doctor?._id || '',
      department:    deptName,
      departmentId:  deptId
    }));
    if (deptId) handleDepartmentChange(deptId, deptName);
  };

  const startQrScanner = async () => {
    if (isScanning) return;
    try {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(qrReaderId);
      }
      setIsScanning(true);
      const onSuccess = (decodedText) => {
        if (!decodedText) return;
        // Show only the card number in the input field, not the raw JSON payload
        let displayValue = decodedText;
        if (decodedText.startsWith('{')) {
          try {
            const parsed = JSON.parse(decodedText);
            if (parsed.cardNumber) displayValue = parsed.cardNumber;
          } catch {}
        }
        setQrInput(displayValue);
        handleValidateQR(decodedText);
        stopQrScanner();
      };
      const onFailure = () => {};
      await html5QrCodeRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
        onSuccess,
        onFailure
      );
    } catch (err) {
      console.error('QR scanner start error:', err);
      toast.error('Unable to start camera scan. Check permissions or use manual entry.');
      setIsScanning(false);
    }
  };

  const stopQrScanner = async () => {
    if (!html5QrCodeRef.current) return;
    try {
      if (html5QrCodeRef.current.isScanning) {
        await html5QrCodeRef.current.stop();
      }
      await html5QrCodeRef.current.clear();
    } catch (err) {
      console.error('QR scanner stop error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleCheckIn = async () => {
    if (!validatedData) return;
    if (!checkInForm.department) { toast.error('Please select a department'); return; }
    if (!checkInForm.doctorId) { toast.error('Please select a doctor'); return; }
    if (deptIsMultiRoom && !checkInForm.roomId) {
      toast.error('Please select a room from the dropdown'); return;
    }
    if (!checkInForm.room) { toast.error('Room assignment failed — please re-select the department'); return; }

    try {
      setCheckInLoading(true);
      const hasAppointment = !!checkInForm.appointmentId;
      let res;

      if (hasAppointment) {
        res = await queueAPI.checkInAppointment({
          appointmentId: checkInForm.appointmentId,
          patientId:     validatedData.patient._id,
          doctorId:      checkInForm.doctorId,
          room:          checkInForm.room,
          department:    checkInForm.department,
          departmentId:  checkInForm.departmentId || undefined,
          roomId:        checkInForm.roomId || undefined,
          notes:         checkInForm.notes,
          priority:      checkInForm.priority
        });
      } else {
        res = await queueAPI.checkInWalkIn({
          patientId:    validatedData.patient._id,
          doctorId:     checkInForm.doctorId,
          room:         checkInForm.room,
          department:   checkInForm.department,
          departmentId: checkInForm.departmentId || undefined,
          roomId:       checkInForm.roomId || undefined,
          notes:        checkInForm.notes,
          priority:     checkInForm.priority,
          isEmergency:  checkInForm.priority === 'urgent'
        });
      }

      if (res.data.success) {
        const entry = res.data.data.queueEntry;
        // Remember whether this patient was still unverified, so the success
        // screen can keep prompting reception to verify the NIC after check-in.
        setCompletedUnverified(
          ['pending', 'unverified'].includes(validatedData.patient?.identityVerificationStatus)
        );
        setCompletedEntry(entry);
        setValidatedData(null);
        setQrInput('');
        setAvailableRooms([]);
        setDeptIsMultiRoom(false);
        setCheckInForm({ room: '', roomId: '', department: '', departmentId: '', doctorId: '', appointmentId: '', isWalkIn: false, notes: '', priority: 'normal' });
        toast.success(`Checked in! Token: ${entry.queueNumber}`);
        printQueueSlip(entry, !hasAppointment);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Check-in failed');
    } finally {
      setCheckInLoading(false);
    }
  };

  const handleAppointmentLookup = async () => {
    const { token, reference, name, phone } = apptLookupQuery;
    if (!token?.trim() && !reference?.trim() && !name?.trim() && !phone?.trim()) {
      toast.error('Enter at least one search term');
      return;
    }
    try {
      setApptLookupLoading(true);
      setApptLookupResults([]);
      setEligibility(null);

      // Use the new reception search endpoint (includes appointmentToken search)
      const params = {};
      if (token?.trim())     params.token     = token.trim().toUpperCase();
      if (reference?.trim()) params.reference = reference.trim().toUpperCase();
      if (name?.trim())      params.name      = name.trim();
      if (phone?.trim())     params.phone     = phone.trim();

      const res = await receptionAPI.searchAppointments(params);
      if (res.data.success) {
        setApptLookupResults(res.data.data || []);
        if ((res.data.data || []).length === 0) {
          toast.info('No matching appointments found for today');
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Lookup failed');
    } finally {
      setApptLookupLoading(false);
    }
  };

  const handleCheckInFromLookup = async (appointment) => {
    try {
      const res = await queueAPI.getCheckInEligibility(appointment._id, appointment.patient._id);
      setEligibility({ ...res.data.data, appointment });

      // Pre-fill department so the room section activates immediately
      const deptName  = appointment.departmentId?.name || appointment.doctor?.department || '';
      const rawDeptId = typeof appointment.departmentId === 'object'
        ? appointment.departmentId?._id
        : appointment.departmentId;
      const matchedDept = rawDeptId
        ? null
        : deptList.find(d => d.name === deptName || d.name.toLowerCase() === deptName.toLowerCase());
      const resolvedDeptId = rawDeptId || matchedDept?._id || '';
      if (resolvedDeptId) handleDepartmentChange(resolvedDeptId, deptName);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not check eligibility');
    }
  };

  const fetchPatientsForVerification = async () => {
    try {
      setVerifyLoading(true);
      const response = await userAPI.getPatientsForVerification(filterStatus);
      if (response.data.success) {
        setPatientsForVerification(response.data.data || []);
      }
    } catch { toast.error('Failed to load patients'); }
    finally { setVerifyLoading(false); }
  };

  const fetchNicImage = async (patientId) => {
    try {
      const response = await api.get(`/users/nic-document/${patientId}`, { responseType: 'blob' });
      setNicImageUrl(URL.createObjectURL(response.data));
    } catch { setNicImageUrl(null); }
  };

  const handleVerifyIdentity = async (patientId, status, note) => {
    try {
      const response = await userAPI.verifyPatientIdentity(patientId, {
        verificationStatus: status,
        verificationNote:   note,
        verificationMethod: 'NIC_SEEN',
      });
      if (response.data.success) {
        toast.success(status === 'verified' ? 'NIC seen and verified — patient identity confirmed.' : 'Identity verification rejected.');
        fetchPatientsForVerification();
        setSelectedPatient(null);
        setVerificationNote('');
      }
    } catch { toast.error('Failed to update verification status'); }
  };

  // ── Inline NIC verification from the QR check-in screen ──────────────────
  // Lets reception confirm the physical NIC right where they're checking the
  // patient in, instead of hunting for them in the separate "Verify Identity" tab.
  const handleInlineVerify = async (patientId, onVerified) => {
    if (!patientId) return;
    try {
      setInlineVerifyLoading(true);
      const response = await userAPI.verifyPatientIdentity(patientId, {
        verificationStatus: 'verified',
        verificationNote:   'NIC physically seen and verified at check-in counter.',
        verificationMethod: 'NIC_SEEN',
      });
      if (response.data.success) {
        toast.success('NIC seen and verified — patient identity confirmed.');
        onVerified?.();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to verify identity');
    } finally {
      setInlineVerifyLoading(false);
    }
  };

  const searchPatients = async () => {
    if (!searchQuery.trim()) { toast.error('Enter a search query'); return; }
    try {
      setSearchLoading(true);
      const response = await userAPI.searchUsers(searchQuery);
      if (response.data.success) {
        const patients = (response.data.data.users || []).filter(u => u.role === 'patient');
        setSearchResults(patients);
        if (patients.length === 0) toast.info('No patients found');
      }
    } catch { toast.error('Search failed'); }
    finally { setSearchLoading(false); }
  };

  const fetchPatientMedicalHistory = async (patientId) => {
    try {
      const response = await medicalRecordsAPI.getRecords(patientId);
      if (response.data.success) {
        setPatientMedicalHistory(response.data.data.records || response.data.data || []);
      }
    } catch { setPatientMedicalHistory([]); }
  };

  const handleFileSelect = (event, recordId) => {
    const files = Array.from(event.target.files);
    const validFiles = files.filter(f => {
      if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} exceeds 5MB`); return false; }
      return true;
    });
    setSelectedFiles(prev => ({ ...prev, [recordId]: [...(prev[recordId] || []), ...validFiles] }));
  };

  // Fetch the patient's documents from the shared Document collection (the same
  // store patient self-uploads use and the doctor's Documents tab reads from).
  const fetchPatientDocuments = async (patientId) => {
    try {
      const res = await documentAPI.getPatientDocuments(patientId, { limit: 100 });
      if (res.data.success) setPatientDocuments(res.data.data.documents || []);
    } catch { setPatientDocuments([]); }
  };

  const uploadDocuments = async (medicalRecordId) => {
    const recordFiles = selectedFiles[medicalRecordId] || [];
    if (recordFiles.length === 0) { toast.error('Select files first'); return; }
    if (!selectedPatient?._id) { toast.error('No patient selected'); return; }
    try {
      setUploadLoading(true);
      // Store each lab result in the shared Document collection tagged as a
      // 'lab-report' and linked to the medical record. This is the SAME store
      // patient self-uploads use, so the doctor sees it in their Documents tab
      // under the patient's records. (POST /documents/upload takes one file at
      // a time, so we upload sequentially.)
      let uploaded = 0;
      for (const file of recordFiles) {
        const formData = new FormData();
        formData.append('document', file);
        formData.append('patientId', selectedPatient._id);
        formData.append('title', file.name);
        formData.append('description', 'Lab result scanned and attached at reception');
        formData.append('documentType', 'lab-report');
        formData.append('medicalRecordId', medicalRecordId);
        const res = await documentAPI.uploadDocument(formData);
        if (res.data.success) uploaded += 1;
      }
      if (uploaded > 0) {
        toast.success(`${uploaded} lab document(s) uploaded — now visible to the doctor.`);
        setSelectedFiles(prev => { const u = { ...prev }; delete u[medicalRecordId]; return u; });
        fetchPatientDocuments(selectedPatient._id);
      }
    } catch (err) { toast.error(err.response?.data?.message || 'Upload failed'); }
    finally { setUploadLoading(false); }
  };

  // ── Status badge helper ───────────────────────────────────────────────────
  const getStatusBadge = (status) => {
    const map = {
      pending: 'bg-yellow-100 text-yellow-800',
      verified: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      unverified: 'bg-gray-100 text-gray-800',
      waiting: 'bg-blue-100 text-blue-800',
      called: 'bg-orange-100 text-orange-800',
      'in-consultation': 'bg-purple-100 text-purple-800',
      completed: 'bg-green-100 text-green-800',
      'no-show': 'bg-red-100 text-red-800'
    };
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Header ── */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-md">
                <UserIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Receptionist Console</h1>
                <p className="text-sm text-gray-500">
                  Welcome, {user?.firstName}! · {new Date().toLocaleDateString('en-LK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab Nav ── */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-2">
            <nav className="flex -mb-px overflow-x-auto">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 px-5 py-4 border-b-2 font-semibold text-sm whitespace-nowrap transition-all ${
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-600 bg-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}>
                    <Icon className="w-4 h-4" />
                    <span>{tab.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-6 md:p-8">

            {/* ══════════════════════════════════════════════════════════════
                TAB 1 — QR CHECK-IN
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'checkin' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    <QrCodeIcon className="w-6 h-6 text-blue-600" />
                    <h2 className="text-xl font-bold text-gray-900">Patient QR Check-in</h2>
                  </div>
                  <button
                    onClick={() => setShowWalkInForm(!showWalkInForm)}
                    className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all text-sm font-semibold shadow-md"
                  >
                    <UserIcon className="w-4 h-4" />
                    <span>New Walk-in Patient</span>
                  </button>
                </div>

                {/* ── Walk-in Registration Form ── */}
                {showWalkInForm && (
                  <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-2">
                        <UserIcon className="w-5 h-5 text-indigo-600" />
                        <h3 className="font-bold text-indigo-900">Register New Walk-in Patient</h3>
                      </div>
                      <button onClick={() => setShowWalkInForm(false)} className="text-gray-400 hover:text-gray-600">
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">First Name *</label>
                        <input type="text" value={walkInForm.firstName}
                          onChange={e => setWalkInForm(f => ({ ...f, firstName: e.target.value }))}
                          placeholder="First name"
                          className="w-full px-3 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Last Name *</label>
                        <input type="text" value={walkInForm.lastName}
                          onChange={e => setWalkInForm(f => ({ ...f, lastName: e.target.value }))}
                          placeholder="Last name"
                          className="w-full px-3 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Phone *</label>
                        <input type="tel" value={walkInForm.phone}
                          onChange={e => setWalkInForm(f => ({ ...f, phone: e.target.value }))}
                          placeholder="+94 7X XXX XXXX"
                          className="w-full px-3 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">NIC Number *</label>
                        <input type="text" value={walkInForm.nic}
                          onChange={e => setWalkInForm(f => ({ ...f, nic: e.target.value }))}
                          placeholder="e.g. 123456789V or 200012345678"
                          className="w-full px-3 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Email (optional)</label>
                        <input type="email" value={walkInForm.email}
                          onChange={e => setWalkInForm(f => ({ ...f, email: e.target.value }))}
                          placeholder="patient@email.com"
                          className="w-full px-3 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Date of Birth (optional)</label>
                        <input type="date" value={walkInForm.dateOfBirth}
                          onChange={e => setWalkInForm(f => ({ ...f, dateOfBirth: e.target.value }))}
                          className="w-full px-3 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Gender</label>
                        <select value={walkInForm.gender}
                          onChange={e => setWalkInForm(f => ({ ...f, gender: e.target.value }))}
                          className="w-full px-3 py-2.5 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm">
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                    {/* NIC Seen and Verified checkbox */}
                    <div className={`mt-4 flex items-start space-x-3 p-3 rounded-xl border-2 cursor-pointer select-none transition-all ${
                      walkInForm.nicSeenAndVerified
                        ? 'bg-green-50 border-green-400'
                        : 'bg-gray-50 border-gray-200 hover:border-indigo-300'
                    }`}
                      onClick={() => setWalkInForm(f => ({ ...f, nicSeenAndVerified: !f.nicSeenAndVerified }))}>
                      <input
                        type="checkbox"
                        id="nicSeenAndVerified"
                        checked={walkInForm.nicSeenAndVerified}
                        onChange={() => {}}
                        className="mt-0.5 w-4 h-4 text-green-600 border-gray-300 rounded accent-green-600 cursor-pointer"
                      />
                      <div>
                        <label htmlFor="nicSeenAndVerified" className={`block text-sm font-bold cursor-pointer ${walkInForm.nicSeenAndVerified ? 'text-green-800' : 'text-gray-700'}`}>
                          NIC Seen and Verified
                        </label>
                        <p className={`text-xs mt-0.5 ${walkInForm.nicSeenAndVerified ? 'text-green-600' : 'text-gray-500'}`}>
                          I have physically inspected the patient's NIC and confirmed it matches the details entered above.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center space-x-3">
                      <button onClick={() => setShowWalkInForm(false)}
                        className="px-5 py-2.5 bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 font-semibold text-sm">
                        Cancel
                      </button>
                      <button onClick={handleNewWalkIn} disabled={walkInLoading}
                        className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-60 font-bold text-sm flex items-center justify-center space-x-2 shadow-md">
                        {walkInLoading ? (
                          <><ArrowPathIcon className="w-4 h-4 animate-spin" /><span>Registering...</span></>
                        ) : (
                          <><CheckCircleIcon className="w-4 h-4" /><span>Register &amp; Issue Health Card</span></>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Successful check-in result ── */}
                {completedEntry && (
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-16 h-16 bg-green-500 rounded-xl flex items-center justify-center">
                          <CheckCircleIcon className="w-8 h-8 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-green-700 mb-1">Check-in Successful!</p>
                          {completedEntry.timeBlockId?.startTime && (
                            <p className="text-sm font-bold text-green-700">
                              {formatTime(completedEntry.timeBlockId.startTime)} - {formatTime(completedEntry.timeBlockId.endTime)}
                              {completedEntry.timeBlockId.sessionName ? ` ${completedEntry.timeBlockId.sessionName}` : ''}
                            </p>
                          )}
                          <p className="text-4xl font-black text-green-800">{completedEntry.queueNumber}</p>
                          <p className="text-sm text-green-600 mt-1">
                            {completedEntry.patient?.firstName} {completedEntry.patient?.lastName} ·{' '}
                            {completedEntry.room} · Est. wait: ~{completedEntry.estimatedWaitMinutes} min
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col space-y-2">
                        <button
                          onClick={() => printQueueSlip(completedEntry)}
                          className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all text-sm font-semibold"
                        >
                          <PrinterIcon className="w-4 h-4" />
                          <span>Re-print Slip</span>
                        </button>
                        <button
                          onClick={() => { setCompletedEntry(null); setCompletedUnverified(false); }}
                          className="px-4 py-2 bg-white border border-green-300 text-green-700 rounded-xl hover:bg-green-50 transition-all text-sm font-semibold"
                        >
                          Next Patient
                        </button>
                      </div>
                    </div>

                    {/* Post-check-in reminder — patient is in the queue but NIC still unverified */}
                    {completedUnverified && (
                      <div className="mt-4 flex flex-wrap items-center gap-3 bg-amber-50 border-2 border-amber-400 rounded-xl p-4">
                        <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 flex-shrink-0" />
                        <p className="flex-1 min-w-0 text-sm font-semibold text-amber-900">
                          Identity still unverified — confirm {completedEntry.patient?.firstName}'s physical NIC.
                        </p>
                        <button
                          onClick={() => handleInlineVerify(
                            completedEntry.patient?._id,
                            () => setCompletedUnverified(false)
                          )}
                          disabled={inlineVerifyLoading}
                          className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors"
                        >
                          {inlineVerifyLoading
                            ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            : <CheckCircleIcon className="w-4 h-4" />}
                          <span>{inlineVerifyLoading ? 'Verifying…' : 'NIC Seen & Verified'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 1: Scan / Enter QR ── */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-blue-800 mb-3 flex items-center space-x-2">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
                    <span>Scan QR Code or Enter Health Card ID</span>
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <button
                      onClick={startQrScanner}
                      disabled={isScanning}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all font-semibold text-sm"
                    >
                      {isScanning ? 'Scanning...' : 'Start Camera Scan'}
                    </button>
                    <button
                      onClick={stopQrScanner}
                      disabled={!isScanning}
                      className="px-4 py-2 bg-white border border-blue-200 text-blue-700 rounded-xl hover:bg-blue-50 disabled:opacity-50 transition-all font-semibold text-sm"
                    >
                      Stop Scan
                    </button>
                    <span className="text-xs text-blue-700">
                      Use manual input if the camera is blocked.
                    </span>
                  </div>
                  <div className="mb-4">
                    <div
                      id={qrReaderId}
                      className="w-full max-w-sm bg-white border border-blue-200 rounded-xl p-3 min-h-[260px] flex items-center justify-center text-xs text-blue-700"
                    >
                      {!isScanning && 'Camera preview will appear here after you start scanning.'}
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <div className="flex-1 relative">
                      <QrCodeIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        ref={qrInputRef}
                        type="text"
                        value={qrInput}
                        onChange={e => setQrInput(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && handleValidateQR()}
                        placeholder="Scan QR or type Health Card ID (e.g. HC2600000X)"
                        className="w-full pl-12 pr-4 py-3.5 border-2 border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base font-mono"
                      />
                    </div>
                    <button
                      onClick={() => handleValidateQR()}
                      disabled={qrLoading}
                      className="px-6 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all font-semibold flex items-center space-x-2 shadow-md"
                    >
                      {qrLoading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <ShieldCheckIcon className="w-5 h-5" />}
                      <span>{qrLoading ? 'Validating...' : 'Validate'}</span>
                    </button>
                  </div>
                </div>

                {/* ── Step 2: Patient info + already-in-queue warning ── */}
                {validatedData && (
                  <div className="space-y-4">
                    {/* Patient card */}
                    <div className="bg-white border-2 border-blue-200 rounded-2xl p-5">
                      <div className="flex items-center space-x-4 mb-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-blue-200 rounded-xl flex items-center justify-center">
                          <UserIcon className="w-6 h-6 text-blue-700" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">
                            {validatedData.patient.firstName} {validatedData.patient.lastName}
                          </h3>
                          <p className="text-sm text-gray-500">Health Card: {validatedData.healthCard.cardNumber}</p>
                        </div>
                        <div className="ml-auto">
                          {getStatusBadge(validatedData.healthCard.status)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div><span className="text-gray-500">Phone:</span><br /><span className="font-medium">{validatedData.patient.phone || 'N/A'}</span></div>
                        <div><span className="text-gray-500">Blood Group:</span><br /><span className="font-medium">{validatedData.healthCard.bloodGroup || 'N/A'}</span></div>
                        <div><span className="text-gray-500">DOB:</span><br /><span className="font-medium">{validatedData.patient.dateOfBirth ? new Date(validatedData.patient.dateOfBirth).toLocaleDateString() : 'N/A'}</span></div>
                        <div><span className="text-gray-500">Gender:</span><br /><span className="font-medium capitalize">{validatedData.patient.gender || 'N/A'}</span></div>
                      </div>
                    </div>

                    {/* Identity verification alert — shown for pending/unverified patients */}
                    {['pending', 'unverified'].includes(validatedData.patient?.identityVerificationStatus) && (
                      <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 shadow-sm">
                        <div className="flex items-start space-x-4">
                          <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                            <ExclamationTriangleIcon className="w-6 h-6 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-bold text-amber-900">Identity Verification Required</p>
                            <p className="text-sm text-amber-800 mt-1">
                              This patient's NIC has <strong>not been verified</strong>. Ask for the physical NIC and confirm it matches before completing check-in.
                            </p>
                            {validatedData.patient?.nicNumber && (
                              <p className="text-xs text-amber-700 mt-1">
                                NIC on file: <span className="font-mono font-semibold">{validatedData.patient.nicNumber}</span>
                              </p>
                            )}
                          </div>
                        </div>
                        {/* Inline actions — verify here without leaving the check-in screen */}
                        <div className="flex flex-wrap items-center gap-3 mt-4 pl-14">
                          <button
                            onClick={() => handleInlineVerify(
                              validatedData.patient._id,
                              () => setValidatedData(prev => prev
                                ? { ...prev, patient: { ...prev.patient, identityVerificationStatus: 'verified' } }
                                : prev)
                            )}
                            disabled={inlineVerifyLoading}
                            className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
                          >
                            {inlineVerifyLoading
                              ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                              : <CheckCircleIcon className="w-4 h-4" />}
                            <span>{inlineVerifyLoading ? 'Verifying…' : 'NIC Seen & Verified'}</span>
                          </button>
                          <button
                            onClick={() => setActiveTab('verify')}
                            className="px-4 py-2 bg-white border border-amber-300 text-amber-700 hover:bg-amber-100 text-sm font-semibold rounded-xl transition-colors"
                          >
                            Open Full Review
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Identity verified confirmation */}
                    {validatedData.patient?.identityVerificationStatus === 'verified' && (
                      <div className="flex items-center space-x-3 bg-green-50 border border-green-300 rounded-xl p-4">
                        <ShieldCheckIcon className="w-6 h-6 text-green-600 flex-shrink-0" />
                        <p className="text-sm font-semibold text-green-800">Identity verified — NIC confirmed.</p>
                      </div>
                    )}

                    {/* Already in queue warning */}
                    {validatedData.alreadyCheckedIn && (
                      <div className="flex items-center space-x-3 bg-yellow-50 border border-yellow-300 rounded-xl p-4">
                        <ExclamationTriangleIcon className="w-6 h-6 text-yellow-600 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-yellow-800">Patient already checked in today</p>
                          <p className="text-xs text-yellow-700">
                            Queue: {validatedData.existingQueueEntries[0]?.queueNumber} with Dr.{' '}
                            {validatedData.existingQueueEntries[0]?.doctor?.firstName} {validatedData.existingQueueEntries[0]?.doctor?.lastName}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Today's appointments — read-only */}
                    {validatedData.todaysAppointments?.length > 0 ? (
                      <div className="bg-white border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-bold text-gray-700 mb-3 uppercase tracking-wide flex items-center gap-2">
                          <CalendarIcon className="w-4 h-4 text-gray-500" />
                          Appointments Found
                          <span className="font-semibold text-gray-400 normal-case tracking-normal ml-1">
                            ({validatedData.todaysAppointments.length})
                          </span>
                        </p>
                        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                          {validatedData.todaysAppointments.map(appt => {
                            return (
                              <div
                                key={appt._id}
                                className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-gray-50 border border-gray-100"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="font-semibold text-gray-900">
                                    Dr. {appt.doctor?.firstName} {appt.doctor?.lastName}
                                  </span>
                                  {appt.doctor?.specialization && (
                                    <span className="text-gray-500 ml-1.5">· {appt.doctor.specialization}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 ml-3 shrink-0">
                                  <span className="text-gray-600 text-xs">
                                    {new Date(appt.appointmentDate).toLocaleDateString('en-LK', {
                                      day: '2-digit', month: 'short', year: 'numeric'
                                    })}
                                  </span>
                                  <ClockIcon className="w-3.5 h-3.5 text-gray-400" />
                                  <span className="font-medium text-gray-700">
                                    {formatTime(appt.appointmentTime)}
                                  </span>
                                  {getStatusBadge(appt.status)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                          <CalendarIcon className="w-4 h-4" />
                          Appointments Found <span className="font-semibold">(0)</span>
                        </p>
                      </div>
                    )}

                    {/* Walk-in notice when no today's appointment */}
                    {validatedData.todaysAppointments?.length === 0 && (
                      <div className="flex items-center space-x-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <IdentificationIcon className="w-5 h-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-semibold text-blue-800">No appointment booked for today</p>
                          <p className="text-xs text-blue-700 mt-0.5">
                            {validatedData.patient?.firstName} is a registered patient. Proceeding as a <strong>walk-in</strong> — a queue token will be issued below.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* ── Step 3: Check-in form ── */}
                    {!validatedData.alreadyCheckedIn && (
                      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
                        <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center space-x-2">
                          <span className="w-6 h-6 bg-gray-600 text-white rounded-full text-xs flex items-center justify-center font-bold">2</span>
                          <span>Assign Room & Doctor</span>
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                          {/* Appointment selector — auto-selected, overridable */}
                          {validatedData.todaysAppointments?.length > 0 && (
                            <div className="md:col-span-2">
                              <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                                Appointment
                                <span className="text-xs font-medium bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  Auto-selected
                                </span>
                              </label>
                              <select
                                value={checkInForm.appointmentId}
                                onChange={e => handleAppointmentSwitch(e.target.value)}
                                className="w-full px-3 py-2.5 border-2 border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                              >
                                <option value="">— Walk-in (no appointment) —</option>
                                {[...validatedData.todaysAppointments]
                                  .sort((a, b) => {
                                    if (!a.appointmentTime && !b.appointmentTime) return 0;
                                    if (!a.appointmentTime) return 1;
                                    if (!b.appointmentTime) return -1;
                                    return a.appointmentTime.localeCompare(b.appointmentTime);
                                  })
                                  .map(appt => (
                                    <option key={appt._id} value={appt._id}>
                                      {appt.appointmentTime
                                        ? formatTime(appt.appointmentTime)
                                        : (appt.timeBlockId?.sessionName || 'Block OPD')}
                                      {' · Dr. '}
                                      {appt.doctor
                                        ? `${appt.doctor.firstName} ${appt.doctor.lastName}`
                                        : 'TBD (OPD)'}
                                      {' — '}
                                      {appt.departmentId?.name || appt.department || 'OPD'}
                                      {appt.appointmentToken ? ` · ${appt.appointmentToken}` : ''}
                                    </option>
                                  ))
                                }
                              </select>
                            </div>
                          )}

                          {/* Department */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Department *</label>
                            <select
                              value={checkInForm.departmentId}
                              onChange={e => {
                                const d = deptList.find(x => x._id === e.target.value);
                                handleDepartmentChange(e.target.value, d?.name || '');
                                setCheckInForm(p => ({ ...p, doctorId: '' }));
                              }}
                              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            >
                              <option value="">Select department</option>
                              {deptList.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
                            </select>
                          </div>

                          {/* Room — dropdown for multi-room depts, auto-assigned for single-room */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">
                              Room *
                              {roomsLoading && <span className="ml-2 text-blue-500 text-xs">Loading…</span>}
                            </label>
                            {!checkInForm.departmentId ? (
                              <p className="text-sm text-gray-400 italic py-2">Select a department first</p>
                            ) : deptIsMultiRoom ? (
                              availableRooms.length === 0 && !roomsLoading ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                                    <ExclamationTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
                                    <p className="text-xs text-red-700 font-medium">No rooms available. Contact admin.</p>
                                  </div>
                                  <button onClick={refreshRooms} title="Refresh rooms"
                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-gray-200">
                                    <ArrowPathIcon className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <select
                                    value={checkInForm.roomId}
                                    onChange={e => {
                                      const r = availableRooms.find(x => x._id === e.target.value);
                                      const apptDocs = (validatedData.todaysAppointments || []).filter(a => a.doctor?._id);
                                      const roomDocs = r?.assignedDoctors || [];
                                      // Room-first: auto-pick the doctor when the room has exactly one and
                                      // there's no appointment doctor to honour; otherwise reset for a fresh pick.
                                      setCheckInForm(p => ({
                                        ...p,
                                        roomId: e.target.value,
                                        room:   r?.roomNumber || '',
                                        doctorId: apptDocs.length === 0 && roomDocs.length === 1
                                          ? roomDocs[0]._id : ''
                                      }));
                                    }}
                                    className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 text-sm"
                                  >
                                    <option value="">Select room</option>
                                    {availableRooms.map(r => (
                                      <option key={r._id} value={r._id}>{r.roomNumber} — {r.displayName}</option>
                                    ))}
                                  </select>
                                  <button onClick={refreshRooms} title="Refresh room availability"
                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-gray-200 flex-shrink-0">
                                    <ArrowPathIcon className={`w-4 h-4 ${roomsLoading ? 'animate-spin' : ''}`} />
                                  </button>
                                </div>
                              )
                            ) : checkInForm.room ? (
                              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                                <CheckCircleIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
                                <p className="text-sm font-semibold text-green-800">{checkInForm.room}</p>
                                <span className="text-xs text-green-600 ml-auto">Auto-assigned</span>
                              </div>
                            ) : roomsLoading ? (
                              <p className="text-sm text-gray-400 italic py-2">Resolving room…</p>
                            ) : (
                              <p className="text-sm text-gray-400 italic py-2">Room will be assigned automatically</p>
                            )}
                          </div>

                          {/* Doctor selector */}
                          <div className="md:col-span-2">
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Doctor *</label>
                            {(() => {
                              const apptWithDoctor = (validatedData.todaysAppointments || []).filter(a => a.doctor?._id);
                              return apptWithDoctor.length > 0 ? (
                                <select
                                  value={checkInForm.doctorId}
                                  onChange={e => {
                                    const appt = apptWithDoctor.find(a => a.doctor._id === e.target.value);
                                    setCheckInForm(p => ({
                                      ...p,
                                      doctorId: e.target.value,
                                      appointmentId: appt?._id || ''
                                    }));
                                  }}
                                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                >
                                  <option value="">Select doctor</option>
                                  {apptWithDoctor.map(a => (
                                    <option key={a.doctor._id} value={a.doctor._id}>
                                      Dr. {a.doctor.firstName} {a.doctor.lastName} — {formatTime(a.appointmentTime)}
                                    </option>
                                  ))}
                                </select>
                              ) : deptIsMultiRoom ? (
                                // Room-first: doctors are limited to those assigned to the chosen room
                                !checkInForm.roomId ? (
                                  <p className="text-sm text-gray-400 italic py-2">Select a room first to see its doctors</p>
                                ) : (() => {
                                    const selRoom  = availableRooms.find(r => r._id === checkInForm.roomId);
                                    const roomDocs = selRoom?.assignedDoctors || [];
                                    if (roomDocs.length === 0) {
                                      return (
                                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                                          <ExclamationTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
                                          <p className="text-xs text-red-700 font-medium">
                                            No doctors assigned to {selRoom?.roomNumber || 'this room'}. Ask an admin to assign one.
                                          </p>
                                        </div>
                                      );
                                    }
                                    return (
                                      <select
                                        value={checkInForm.doctorId}
                                        onChange={e => setCheckInForm(p => ({ ...p, doctorId: e.target.value }))}
                                        className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                      >
                                        <option value="">Select doctor</option>
                                        {roomDocs.map(d => (
                                          <option key={d._id} value={d._id}>
                                            Dr. {d.firstName} {d.lastName}{d.specialization ? ` — ${d.specialization}` : ''}
                                          </option>
                                        ))}
                                      </select>
                                    );
                                  })()
                              ) : (
                                <DoctorSearchInput
                                  value={checkInForm.doctorId}
                                  onChange={doctorId => setCheckInForm(p => ({ ...p, doctorId }))}
                                  department={checkInForm.department}
                                />
                              );
                            })()}
                          </div>

                          {/* Priority */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Priority</label>
                            <select
                              value={checkInForm.priority}
                              onChange={e => setCheckInForm(p => ({ ...p, priority: e.target.value }))}
                              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            >
                              <option value="normal">Normal</option>
                              <option value="urgent">Urgent </option>
                            </select>
                          </div>

                          {/* Notes */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Notes (optional)</label>
                            <input
                              type="text"
                              value={checkInForm.notes}
                              onChange={e => setCheckInForm(p => ({ ...p, notes: e.target.value }))}
                              placeholder="e.g. Elderly patient, needs assistance"
                              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            />
                          </div>
                        </div>

                        <button
                          onClick={handleCheckIn}
                          disabled={checkInLoading}
                          className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 transition-all font-bold text-base shadow-lg flex items-center justify-center space-x-2"
                        >
                          {checkInLoading ? (
                            <><ArrowPathIcon className="w-5 h-5 animate-spin" /><span>Processing...</span></>
                          ) : (
                            <><CheckCircleIcon className="w-5 h-5" /><span>Complete Check-in & Print Slip</span></>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                TAB 2 — TODAY'S QUEUE
            ══════════════════════════════════════════════════════════════ */}
            {/* ══════════════════════════════════════════════════════════════
                TAB — APPOINTMENT CHECK-IN (non-QR / non-smartphone lookup)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'apptlookup' && (
              <div className="space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <CalendarIcon className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-bold text-gray-900">Appointment Check-in</h2>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Token · Reference · Name · Phone</span>
                </div>

                {/* ── Quick check-in by appointment token ── */}
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-5 text-white mb-4">
                  <p className="text-sm font-bold mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-xs"></span>
                    Quick Token Check-in — type the appointment token from the patient's slip
                  </p>
                  <div className="flex gap-3">
                    <input
                      value={apptLookupQuery.token || ''}
                      onChange={e => setApptLookupQuery(p => ({ ...p, token: e.target.value.toUpperCase() }))}
                      onKeyPress={e => e.key === 'Enter' && handleAppointmentLookup()}
                      placeholder="e.g.  A014"
                      className="flex-1 px-4 py-3 rounded-xl text-gray-900 font-mono text-lg font-bold uppercase placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white"
                    />
                    <button onClick={handleAppointmentLookup} disabled={apptLookupLoading}
                      className="px-6 py-3 bg-white text-blue-700 rounded-xl font-bold hover:bg-blue-50 disabled:opacity-50 flex items-center gap-2 shadow-md">
                      {apptLookupLoading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
                      Find & Check In
                    </button>
                  </div>
                </div>

                {/* Search form */}
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Or search by patient details</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Appointment Reference</label>
                      <input value={apptLookupQuery.reference}
                        onChange={e => setApptLookupQuery(p => ({ ...p, reference: e.target.value }))}
                        placeholder="e.g. MQ-20240115-7A3B"
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm font-mono uppercase" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Patient Name</label>
                      <input value={apptLookupQuery.name}
                        onChange={e => setApptLookupQuery(p => ({ ...p, name: e.target.value }))}
                        onKeyPress={e => e.key === 'Enter' && handleAppointmentLookup()}
                        placeholder="First or last name"
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Phone Number</label>
                      <input value={apptLookupQuery.phone}
                        onChange={e => setApptLookupQuery(p => ({ ...p, phone: e.target.value }))}
                        onKeyPress={e => e.key === 'Enter' && handleAppointmentLookup()}
                        placeholder="+94XXXXXXXXX"
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm" />
                    </div>
                  </div>
                  <button onClick={handleAppointmentLookup} disabled={apptLookupLoading}
                    className="mt-3 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-semibold flex items-center gap-2 text-sm shadow-md">
                    {apptLookupLoading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <MagnifyingGlassIcon className="w-4 h-4" />}
                    Search Today's Appointments
                  </button>
                </div>

                {/* Results */}
                {apptLookupResults.length > 0 && (
                  <div className="space-y-2">
                    {apptLookupResults.map(appt => (
                      <div key={appt._id} className="border-2 border-gray-200 rounded-xl p-4 bg-white hover:border-blue-300 transition-all">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-2 mb-1">
                              <span className="font-bold text-gray-900">{appt.patient?.firstName} {appt.patient?.lastName}</span>
                              {/* Appointment token badge — shown for block-based bookings */}
                              {appt.appointmentToken && (
                                <span className="text-sm font-black bg-blue-600 text-white px-3 py-0.5 rounded-full tracking-wider">
                                  {appt.appointmentToken}
                                </span>
                              )}
                              <span className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded">{appt.appointmentReference}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                appt.status === 'booked'     ? 'bg-blue-100 text-blue-700' :
                                appt.status === 'scheduled'  ? 'bg-blue-100 text-blue-700' :
                                appt.status === 'confirmed'  ? 'bg-green-100 text-green-700' :
                                appt.status === 'checked_in' ? 'bg-teal-100 text-teal-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>{appt.status}</span>
                            </div>
                            {/* Doctor or Department */}
                            {appt.doctor ? (
                              <p className="text-sm text-gray-600">
                                Dr. {appt.doctor.firstName} {appt.doctor.lastName} · {appt.doctor.specialization}
                              </p>
                            ) : (
                              <p className="text-sm text-gray-600">
                                {appt.departmentId?.name || appt.department || 'General OPD'} — doctor assigned at check-in
                              </p>
                            )}
                            {/* Time: block or exact */}
                            <p className="text-sm text-gray-500">
                              {new Date(appt.appointmentDate).toLocaleDateString('en-LK')}
                              {appt.timeBlockId?.sessionName
                                ? ` · ${appt.timeBlockId.sessionName}`
                                : appt.appointmentTime
                                ? ` at ${appt.appointmentTime}`
                                : ''}
                              {appt.reportingTime && ` · Arrive by ${formatTime(appt.reportingTime)}`}
                              {appt.patient?.phone && ` · ${appt.patient.phone}`}
                            </p>
                          </div>
                          <button onClick={() => handleCheckInFromLookup(appt)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold shadow-sm shrink-0">
                            Check In
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Eligibility result + check-in form */}
                {eligibility && (
                  <div className={`rounded-2xl border-2 p-5 ${
                    eligibility.eligible ? 'border-green-300 bg-green-50' :
                    eligibility.alreadyCheckedIn ? 'border-yellow-300 bg-yellow-50' :
                    'border-red-200 bg-red-50'
                  }`}>
                    <div className="flex items-center gap-2 mb-3">
                      {eligibility.eligible ? (
                        <CheckCircleIcon className="w-6 h-6 text-green-600" />
                      ) : (
                        <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
                      )}
                      <div>
                        <p className="font-bold text-gray-900">
                          {eligibility.appointment?.patient?.firstName || eligibility.appointment?.patient} — {' '}
                          {eligibility.arrivalStatus === 'early' ? ' Early' :
                           eligibility.arrivalStatus === 'on_time' ? ' On Time' :
                           eligibility.arrivalStatus === 'late' ? ' Late' :
                           eligibility.arrivalStatus === 'too_early' ? ' Too Early' : ''}
                        </p>
                        {eligibility.reason && <p className="text-sm text-gray-600">{eligibility.reason}</p>}
                      </div>
                    </div>

                    {eligibility.eligible && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Department *</label>
                          <select
                            value={checkInForm.departmentId}
                            onChange={e => {
                              const d = deptList.find(x => x._id === e.target.value);
                              handleDepartmentChange(e.target.value, d?.name || '');
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400">
                            <option value="">Select Department</option>
                            {deptList.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            Room * {roomsLoading && <span className="text-blue-500 text-xs ml-1">Loading…</span>}
                          </label>
                          {!checkInForm.departmentId ? (
                            <p className="text-xs text-gray-400 italic py-2">Select dept first</p>
                          ) : deptIsMultiRoom ? (
                            <div className="flex items-center gap-2">
                              <select value={checkInForm.roomId}
                                onChange={e => {
                                  const r = availableRooms.find(x => x._id === e.target.value);
                                  setCheckInForm(p => ({ ...p, roomId: e.target.value, room: r?.roomNumber || '' }));
                                }}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400">
                                <option value="">Select room</option>
                                {availableRooms.map(r => (
                                  <option key={r._id} value={r._id}>{r.roomNumber} — {r.displayName}</option>
                                ))}
                              </select>
                              <button onClick={refreshRooms} title="Refresh room availability"
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-gray-200 flex-shrink-0">
                                <ArrowPathIcon className={`w-4 h-4 ${roomsLoading ? 'animate-spin' : ''}`} />
                              </button>
                            </div>
                          ) : checkInForm.room ? (
                            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                              <CheckCircleIcon className="w-4 h-4 text-green-600" />
                              <span className="text-sm font-semibold text-green-800">{checkInForm.room}</span>
                              <span className="text-xs text-green-600 ml-auto">Auto-assigned</span>
                            </div>
                          ) : <p className="text-xs text-gray-400 italic py-2">Will be auto-assigned</p>}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                          <input value={checkInForm.notes} onChange={e => setCheckInForm(p => ({ ...p, notes: e.target.value }))}
                            placeholder="Optional notes"
                            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent" />
                        </div>
                        <div className="md:col-span-3 flex gap-2">
                          <button
                            disabled={checkInLoading || !checkInForm.room || !checkInForm.department}
                            onClick={async () => {
                              try {
                                setCheckInLoading(true);
                                const appt = eligibility.appointment;
                                const res = await queueAPI.checkInAppointment({
                                  appointmentId: appt._id,
                                  patientId:    appt.patient._id || appt.patient,
                                  doctorId:     appt.doctor._id  || appt.doctor,
                                  room:         checkInForm.room,
                                  department:   checkInForm.department,
                                  departmentId: checkInForm.departmentId || undefined,
                                  roomId:       checkInForm.roomId || undefined,
                                  notes:        checkInForm.notes,
                                  priority:     checkInForm.priority
                                });
                                if (res.data.success) {
                                  toast.success(`Checked in! Token: ${res.data.data.token}`);
                                  printQueueSlip(res.data.data.queueEntry, false);
                                  setEligibility(null);
                                  setApptLookupResults([]);
                                  setApptLookupQuery({ reference: '', name: '', phone: '' });
                                  setAvailableRooms([]);
                                  setDeptIsMultiRoom(false);
                                  setCheckInForm({ room: '', roomId: '', department: '', departmentId: '', doctorId: '', appointmentId: '', isWalkIn: false, notes: '', priority: 'normal' });
                                }
                              } catch (err) {
                                toast.error(err.response?.data?.message || 'Check-in failed');
                              } finally {
                                setCheckInLoading(false);
                              }
                            }}
                            className="px-6 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 font-semibold text-sm shadow-md flex items-center gap-2">
                            {checkInLoading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckCircleIcon className="w-4 h-4" />}
                            Confirm Check-in & Print Token
                          </button>
                          <button onClick={() => setEligibility(null)}
                            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-100">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                TAB — TODAY'S QUEUE
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'queue' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    <ClipboardDocumentListIcon className="w-6 h-6 text-blue-600" />
                    <h2 className="text-xl font-bold text-gray-900">Today's Queue</h2>
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full">
                      {queueFilter === 'all' ? todaysQueue.length : todaysQueue.filter(e => e.status === queueFilter).length}
                      {' '}{queueFilter === 'all' ? 'total' : queueFilter.replace(/_/g, ' ')}
                    </span>
                    {bookedNotArrived.length > 0 && (
                      <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded-full">
                        {bookedNotArrived.length} booked not arrived
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {['all', 'waiting', 'ready', 'called', 'in_consultation', 'completed', 'no_show', 'temporarily_away', 'skipped'].map(s => (
                      <button key={s} onClick={() => setQueueFilter(s)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          queueFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        {s === 'all' ? 'All' : s.replace('_', ' ')}
                      </button>
                    ))}
                    <button onClick={fetchTodaysQueue} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors">
                      <ArrowPathIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Summary stats */}
                {queueSummary && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-4">
                    {[
                      { label: 'Booked', value: queueSummary.totalBooked,     color: 'bg-blue-50 text-blue-700 border-blue-200' },
                      { label: 'Active',  value: queueSummary.activeInQueue,   color: 'bg-teal-50 text-teal-700 border-teal-200' },
                      { label: 'Done',    value: queueSummary.completed,       color: 'bg-green-50 text-green-700 border-green-200' },
                      { label: 'Walk-ins',value: queueSummary.walkIns,         color: 'bg-amber-50 text-amber-700 border-amber-200' },
                      { label: 'No-show', value: queueSummary.noShows,         color: 'bg-red-50 text-red-700 border-red-200' },
                      { label: 'Emerg',   value: queueSummary.emergencies,     color: 'bg-purple-50 text-purple-700 border-purple-200' },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl border p-2 text-center ${s.color}`}>
                        <p className="text-xl font-black">{s.value ?? 0}</p>
                        <p className="text-xs font-semibold">{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Booked — not yet arrived */}
                {bookedNotArrived.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-bold text-amber-800 bg-amber-50 border border-amber-200 px-4 py-2 rounded-t-xl flex items-center gap-2">
                      <ClockIcon className="w-4 h-4" />
                      Booked — Not Yet Arrived ({bookedNotArrived.length})
                    </h3>
                    <div className="border border-amber-200 border-t-0 rounded-b-xl divide-y divide-amber-100 bg-white">
                      {bookedNotArrived.slice(0, 8).map(appt => (
                        <div key={appt._id} className="flex items-center justify-between px-4 py-3 hover:bg-amber-50 transition-colors">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            {appt.appointmentToken && (
                              <span className="font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded text-sm font-mono min-w-[52px] text-center">
                                {appt.appointmentToken}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 text-sm truncate">
                                {appt.patient?.firstName} {appt.patient?.lastName}
                              </p>
                              <p className="text-xs text-gray-500">
                                {appt.doctor ? `Dr. ${appt.doctor.firstName} ${appt.doctor.lastName}` : (appt.department || 'OPD')}
                                {appt.reportingTime && ` · Arrive by ${formatTime(appt.reportingTime)}`}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => { setApptLookupQuery({ token: appt.appointmentToken || '', reference: appt.appointmentReference || '', name: '', phone: '' }); setActiveTab('apptlookup'); }}
                            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold shrink-0 ml-2">
                            Check In
                          </button>
                        </div>
                      ))}
                      {bookedNotArrived.length > 8 && (
                        <div className="px-4 py-2 text-xs text-amber-600 text-center">
                          +{bookedNotArrived.length - 8} more booked appointments
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {queueLoading ? (
                  <div className="text-center py-12">
                    <ArrowPathIcon className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-2" />
                    <p className="text-gray-500">Loading queue...</p>
                  </div>
                ) : todaysQueue.length === 0 ? (
                  <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                    <ClipboardDocumentListIcon className="w-16 h-16 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-lg">No active queue entries yet today</p>
                  </div>
                ) : todaysQueue.filter(e => queueFilter === 'all' || e.status === queueFilter).length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                    <ClipboardDocumentListIcon className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500">No entries with status <strong>{queueFilter.replace(/_/g, ' ')}</strong></p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todaysQueue.filter(entry => queueFilter === 'all' || entry.status === queueFilter).map(entry => {
                      const tokenBg = entry.tokenType === 'E' ? 'bg-red-600' : entry.tokenType === 'W' ? 'bg-amber-500' : 'bg-blue-600';
                      const isActive = ['waiting', 'ready', 'called', 'emergency_waiting'].includes(entry.status);
                      return (
                        <div key={entry._id} className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                          entry.status === 'in_consultation' ? 'bg-purple-50 border-purple-200' :
                          entry.status === 'ready' || entry.status === 'called' ? 'bg-orange-50 border-orange-200' :
                          entry.status === 'waiting' || entry.status === 'emergency_waiting' ? 'bg-blue-50 border-blue-200' :
                          entry.status === 'temporarily_away' ? 'bg-yellow-50 border-yellow-200' :
                          entry.status === 'skipped' ? 'bg-gray-50 border-gray-200 opacity-70' :
                          entry.status === 'completed' ? 'bg-green-50 border-green-100' :
                          'bg-red-50 border-red-100'
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className={`text-xl font-black min-w-[80px] text-center px-2 py-1.5 rounded-lg text-white ${tokenBg}`}>
                              {entry.queueNumber}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">
                                {entry.patient?.firstName} {entry.patient?.lastName}
                                {entry.isEmergency && <span className="ml-2 text-red-600 text-xs font-bold"> EMERGENCY</span>}
                                {entry.priority === 'urgent' && !entry.isEmergency && <span className="ml-2 text-red-500 text-xs font-bold"> URGENT</span>}
                                {entry.isWalkIn && <span className="ml-2 text-amber-600 text-xs font-medium">Walk-in</span>}
                                {entry.isLate && <span className="ml-2 text-orange-600 text-xs font-bold"> Late</span>}
                              </p>
                              <p className="text-sm text-gray-500">
                                Dr. {entry.doctor?.firstName} {entry.doctor?.lastName} · {entry.room} · Check-in: {entry.checkInTime ? new Date(entry.checkInTime).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' }) : '—'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            {getStatusBadge(entry.status)}
                            {['waiting', 'ready', 'called', 'emergency_waiting'].includes(entry.status) && (
                              <button onClick={async () => {
                                try { await queueAPI.markTemporarilyAway(entry._id); toast.success('Marked away'); fetchTodaysQueue(); }
                                catch { toast.error('Failed'); }
                              }} className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 border border-yellow-300 rounded-lg hover:bg-yellow-200">
                                Away
                              </button>
                            )}
                            {['temporarily_away', 'skipped'].includes(entry.status) && (
                              <button onClick={async () => {
                                try { await queueAPI.markReturned(entry._id); toast.success('Patient returned'); fetchTodaysQueue(); }
                                catch { toast.error('Failed'); }
                              }} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-200">
                                 Returned
                              </button>
                            )}
                            {['waiting', 'ready', 'called'].includes(entry.status) && (
                              <button onClick={async () => {
                                try { await queueAPI.markNoShow(entry._id); toast.success('Marked no-show'); fetchTodaysQueue(); }
                                catch { toast.error('Failed'); }
                              }} className="text-xs px-2 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50">
                                No-show
                              </button>
                            )}
                            {/* Doctor assign button */}
                            <button onClick={() => setAssignDoctorEntry(entry)}
                              className="text-xs px-2 py-1 border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 flex items-center gap-1">
                              <UserIcon className="w-3 h-3" />
                              Assign Dr.
                            </button>
                            <button onClick={() => printQueueSlip(entry, entry.isWalkIn)}
                              className="text-xs px-2 py-1 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 flex items-center gap-1">
                              <PrinterIcon className="w-3 h-3" />
                              Print
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                TAB 3 — PATIENT SEARCH
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'search' && (
              <div>
                <div className="flex items-center space-x-3 mb-6">
                  <MagnifyingGlassIcon className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-bold text-gray-900">Search Patients</h2>
                </div>
                <div className="flex space-x-3 mb-6">
                  <div className="flex-1 relative">
                    <MagnifyingGlassIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      onKeyPress={e => e.key === 'Enter' && searchPatients()}
                      placeholder="Name, Health Card ID, email, or phone..."
                      className="w-full pl-12 pr-4 py-3.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  </div>
                  <button onClick={searchPatients} disabled={searchLoading}
                    className="px-6 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-semibold flex items-center space-x-2 shadow-md">
                    {searchLoading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <MagnifyingGlassIcon className="w-5 h-5" />}
                    <span>Search</span>
                  </button>
                </div>
                <div className="space-y-3">
                  {searchResults.map(patient => (
                    <div key={patient._id} className="flex items-center justify-between p-5 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:shadow-md transition-all bg-white">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                          <UserIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{patient.firstName} {patient.lastName}</p>
                          <div className="flex items-center space-x-3 text-sm text-gray-500">
                            <span className="font-mono">{patient.digitalHealthCardId || 'No card'}</span>
                            <span>·</span><span>{patient.email}</span>
                            <span>·</span><span>{patient.phone || 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          try {
                            const res = await receptionAPI.printHealthCard(patient._id);
                            if (res.data.success) {
                              const p = res.data.data.printPayload;
                              printHealthCardSlip(p);
                            }
                          } catch { toast.error('Failed to get health card data'); }
                        }}
                          className="px-3 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all text-sm font-semibold flex items-center gap-1">
                          <PrinterIcon className="w-4 h-4" /> Card
                        </button>
                        <button onClick={() => { setSelectedPatient(patient); setActiveTab('records'); }}
                          className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all text-sm font-semibold">
                          Select
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                TAB 4 — IDENTITY VERIFICATION
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'verify' && (
              <div>
                <div className="flex items-center space-x-3 mb-6">
                  <ShieldCheckIcon className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-bold text-gray-900">Verify Patient Identity</h2>
                </div>
                <div className="flex space-x-2 mb-6">
                  {['all', 'pending', 'verified', 'rejected'].map(s => (
                    <button key={s} onClick={() => setFilterStatus(s)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                        filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                {verifyLoading ? (
                  <div className="text-center py-12"><ArrowPathIcon className="w-8 h-8 text-blue-400 animate-spin mx-auto" /></div>
                ) : (
                  <div className="space-y-3">
                    {patientsForVerification.map(patient => (
                      <div key={patient._id} className="p-5 bg-white border-2 border-gray-100 rounded-xl hover:shadow-md transition-all">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-4 flex-1">
                            <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center">
                              <UserIcon className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center space-x-3 mb-1">
                                <h3 className="font-semibold text-gray-900">{patient.firstName} {patient.lastName}</h3>
                                {getStatusBadge(patient.identityVerificationStatus || 'unverified')}
                                {patient.registeredBy && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                                    {patient.registeredBy === 'Self' ? 'Self-registered' : `Reg. by ${patient.registeredBy}`}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                                <span>{patient.email}</span>
                                <span>NIC: {patient.nicNumber || 'Not provided'}</span>
                                {patient.nicDocument && <span className="text-green-600 font-medium">Document uploaded</span>}
                                {patient.verifiedBy && (
                                  <span className="text-blue-600">
                                    Verified by {patient.verifiedBy.firstName} {patient.verifiedBy.lastName}
                                    {patient.verifiedAt && ` · ${new Date(patient.verifiedAt).toLocaleDateString()}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {patient.identityVerificationStatus !== 'verified' && (
                            <button onClick={() => { setSelectedPatient(patient); setVerificationNote(''); }}
                              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 shrink-0">
                              Review
                            </button>
                          )}
                        </div>
                        {selectedPatient?._id === patient._id && (
                          <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                            {/* NIC document preview if uploaded */}
                            {nicImageUrl && <img src={nicImageUrl} alt="NIC Document" className="max-h-48 rounded-lg object-contain border" />}

                            {/* Checklist for receptionist */}
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
                              <p className="font-semibold">Before marking as verified, confirm:</p>
                              <p>✓ NIC number matches record: <strong>{patient.nicNumber || 'Not on file'}</strong></p>
                              <p>✓ Full name on NIC matches: <strong>{patient.firstName} {patient.lastName}</strong></p>
                              {patient.dateOfBirth && <p>✓ Date of birth matches: <strong>{new Date(patient.dateOfBirth).toLocaleDateString()}</strong></p>}
                            </div>

                            <textarea value={verificationNote} onChange={e => setVerificationNote(e.target.value)}
                              placeholder="Add a note (optional)..." rows={2}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <div className="flex space-x-2">
                              <button onClick={() => handleVerifyIdentity(patient._id, 'verified', verificationNote)}
                                className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 flex items-center justify-center space-x-1">
                                <CheckCircleIcon className="w-4 h-4" /><span>NIC Seen and Verified</span>
                              </button>
                              <button onClick={() => handleVerifyIdentity(patient._id, 'rejected', verificationNote)}
                                className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 flex items-center justify-center space-x-1">
                                <XCircleIcon className="w-4 h-4" /><span>Cannot Verify</span>
                              </button>
                              <button onClick={() => setSelectedPatient(null)}
                                className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                                <XMarkIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {patientsForVerification.length === 0 && (
                      <div className="text-center py-12 text-gray-400">
                        <ShieldCheckIcon className="w-12 h-12 mx-auto mb-2" />
                        <p>No patients in this category</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════
                TAB 5 — UPLOAD LAB TESTS (preserved from original)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'records' && (
              <div>
                <div className="flex items-center space-x-3 mb-6">
                  <DocumentArrowUpIcon className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-bold text-gray-900">Upload Lab Test Documents</h2>
                </div>
                {!selectedPatient ? (
                  <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                    <UserIcon className="w-16 h-16 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 mb-4">Select a patient from the Search tab first</p>
                    <button onClick={() => setActiveTab('search')}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold">
                      Search for Patient
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div>
                        <p className="text-xs text-blue-600 font-semibold mb-0.5">Selected Patient</p>
                        <p className="font-bold text-blue-900">{selectedPatient.firstName} {selectedPatient.lastName}</p>
                        <p className="text-xs text-blue-600">{selectedPatient.digitalHealthCardId || 'No health card'}</p>
                      </div>
                      <button onClick={() => { setSelectedPatient(null); setPatientMedicalHistory([]); setSelectedFiles({}); }}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium">Change</button>
                    </div>
                    {patientMedicalHistory.length > 0 ? (
                      <div className="space-y-3">
                        {patientMedicalHistory.map((record, i) => (
                          <div key={record._id || i} className="bg-white border-2 border-gray-200 rounded-xl p-5">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="font-bold text-gray-900">{record.title}</h4>
                                <p className="text-sm text-gray-500">{record.description}</p>
                                <p className="text-xs text-gray-400 mt-1">{new Date(record.createdAt).toLocaleDateString()}</p>
                              </div>
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold">{record.recordType}</span>
                            </div>
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <label className="block text-xs font-semibold text-gray-600 mb-2">Upload Lab Results</label>
                              <div className="flex items-center space-x-3">
                                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png"
                                  onChange={e => handleFileSelect(e, record._id)}
                                  className="text-sm text-gray-500 file:mr-3 file:px-4 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:text-sm file:font-medium hover:file:bg-blue-700" />
                                {selectedFiles[record._id]?.length > 0 && (
                                  <button onClick={() => uploadDocuments(record._id)} disabled={uploadLoading}
                                    className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                                    Upload ({selectedFiles[record._id].length})
                                  </button>
                                )}
                              </div>
                              {(() => {
                                // Combine legacy embedded attachments with the new
                                // shared-collection uploads linked to this record.
                                const attached = [
                                  ...(record.documents || []).map(d => ({
                                    url: d.fileUrl, name: d.fileName
                                  })),
                                  ...patientDocuments
                                    .filter(d => String(d.medicalRecord) === String(record._id))
                                    .map(d => ({ url: d.fileUrl, name: d.originalName || d.title }))
                                ];
                                if (attached.length === 0) return null;
                                return (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {attached.map((doc, di) => (
                                      <a key={di} href={resolveFileUrl(doc.url)}
                                        target="_blank" rel="noopener noreferrer"
                                        className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg flex items-center space-x-1 hover:bg-green-100">
                                        <DocumentTextIcon className="w-3 h-3" /><span>{doc.name}</span>
                                      </a>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-10 text-gray-400">
                        <DocumentTextIcon className="w-12 h-12 mx-auto mb-2" />
                        <p>No medical records found for this patient</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Doctor Assignment Modal ── */}
      {assignDoctorEntry && (
        <AssignDoctorModal
          entry={assignDoctorEntry}
          onClose={() => setAssignDoctorEntry(null)}
          onAssigned={fetchTodaysQueue}
        />
      )}
    </div>
  );
};

// ── Health card print helper ─────────────────────────────────────────────────
const printHealthCardSlip = (p) => {
  const allergies = (p.allergies || []).join(', ') || 'None';
  const html = `
    <html><head><title>Health Card</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; max-width: 340px; margin: 0 auto; font-size: 13px; }
      .card { border: 2px solid #2563eb; border-radius: 12px; padding: 16px; }
      .header { background: #2563eb; color: white; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
      .title { font-size: 18px; font-weight: bold; }
      .subtitle { font-size: 11px; opacity: 0.8; }
      .cardno { font-size: 20px; font-weight: bold; font-family: monospace; letter-spacing: 2px; color: #2563eb; text-align: center; margin: 10px 0; }
      .row { display: flex; justify-content: space-between; margin: 4px 0; }
      .label { color: #6b7280; }
      .value { font-weight: 600; }
      .qr { text-align: center; margin: 12px 0; }
      .qr img { width: 120px; height: 120px; border: 1px solid #e5e7eb; border-radius: 8px; }
      .divider { border-top: 1px dashed #d1d5db; margin: 8px 0; }
      .footer { font-size: 10px; color: #9ca3af; text-align: center; margin-top: 8px; }
    </style></head>
    <body>
      <div class="card">
        <div class="header">
          <div class="title">MediQueue Health Card</div>
          <div class="subtitle">${p.hospital?.name || 'MediQueue Hospital'}</div>
        </div>
        <div class="cardno">${p.cardNumber}</div>
        <div class="row"><span class="label">Name:</span><span class="value">${p.patient.fullName}</span></div>
        ${p.patient.dateOfBirth ? `<div class="row"><span class="label">DOB:</span><span class="value">${new Date(p.patient.dateOfBirth).toLocaleDateString()}</span></div>` : ''}
        ${p.patient.gender ? `<div class="row"><span class="label">Gender:</span><span class="value capitalize">${p.patient.gender}</span></div>` : ''}
        ${p.patient.phone ? `<div class="row"><span class="label">Phone:</span><span class="value">${p.patient.phone}</span></div>` : ''}
        ${p.patient.nicNumber ? `<div class="row"><span class="label">NIC:</span><span class="value">${p.patient.nicNumber}</span></div>` : ''}
        ${p.bloodGroup ? `<div class="row"><span class="label">Blood Group:</span><span class="value">${p.bloodGroup}</span></div>` : ''}
        <div class="divider"></div>
        <div class="row"><span class="label">Allergies:</span><span class="value">${allergies}</span></div>
        ${p.patient.emergencyContact?.phone ? `<div class="row"><span class="label">Emergency:</span><span class="value">${p.patient.emergencyContact.name || ''} ${p.patient.emergencyContact.phone}</span></div>` : ''}
        <div class="divider"></div>
        <div class="qr"><img src="${p.qrCode}" alt="QR" /></div>
        <div class="footer">Issued: ${new Date(p.issueDate).toLocaleDateString()} · Expires: ${new Date(p.expiryDate).toLocaleDateString()}<br/>Printed: ${new Date().toLocaleString()}</div>
      </div>
      <script>
        (function () {
          // Print only AFTER the QR image has decoded. Calling window.print()
          // before the data-URL image paints can stall the print preview and
          // freeze the opener window, so gate on the image's load/error events.
          var printed = false;
          function doPrint() {
            if (printed) return;
            printed = true;
            // Close once the print dialog is dismissed rather than racing it.
            window.onafterprint = function () { window.close(); };
            try { window.focus(); window.print(); } catch (e) { window.close(); }
            // Safety net if onafterprint never fires (some browsers).
            setTimeout(function () { window.close(); }, 60000);
          }
          var img = document.querySelector('img');
          if (img && !img.complete) {
            img.addEventListener('load', doPrint);
            img.addEventListener('error', doPrint);
            // Fallback in case neither event fires.
            setTimeout(doPrint, 3000);
          } else {
            doPrint();
          }
        })();
      </script>
    </body></html>`;
  const win = window.open('', '_blank', 'width=390,height=750');
  if (win) { win.document.write(html); win.document.close(); }
};

// ── Assign Doctor Modal ───────────────────────────────────────────────────────
const AssignDoctorModal = ({ entry, onClose, onAssigned }) => {
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await userAPI.getDoctors();
        if (res.data.success) setDoctors(res.data.data.doctors || []);
      } catch { /* silent */ }
    })();
  }, []);

  const handleAssign = async () => {
    if (!selectedDoctorId) { toast.error('Select a doctor'); return; }
    try {
      setSaving(true);
      const res = await receptionAPI.assignDoctor({ queueEntryId: entry._id, doctorId: selectedDoctorId, reason });
      if (res.data.success) {
        toast.success(`Doctor assigned: ${res.data.data.doctor.firstName} ${res.data.data.doctor.lastName}`);
        onAssigned();
        onClose();
      }
    } catch (err) { toast.error(err.response?.data?.message || 'Assignment failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Assign Doctor</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Patient: <strong>{entry.patient?.firstName} {entry.patient?.lastName}</strong> · Token: <strong>{entry.queueNumber}</strong>
        </p>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Select Doctor *</label>
          <select value={selectedDoctorId} onChange={e => setSelectedDoctorId(e.target.value)}
            className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500">
            <option value="">Choose a doctor...</option>
            {doctors.map(d => (
              <option key={d._id} value={d._id}>
                Dr. {d.firstName} {d.lastName} — {d.specialization || d.department || 'General'}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-6">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Reason (optional)</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Load balancing"
            className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleAssign} disabled={saving || !selectedDoctorId}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckCircleIcon className="w-4 h-4" />}
            Assign Doctor
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Inline doctor search for walk-in check-in ────────────────────────────────
const DoctorSearchInput = ({ value, onChange, department }) => {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
    const fetchDoctors = async () => {
      try {
        setLoading(true);
        const params = department ? { department } : {};
        const res = await userAPI.getDoctors(params);
        if (res.data.success) setDoctors(res.data.data.doctors || res.data.data || []);
      } catch { /* silent */ }
      finally { setLoading(false); }
    };
    fetchDoctors();
  }, [department]);

  const filtered = doctors.filter(d =>
    `${d.firstName} ${d.lastName} ${d.specialization}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <input type="text" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={department ? `Search doctor in ${department}...` : 'Select a department first, or search all doctors...'}
        className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm mb-2" />
      {loading ? (
        <p className="text-xs text-gray-400">Loading doctors...</p>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {filtered.map(d => (
            <button key={d._id} type="button" onClick={() => { onChange(d._id); setQuery(`Dr. ${d.firstName} ${d.lastName}`); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                value === d._id ? 'bg-blue-100 text-blue-800 font-semibold' : 'hover:bg-gray-100 text-gray-700'
              }`}>
              Dr. {d.firstName} {d.lastName}
              <span className="text-gray-400 ml-2 text-xs">· {d.specialization || 'General'}</span>
            </button>
          ))}
          {filtered.length === 0 && !loading && !value && (
            <p className="text-xs text-gray-400 px-3">
              {department ? 'No doctors available for selected department.' : 'No doctors found'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ReceptionistDashboard;
