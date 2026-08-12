import React, { useState, useEffect } from 'react';
import {
  CalendarIcon,
  UserIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  DocumentTextIcon,
  PlusIcon,
  ChartBarIcon,
  HomeIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { appointmentAPI, medicalRecordsAPI, queueAPI, doctorAPI, roomAPI, timeBlockAPI, userAPI } from '../../services/api';
import socketService from '../../services/socket';
import ConsultationNoteModal from '../../components/doctor/ConsultationNoteModal';
import toast from 'react-hot-toast';

const formatTime = (timeString) => {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  if (isNaN(hour)) return timeString;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const DoctorDashboardEnhanced = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [_allAppointments, setAllAppointments] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [selectedPatient, _setSelectedPatient] = useState(null);
  const [patientRecords, setPatientRecords] = useState([]);
  const [availability, setAvailability] = useState({});
  const [assignedRoom, setAssignedRoom] = useState(null);
  const [todayBlocks, setTodayBlocks] = useState([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  // Only OPD doctors (departments with admin-managed rooms) get the room badge.
  const [isOpdDoctor, setIsOpdDoctor] = useState(false);
  const [stats, setStats] = useState({
    today: 0,
    pending: 0,
    completed: 0,
    total: 0,
    thisWeek: 0,
    thisMonth: 0
  });

  const tabs = [
    { id: 'overview', name: 'Overview', icon: ChartBarIcon },
    { id: 'queue', name: 'Live Queue', icon: UserIcon },
    { id: 'availability', name: 'Availability', icon: ClockIcon },
    { id: 'records', name: 'Patient Records', icon: DocumentTextIcon, href: '/doctor/patient-records' },
  ];

  const [liveQueue, setLiveQueue] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueSession, setQueueSession] = useState(null);
  const [pauseMessage, setPauseMessage] = useState('');
  const [showPauseInput, setShowPauseInput] = useState(false);
  // Consultation note modal
  const [noteModalEntry, setNoteModalEntry] = useState(null);

  // Load the room this doctor is assigned to, then today's time blocks for that
  // room's department (the same blocks the admin manages).
  const fetchRoomAndBlocks = async () => {
    if (!user?._id) return;
    try {
      setBlocksLoading(true);
      const roomsRes = await roomAPI.getRooms();
      const rooms = roomsRes.data.success ? (roomsRes.data.data || []) : [];
      const myRoom = rooms.find(r =>
        (r.assignedDoctors || []).some(d => (d._id || d) === user._id)
      ) || null;
      setAssignedRoom(myRoom);

      const departmentId = myRoom?.department?._id || myRoom?.department;
      if (departmentId) {
        const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
        const blocksRes = await timeBlockAPI.getBlocks({ departmentId, date: today, includeAll: 'true' });
        setTodayBlocks(blocksRes.data.success ? (blocksRes.data.data || []) : []);
      } else {
        setTodayBlocks([]);
      }
    } catch {
      // Non-critical: header just won't show a room / blocks
    } finally {
      setBlocksLoading(false);
    }
  };

  useEffect(() => {
    fetchDoctorData();
    fetchAvailability();
    fetchRoomAndBlocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'queue') fetchLiveQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Socket.io: real-time queue updates for this doctor
  useEffect(() => {
    if (!user?._id) return;

    const handleQueueCreated = (data) => {
      // Flash notification if the new entry is for this doctor
      const doctorId = data?.queueEntry?.doctor?._id?.toString() ?? data?.queueEntry?.doctor?.toString();
      if (doctorId === user._id) {
        toast.custom((t) => (
          <div className={`bg-blue-600 text-white px-6 py-4 rounded-xl shadow-xl flex items-center space-x-3 ${
            t.visible ? 'animate-enter' : 'animate-leave'
          }`}>
            <span className="text-xl"></span>
            <div>
              <p className="font-bold">New Patient in Queue</p>
              <p className="text-sm opacity-90">Queue #{data.queueEntry.queueNumber} — {data.room}</p>
            </div>
          </div>
        ), { duration: 6000 });
      }
      // Always refresh if on queue tab
      if (activeTab === 'queue') fetchLiveQueue();
    };

    const handleQueueUpdated = () => {
      if (activeTab === 'queue') fetchLiveQueue();
      else if (activeTab === 'overview') fetchDoctorData();
    };

    // Admin (re)assigned this doctor to/from a room — refresh the badge + blocks live.
    const handleRoomAssignmentChanged = () => fetchRoomAndBlocks();

    // Patient uploaded a document linked to one of this doctor's appointments
    const handleDocumentUploaded = (data) => {
      const apptDate = data.appointmentDate
        ? new Date(data.appointmentDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : null;
      toast.success(
        `${data.patientName} uploaded "${data.documentTitle}"${apptDate ? ` (appt. ${apptDate})` : ''}.`,
        { duration: 9000, icon: '📄' }
      );
    };

    socketService.on('queue:created', handleQueueCreated);
    socketService.on('queue:updated', handleQueueUpdated);
    socketService.on('queue:completed', handleQueueUpdated);
    socketService.on('queue:called', handleQueueUpdated);
    socketService.on('queue:recalculated', handleQueueUpdated);
    socketService.on('queue:paused', handleQueueUpdated);
    socketService.on('queue:resumed', handleQueueUpdated);
    socketService.on('room:assignment-changed', handleRoomAssignmentChanged);
    socketService.on('notification:document-uploaded', handleDocumentUploaded);

    return () => {
      socketService.off('queue:created', handleQueueCreated);
      socketService.off('queue:updated', handleQueueUpdated);
      socketService.off('queue:completed', handleQueueUpdated);
      socketService.off('queue:called', handleQueueUpdated);
      socketService.off('queue:recalculated', handleQueueUpdated);
      socketService.off('queue:paused', handleQueueUpdated);
      socketService.off('queue:resumed', handleQueueUpdated);
      socketService.off('room:assignment-changed', handleRoomAssignmentChanged);
      socketService.off('notification:document-uploaded', handleDocumentUploaded);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id, activeTab]);


  const fetchLiveQueue = async () => {
    if (!user?._id) return;
    try {
      setQueueLoading(true);
      const res = await queueAPI.getActiveQueue(user._id);
      if (res.data.success) {
        const view = res.data.data;
        // Flatten into a single list ordered: current → emergency → ready → waiting → skipped/away
        const ordered = [
          ...(view.current   || []),
          ...(view.emergency || []),   // emergency patients jump ahead of the ready zone
          ...(view.ready     || []),
          ...(view.waiting   || []),
          ...(view.skipped   || []),
          ...(view.away      || []),
          ...(view.completed || []),
          ...(view.noShow    || [])
        ];
        setLiveQueue(ordered);
        setQueueSession(view.session || null);
      }
    } catch {
      toast.error('Failed to load queue');
    } finally {
      setQueueLoading(false);
    }
  };

  const handleQueueAction = async (id, action, extra = {}) => {
    try {
      const actionMap = {
        call:             () => queueAPI.callPatient(id),
        start:            () => queueAPI.startConsultation(id),
        complete:         () => queueAPI.completeConsultation(id, extra.notes),
        skip:             () => queueAPI.skipPatient(id, extra.reason),
        'no-show':        () => queueAPI.markNoShow(id),
        'away':           () => queueAPI.markTemporarilyAway(id),
        'returned':       () => queueAPI.markReturned(id),
        'pause':          () => queueAPI.pauseQueue(user._id, extra.message),
        'resume':         () => queueAPI.resumeQueue(user._id)
      };
      const fn = actionMap[action];
      if (!fn) return;
      await fn();
      const labels = {
        call: 'Patient called', start: 'Consultation started', complete: 'Consultation completed',
        skip: 'Patient skipped', 'no-show': 'Marked as no-show',
        away: 'Patient marked temporarily away', returned: 'Patient returned to queue',
        pause: 'Queue paused', resume: 'Queue resumed'
      };
      toast.success(labels[action] || 'Done');
      fetchLiveQueue();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    }
  };



  const fetchDoctorData = async () => {
    const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, not UTC

    try {
      setLoading(true);

      // Fetch doctor's appointments
      const response = await appointmentAPI.getDoctorAppointments(user._id);

      if (response.data.success) {
        const allAppointments = response.data.data.appointments || [];

        // Filter appointments by local date
        const todayAppts = allAppointments.filter(apt => {
          const aptDate = new Date(apt.appointmentDate).toLocaleDateString('en-CA');
          return aptDate === today;
        });

        // Strictly tomorrow and beyond — string comparison works for YYYY-MM-DD
        const upcomingAppts = allAppointments.filter(apt => {
          const aptDate = new Date(apt.appointmentDate).toLocaleDateString('en-CA');
          return aptDate > today;
        });
        
        setTodayAppointments(todayAppts);
        setUpcomingAppointments(upcomingAppts.slice(0, 5));
        setAllAppointments(allAppointments);
        
        setStats(prevStats => ({
          ...prevStats,
          today: todayAppts.length,
          pending: allAppointments.filter(apt => apt.status === 'scheduled').length,
          completed: allAppointments.filter(apt => apt.status === 'completed').length,
          total: allAppointments.length,
          thisWeek: allAppointments.length,
          thisMonth: allAppointments.length
        }));
      }
    } catch (error) {
      console.error('Error fetching doctor data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };



  const fetchPatientRecords = async (patientId) => {
    try {
      const response = await medicalRecordsAPI.getRecords(patientId);
      if (response.data.success) {
        setPatientRecords(response.data.data.records || []);
      }
    } catch (error) {
      console.error('Error fetching patient records:', error);
      toast.error('Failed to load patient records');
    }
  };

  const fetchAvailability = async () => {
    try {
      // Load from DB first so DoctorAvailabilityService always has current data.
      // Fall back to localStorage only when the DB has no availability set.
      const defaultAvailability = {
        monday:    { enabled: true,  startTime: '09:00', endTime: '17:00' },
        tuesday:   { enabled: true,  startTime: '09:00', endTime: '17:00' },
        wednesday: { enabled: true,  startTime: '09:00', endTime: '17:00' },
        thursday:  { enabled: true,  startTime: '09:00', endTime: '17:00' },
        friday:    { enabled: true,  startTime: '09:00', endTime: '17:00' },
        saturday:  { enabled: false, startTime: '09:00', endTime: '13:00' },
        sunday:    { enabled: false, startTime: '09:00', endTime: '13:00' }
      };

      try {
        const res = await doctorAPI.getSchedule();
        if (res.data.success && res.data.data?.availability) {
          const dbAvailability = res.data.data.availability;
          // Merge DB data with defaults so every day key is always present
          const merged = {};
          for (const day of Object.keys(defaultAvailability)) {
            merged[day] = dbAvailability[day] ?? defaultAvailability[day];
          }
          setAvailability(merged);
          localStorage.setItem(`doctor_availability_${user._id}`, JSON.stringify(merged));
          return;
        }
      } catch { /* DB fetch failed — fall through to localStorage */ }

      // Fall back to localStorage
      const saved = localStorage.getItem(`doctor_availability_${user._id}`);
      setAvailability(saved ? JSON.parse(saved) : defaultAvailability);
    } catch (error) {
      console.error('Error fetching availability:', error);
    }
  };

  const updateAvailability = async (newAvailability) => {
    try {
      // Keep localStorage in sync for instant UI feedback
      localStorage.setItem(`doctor_availability_${user._id}`, JSON.stringify(newAvailability));
      setAvailability(newAvailability);

      // Derive workingDays from the enabled flags so both availability signals
      // that DoctorAvailabilityService reads stay in agreement.
      const DAY_NAMES = {
        monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
        thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday'
      };
      const workingDays = Object.entries(newAvailability)
        .filter(([, cfg]) => cfg?.enabled)
        .map(([day]) => DAY_NAMES[day] || day);

      // Save availability to DB and sync workingDays in a single profile update
      const [availRes] = await Promise.all([
        doctorAPI.updateAvailability(newAvailability),
        userAPI.updateProfile(user._id, { workingDays })
      ]);

      if (availRes.data.success) {
        toast.success('Availability updated successfully');
      }
    } catch (error) {
      console.error('Error updating availability:', error);
      toast.error('Failed to update availability');
    }
  };

  const createMedicalRecord = async (patientId, recordData) => {
    try {
      const response = await medicalRecordsAPI.createRecord({
        patient: patientId,
        doctor: user._id,
        ...recordData
      });
      if (response.data.success) {
        toast.success('Medical record created successfully');
        fetchPatientRecords(patientId);
      }
    } catch (error) {
      console.error('Error creating medical record:', error);
      toast.error('Failed to create medical record');
    }
  };
  
  const updateAppointmentStatus = async (appointmentId, status) => {
    try {
      const response = await appointmentAPI.updateStatus(appointmentId, status);
      if (response.data.success) {
        toast.success(`Appointment ${status} successfully`);
        fetchDoctorData();
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
      toast.error('Failed to update appointment status');
    }
  };
  
  const getStatusColor = (status) => {
    switch (status) {
      case 'scheduled':
      case 'booked':       return 'bg-blue-100 text-blue-800';
      case 'confirmed':    return 'bg-green-100 text-green-800';
      case 'checked_in':   return 'bg-teal-100 text-teal-800';
      case 'in_queue':     return 'bg-indigo-100 text-indigo-800';
      case 'in_consultation':
      case 'in-progress':  return 'bg-purple-100 text-purple-800';
      case 'completed':    return 'bg-gray-100 text-gray-800';
      case 'cancelled':    return 'bg-red-100 text-red-800';
      case 'no-show':      return 'bg-orange-100 text-orange-800';
      default:             return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 flex items-center justify-center">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-32"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50">
      {/* Consultation Note Modal */}
      {noteModalEntry && (
        <ConsultationNoteModal
          entry={noteModalEntry}
          doctor={user}
          onClose={() => setNoteModalEntry(null)}
          onSaved={() => {
            setNoteModalEntry(null);
            toast.success('Consultation notes saved!');
          }}
        />
      )}
      {/* Header */}
      <div className="bg-white shadow-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
                <UserIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Dr. {user?.firstName} {user?.lastName}
                </h1>
                <p className="text-gray-600">{user?.specialization || 'General Medicine'}</p>
              </div>
            </div>

            {/* Assigned room — updates whenever an admin reassigns the doctor */}
            <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 border border-blue-100">
              <HomeIcon className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-400">Assigned Room</p>
                <p className="text-sm font-bold text-blue-800">
                  {assignedRoom ? `${assignedRoom.roomNumber} — ${assignedRoom.displayName}` : 'Not assigned'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => { fetchDoctorData(); fetchRoomAndBlocks(); }}
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <ArrowPathIcon className="w-5 h-5" />
              </button>

              <div className="text-right">
                <p className="text-sm text-gray-500">Today</p>
                <p className="text-lg font-semibold text-gray-900">
                  {new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => tab.href ? navigate(tab.href) : setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{tab.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                    <CalendarIcon className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Today's Appointments</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.today}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center">
                    <ClockIcon className="w-6 h-6 text-yellow-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Pending</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                    <CheckCircleIcon className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Completed</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center">
                    <ChartBarIcon className="w-6 h-6 text-teal-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Today's Schedule */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Today's Schedule</h2>
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500">{todayAppointments.length} appointments</span>
                    <button
                      onClick={() => navigate('/doctor/appointments')}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      View All Appointments
                    </button>
                  </div>
                </div>
                
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {todayAppointments.length > 0 ? (
                    todayAppointments.map((appointment) => (
                      <div key={appointment._id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <UserIcon className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">
                                {appointment.patient?.firstName} {appointment.patient?.lastName}
                              </p>
                              <p className="text-sm text-gray-500">{formatTime(appointment.appointmentTime)}</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                              {appointment.status}
                            </span>
                            <div className="flex space-x-1">
                              {appointment.status === 'scheduled' && (
                                <button
                                  onClick={() => updateAppointmentStatus(appointment._id, 'confirmed')}
                                  className="p-1 text-green-600 hover:bg-green-100 rounded"
                                  title="Confirm Appointment"
                                >
                                  <CheckCircleIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {appointment.chiefComplaint && (
                          <p className="mt-2 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                            <strong>Reason:</strong> {appointment.chiefComplaint}
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <CalendarIcon className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                      <p className="text-gray-500">No appointments scheduled for today</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Upcoming Appointments */}
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Upcoming Appointments</h2>
                  <button
                    onClick={() => navigate('/doctor/patient-records')}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                  >
                    View Patient Records
                  </button>
                </div>
                
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {upcomingAppointments.length > 0 ? (
                    upcomingAppointments.map((appointment) => (
                      <div key={appointment._id} className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900">
                              {appointment.patient?.firstName} {appointment.patient?.lastName}
                            </p>
                            <p className="text-sm text-gray-500">
                              {new Date(appointment.appointmentDate).toLocaleDateString()} at {formatTime(appointment.appointmentTime)}
                            </p>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                            {appointment.status}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <ClockIcon className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                      <p className="text-gray-500">No upcoming appointments</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}



        {/* Medical Records Tab */}
        {activeTab === 'records' && (
          <div className="space-y-6">
            {selectedPatient ? (
              <>
                {/* Patient Header */}
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xl font-bold">
                          {selectedPatient.firstName?.charAt(0)}{selectedPatient.lastName?.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900">
                          {selectedPatient.firstName} {selectedPatient.lastName}
                        </h2>
                        <div className="flex items-center space-x-4 text-sm text-gray-600">
                          <span> {selectedPatient.email}</span>
                          <span> {selectedPatient.phone || 'N/A'}</span>
                          <span> {selectedPatient.dateOfBirth 
                            ? new Date(selectedPatient.dateOfBirth).toLocaleDateString()
                            : 'N/A'
                          }</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate('/doctor/patient-records')}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      ← Back to Patient Records
                    </button>
                  </div>
                </div>

                {/* Medical Records */}
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-gray-900">Medical Records</h3>
                    <button
                      onClick={() => {
                        // Open create record modal
                        const diagnosis = prompt('Enter diagnosis:');
                        const treatment = prompt('Enter treatment:');
                        const notes = prompt('Enter notes:');
                        
                        if (diagnosis && treatment) {
                          createMedicalRecord(selectedPatient._id, {
                            diagnosis,
                            treatment,
                            notes,
                            visitDate: new Date().toISOString()
                          });
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <PlusIcon className="w-4 h-4 inline mr-2" />
                      Add Record
                    </button>
                  </div>

                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {patientRecords.length > 0 ? (
                      patientRecords.map((record) => (
                        <div key={record._id} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                <DocumentTextIcon className="w-5 h-5 text-green-600" />
                              </div>
                              <div>
                                <p className="font-semibold text-gray-900">
                                  Dr. {record.doctor?.firstName} {record.doctor?.lastName}
                                </p>
                                <p className="text-sm text-gray-500">
                                  {new Date(record.visitDate || record.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                              {record.recordType || 'General'}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="font-medium text-gray-700 mb-1">Diagnosis:</p>
                              <p className="text-gray-600">{record.diagnosis || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="font-medium text-gray-700 mb-1">Treatment:</p>
                              <p className="text-gray-600">{record.treatment || 'N/A'}</p>
                            </div>
                          </div>
                          
                          {record.notes && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <p className="font-medium text-gray-700 mb-1">Notes:</p>
                              <p className="text-gray-600 text-sm">{record.notes}</p>
                            </div>
                          )}
                          
                          {record.medications && record.medications.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <p className="font-medium text-gray-700 mb-2">Medications:</p>
                              <div className="flex flex-wrap gap-2">
                                {record.medications.map((med, index) => (
                                  <span key={index} className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                                    {med.name} - {med.dosage}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12">
                        <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">No medical records found</p>
                        <p className="text-gray-400">Create the first medical record for this patient</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-12 text-center">
                <UserIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">Select a patient to view medical records</p>
                <button
                  onClick={() => navigate('/doctor/patient-records')}
                  className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Go to Patient Records
                </button>
              </div>
            )}
          </div>
        )}

        {/* Live Queue Tab */}
        {activeTab === 'queue' && (
          <LiveQueueTab
            user={user}
            liveQueue={liveQueue}
            queueSession={queueSession}
            queueLoading={queueLoading}
            onFetch={fetchLiveQueue}
            onAction={handleQueueAction}
            onNotes={setNoteModalEntry}
          />
        )}

        {activeTab === 'availability' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">

              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">Manage Availability</h2>
                <button
                  onClick={() => {
                    const defaultAvailability = {
                      monday: { enabled: true, startTime: '09:00', endTime: '17:00' },
                      tuesday: { enabled: true, startTime: '09:00', endTime: '17:00' },
                      wednesday: { enabled: true, startTime: '09:00', endTime: '17:00' },
                      thursday: { enabled: true, startTime: '09:00', endTime: '17:00' },
                      friday: { enabled: true, startTime: '09:00', endTime: '17:00' },
                      saturday: { enabled: false, startTime: '09:00', endTime: '13:00' },
                      sunday: { enabled: false, startTime: '09:00', endTime: '13:00' }
                    };
                    updateAvailability(defaultAvailability);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Set Default Hours
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Weekly Schedule */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Weekly Schedule</h3>
                  <div className="space-y-4">
                    {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => {
                      const dayAvailability = availability[day] || { enabled: false, startTime: '09:00', endTime: '17:00' };
                      return (
                        <div key={day} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <input
                              type="checkbox"
                              checked={dayAvailability.enabled}
                              onChange={(e) => {
                                const newAvailability = {
                                  ...availability,
                                  [day]: { ...dayAvailability, enabled: e.target.checked }
                                };
                                setAvailability(newAvailability);
                              }}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="font-medium text-gray-900 capitalize w-20">
                              {day}
                            </span>
                          </div>
                          
                          {dayAvailability.enabled && (
                            <div className="flex items-center space-x-2">
                              <input
                                type="time"
                                value={dayAvailability.startTime}
                                onChange={(e) => {
                                  const newAvailability = {
                                    ...availability,
                                    [day]: { ...dayAvailability, startTime: e.target.value }
                                  };
                                  setAvailability(newAvailability);
                                }}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <span className="text-gray-500">to</span>
                              <input
                                type="time"
                                value={dayAvailability.endTime}
                                onChange={(e) => {
                                  const newAvailability = {
                                    ...availability,
                                    [day]: { ...dayAvailability, endTime: e.target.value }
                                  };
                                  setAvailability(newAvailability);
                                }}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            </div>
                          )}
                          
                          {!dayAvailability.enabled && (
                            <span className="text-gray-400 text-sm">Not Available</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => updateAvailability(availability)}
                    className="mt-6 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Save Availability
                  </button>
                </div>

                {/* Current Week Overview */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">This Week's Schedule</h3>
                  <div className="space-y-3">
                    {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day, index) => {
                      const dayAvailability = availability[day] || { enabled: false };
                      const dayAppointments = todayAppointments.filter(apt => {
                        const aptDay = new Date(apt.appointmentDate).getDay();
                        return aptDay === (index + 1) % 7;
                      });
                      
                      return (
                        <div key={day} className="p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-900 capitalize">{day}</span>
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              dayAvailability.enabled 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {dayAvailability.enabled ? 'Available' : 'Off'}
                            </span>
                          </div>
                          
                          {dayAvailability.enabled && (
                            <div className="text-sm text-gray-600">
                              <p>Hours: {dayAvailability.startTime} - {dayAvailability.endTime}</p>
                              <p>Appointments: {dayAppointments.length}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Today's session time blocks — the same blocks the admin manages */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Today's Session Time Blocks</h3>
                {assignedRoom?.department?.name && (
                  <span className="text-xs font-semibold text-gray-500">{assignedRoom.department.name}</span>
                )}
              </div>

              {blocksLoading ? (
                <div className="text-center py-8 text-gray-400 text-sm">Loading time blocks…</div>
              ) : !assignedRoom ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  You are not assigned to a room yet. Ask an admin to assign you so your session blocks appear here.
                </div>
              ) : todayBlocks.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No time blocks scheduled for today.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {todayBlocks.map(b => {
                    const pct = b.appointmentCapacity > 0
                      ? Math.round((b.bookedAppointmentCount / b.appointmentCapacity) * 100)
                      : 0;
                    return (
                      <div key={b._id} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <p className="font-semibold text-sm text-gray-900">{b.sessionName || `${formatTime(b.startTime)} – ${formatTime(b.endTime)}`}</p>
                            <p className="text-xs text-gray-500">{formatTime(b.startTime)} – {formatTime(b.endTime)}</p>
                          </div>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            b.status === 'active' ? 'bg-green-100 text-green-700' :
                            b.status === 'full'   ? 'bg-red-100 text-red-700' :
                            b.status === 'closed' ? 'bg-gray-100 text-gray-600' :
                            'bg-red-50 text-red-500'
                          }`}>{b.status}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 mb-1">
                          Appt: {b.bookedAppointmentCount}/{b.appointmentCapacity} · Walk-in: {b.walkInCount}/{b.walkInCapacity} · Buffer: {b.emergencyBuffer}
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{pct}% booked</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// Zone-Aware Live Queue Tab
const TOKEN_COLORS = {
  A: 'bg-blue-600 text-white',
  W: 'bg-amber-500 text-white',
  E: 'bg-red-600 text-white',
};

const ZONE_LABELS = {
  CURRENT: { label: 'Now In Consultation', color: 'border-purple-400 bg-purple-50', badge: 'bg-purple-100 text-purple-800' },
  READY:   { label: 'Ready Zone — Please Be Ready', color: 'border-orange-300 bg-orange-50', badge: 'bg-orange-100 text-orange-800' },
  WAITING_POOL: { label: 'Waiting Pool', color: 'border-blue-200 bg-white', badge: 'bg-blue-100 text-blue-800' },
};

const QueueCard = ({ entry, onAction, onNotes }) => {
  const tokenColor = TOKEN_COLORS[entry.tokenType] || 'bg-gray-600 text-white';
  const isActive = ['waiting', 'ready', 'called', 'in_consultation', 'emergency_waiting'].includes(entry.status);

  return (
    <div className={`rounded-xl border-2 p-4 transition-all shadow-sm ${
      entry.status === 'in_consultation' ? 'border-purple-300 bg-purple-50/30' :
      entry.status === 'ready' || entry.status === 'called' ? 'border-orange-300 bg-orange-50/30' :
      entry.status === 'emergency_waiting' ? 'border-red-400 bg-red-50/30' :
      entry.status === 'temporarily_away' ? 'border-yellow-300 bg-yellow-50/30 opacity-75' :
      entry.status === 'skipped' ? 'border-gray-200 bg-gray-50 opacity-60' :
      entry.status === 'completed' ? 'border-gray-100 bg-gray-50 opacity-50' :
      'border-blue-200 bg-white'
    }`}>
      <div className="flex items-center justify-between gap-3">
        {/* Token badge */}
        <div className={`text-xl font-black px-3 py-2 rounded-lg min-w-[80px] text-center shrink-0 ${tokenColor}`}>
          {entry.queueNumber}
        </div>

        {/* Patient info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="font-semibold text-gray-900 truncate">
              {entry.patient?.firstName} {entry.patient?.lastName}
            </span>
            {entry.isEmergency && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold"> EMERGENCY</span>}
            {entry.priority === 'urgent' && !entry.isEmergency && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold"> URGENT</span>}
            {entry.isWalkIn && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Walk-in</span>}
            {entry.isLate && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Late</span>}
            {entry.status === 'temporarily_away' && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Away</span>}
            {entry.status === 'skipped' && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Skipped</span>}
          </div>
          <p className="text-xs text-gray-500 truncate">
            {entry.room}
            {/* Block-based: show appointment token + session name */}
            {entry.appointmentToken && (
              <span className="ml-1 font-mono font-bold text-blue-600">[{entry.appointmentToken}]</span>
            )}
            {entry.appointment?.timeBlockId?.sessionName
              ? ` · ${entry.appointment.timeBlockId.sessionName}`
              : entry.appointmentTime
              ? ` · Appt: ${formatTime(entry.appointmentTime)}`
              : ''}
            {' · '}Check-in: {entry.checkInTime
              ? new Date(entry.checkInTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
              : '—'}
            {isActive && entry.estimatedWaitMinutes > 0 && ` · ~${entry.estimatedWaitMinutes} min wait`}
          </p>
          {entry.notes && <p className="text-xs text-amber-600 mt-0.5 truncate"> {entry.notes}</p>}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {(entry.status === 'waiting' || entry.status === 'ready' || entry.status === 'emergency_waiting') && (
            <>
              <button onClick={() => onAction(entry._id, 'call')}
                className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-semibold hover:bg-orange-600 transition-all">
                 Call
              </button>
              <button onClick={() => onAction(entry._id, 'start')}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 transition-all">
                 Start
              </button>
              <button onClick={() => onAction(entry._id, 'skip')}
                className="px-2 py-1.5 border border-yellow-300 text-yellow-700 rounded-lg text-xs hover:bg-yellow-50 transition-all">
                Skip
              </button>
              <button onClick={() => onAction(entry._id, 'no-show')}
                className="px-2 py-1.5 border border-red-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-all">
                No-show
              </button>
            </>
          )}
          {entry.status === 'called' && (
            <>
              <button onClick={() => onAction(entry._id, 'start')}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 transition-all">
                 Start
              </button>
              <button onClick={() => onAction(entry._id, 'away')}
                className="px-2 py-1.5 border border-yellow-300 text-yellow-700 rounded-lg text-xs hover:bg-yellow-50 transition-all">
                Away
              </button>
              <button onClick={() => onAction(entry._id, 'no-show')}
                className="px-2 py-1.5 border border-red-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-all">
                No-show
              </button>
            </>
          )}
          {entry.status === 'in_consultation' && (
            <button onClick={() => onAction(entry._id, 'complete')}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-all">
              ✓ Complete
            </button>
          )}
          {(entry.status === 'temporarily_away' || entry.status === 'skipped') && (
            <button onClick={() => onAction(entry._id, 'returned')}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-all">
               Returned
            </button>
          )}
          {entry.status === 'completed' && (
            <button onClick={() => onNotes(entry)}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-1">
              <DocumentTextIcon className="w-3.5 h-3.5" />
              Write Prescription
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const LiveQueueTab = ({ user, liveQueue, queueSession, queueLoading, onFetch, onAction, onNotes }) => {
  const [pauseMsg, setPauseMsg] = React.useState('');
  const [showPauseBox, setShowPauseBox] = React.useState(false);

  const sessionStatus = queueSession?.status || 'active';
  const isPaused = sessionStatus === 'paused';
  const isEnded  = sessionStatus === 'ended';

  const current    = liveQueue.filter(e => e.zone === 'CURRENT' || e.status === 'in_consultation');
  const ready      = liveQueue.filter(e => (e.zone === 'READY' || e.status === 'ready' || e.status === 'called') && e.status !== 'in_consultation');
  // Late patients in WAITING_POOL — sorted by sortOrder so they appear at top after CURRENT
  const lateWaiting = liveQueue.filter(e =>
    e.zone === 'WAITING_POOL' && ['waiting', 'emergency_waiting'].includes(e.status) && e.isLate
  ).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  // Normal waiting pool (non-late)
  const waiting    = liveQueue.filter(e =>
    e.zone === 'WAITING_POOL' && ['waiting', 'emergency_waiting'].includes(e.status) && !e.isLate
  );
  const away       = liveQueue.filter(e => e.status === 'temporarily_away');
  const skipped    = liveQueue.filter(e => e.status === 'skipped');
  const completed  = liveQueue.filter(e => e.status === 'completed');

  const activeCount = current.length + ready.length + lateWaiting.length + waiting.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserIcon className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-900">My Live Queue</h2>
          <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full">{activeCount} active</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Pause / Resume — only the action valid for the current session state is shown */}
          {isEnded ? (
            <span className="px-3 py-1.5 bg-gray-100 text-gray-500 border border-gray-300 rounded-lg text-sm font-semibold">
              Session ended
            </span>
          ) : isPaused ? (
            <button onClick={() => onAction(null, 'resume')}
              className="px-3 py-1.5 bg-green-100 text-green-700 border border-green-300 rounded-lg text-sm font-semibold hover:bg-green-200 transition-all">
               Resume
            </button>
          ) : showPauseBox ? (
            <div className="flex items-center gap-2">
              <input
                value={pauseMsg}
                onChange={e => setPauseMsg(e.target.value)}
                placeholder="Reason for pause..."
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                onClick={() => { onAction(null, 'pause', { message: pauseMsg }); setShowPauseBox(false); setPauseMsg(''); }}
                className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm font-semibold hover:bg-yellow-600 transition-all"
              >
                Confirm Pause
              </button>
              <button onClick={() => setShowPauseBox(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowPauseBox(true)}
              className="px-3 py-1.5 bg-yellow-100 text-yellow-700 border border-yellow-300 rounded-lg text-sm font-semibold hover:bg-yellow-200 transition-all">
               Pause Queue
            </button>
          )}
          <button onClick={onFetch}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-blue-600 border border-gray-200 rounded-lg hover:border-blue-300 transition-all">
            <ArrowPathIcon className={`w-4 h-4 ${queueLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {liveQueue.length > 0 && (
        <div className="grid grid-cols-6 gap-2">
          {[
            { label: 'In Consult', count: current.length,               color: 'bg-purple-50 text-purple-700 border-purple-200' },
            { label: 'Ready',      count: ready.length,                  color: 'bg-orange-50 text-orange-700 border-orange-200' },
            { label: 'Late',       count: lateWaiting.length,            color: 'bg-amber-50 text-amber-700 border-amber-300' },
            { label: 'Waiting',    count: waiting.length,                color: 'bg-blue-50 text-blue-700 border-blue-200' },
            { label: 'Away/Skip',  count: away.length + skipped.length,  color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
            { label: 'Completed',  count: completed.length,              color: 'bg-green-50 text-green-700 border-green-200' },
          ].map(s => (
            <div key={s.label} className={`${s.color} border rounded-xl p-2 text-center`}>
              <p className="text-xl font-black">{s.count}</p>
              <p className="text-xs font-medium leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {queueLoading ? (
        <div className="text-center py-12 text-gray-400">
          <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p>Loading queue...</p>
        </div>
      ) : liveQueue.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-12 text-center">
          <UserIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg font-medium">No queue entries today</p>
          <p className="text-gray-400 text-sm">Patients will appear here once checked in by reception</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* CURRENT zone */}
          {current.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-purple-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse inline-block" />
                Now In Consultation
              </h3>
              <div className="space-y-2">{current.map(e => <QueueCard key={e._id} entry={e} onAction={onAction} onNotes={onNotes} />)}</div>
            </section>
          )}

          {/* LATE — Next After Current (positioned by QueueEngine after current, before ready zone) */}
          {lateWaiting.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-orange-700 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full inline-block" />
                 Late Arrivals — Next After Current
                <span className="normal-case font-normal text-orange-500 text-[10px]">
                  (arrived late — served next per hospital policy)
                </span>
              </h3>
              <div className="space-y-2">
                {lateWaiting.map(e => <QueueCard key={e._id} entry={e} onAction={onAction} onNotes={onNotes} />)}
              </div>
            </section>
          )}

          {/* READY zone */}
          {ready.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-400 rounded-full inline-block" />
                Ready Zone — Please Be Ready
              </h3>
              <div className="space-y-2">{ready.map(e => <QueueCard key={e._id} entry={e} onAction={onAction} onNotes={onNotes} />)}</div>
            </section>
          )}

          {/* WAITING POOL (normal, non-late) */}
          {waiting.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-400 rounded-full inline-block" />
                Waiting Pool ({waiting.length})
              </h3>
              <div className="space-y-2">{waiting.map(e => <QueueCard key={e._id} entry={e} onAction={onAction} onNotes={onNotes} />)}</div>
            </section>
          )}

          {/* Away / Skipped */}
          {(away.length > 0 || skipped.length > 0) && (
            <section>
              <h3 className="text-xs font-bold text-yellow-600 uppercase tracking-widest mb-2">
                Temporarily Away / Skipped
              </h3>
              <div className="space-y-2">
                {[...away, ...skipped].map(e => <QueueCard key={e._id} entry={e} onAction={onAction} onNotes={onNotes} />)}
              </div>
            </section>
          )}

          {/* Completed */}
          {completed.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                Completed Today ({completed.length})
              </h3>
              <div className="space-y-2">{completed.map(e => <QueueCard key={e._id} entry={e} onAction={onAction} onNotes={onNotes} />)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default DoctorDashboardEnhanced;
