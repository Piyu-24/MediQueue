import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CalendarIcon,
  DocumentTextIcon,
  ClockIcon,
  UserIcon,
  ChartBarIcon,
  PlusIcon,
  ArrowRightIcon,
  QrCodeIcon,
  UserCircleIcon,
  ShieldCheckIcon,
  XMarkIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { appointmentAPI, medicalRecordsAPI, queueAPI } from '../../services/api';
import socketService from '../../services/socket';
import HealthCardDisplay from '../../components/HealthCard/HealthCardDisplay';
import AppointmentBooking from './AppointmentBooking';
import MedicalRecords from './MedicalRecords';
import NICVerification from '../../components/Patient/NICVerification';
import toast from 'react-hot-toast';

const PatientDashboardEnhanced = () => {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // State management
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [_medicalRecords, setMedicalRecords] = useState([]);
  const [stats, setStats] = useState({
    upcomingAppointments: 0,
    totalRecords: 0,
    recentRecords: 0,
    notifications: 0
  });
  const [activeTab, setActiveTab] = useState('overview');
  const [isFetching, setIsFetching] = useState(false);
  const [queueStatus, setQueueStatus] = useState(null); // today's queue info for this patient
  const [queueLoading, setQueueLoading] = useState(false);
  // Cancellation modal state
  const [cancelModal, setCancelModal] = useState({ open: false, appointmentId: null, appointmentTitle: '' });
  const [cancelling, setCancelling] = useState(false);
  const isFetchingRef = useRef(false);

  // Tab configuration
  const tabs = [
    { id: 'overview', name: 'Overview', icon: ChartBarIcon },
    { id: 'book-appointment', name: 'Book Appointment', icon: CalendarIcon },
    { id: 'appointments', name: 'My Appointments', icon: ClockIcon },
    { id: 'health-card', name: 'Health Card', icon: QrCodeIcon },
    { id: 'documents', name: 'Medical Records', icon: DocumentTextIcon },
    { id: 'profile', name: 'Profile & Verification', icon: UserCircleIcon }
  ];

  // Handle URL parameters for tab navigation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam && tabs.some(tab => tab.id === tabParam)) {
      setActiveTab(tabParam);
    }
    // Refresh data when navigating to overview
    if (tabParam === 'overview' || !tabParam) {
      fetchDashboardData();
      refreshUser(); // Refresh user data to get updated identity verification status
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Fetch dashboard data
  useEffect(() => {
    fetchDashboardData();
    fetchQueueStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Socket.io real-time subscriptions ──────────────────────────────────────
  useEffect(() => {
    if (!user?._id) return;

    // Join personal room so the server can push queue:yourTurn directly
    socketService.joinRoom(user._id);

    const handleYourTurn = (data) => {
      toast.success(`🔔 It's your turn! Queue ${data.queueNumber} — please go to ${data.room}`, {
        duration: 10000,
      });
      // Attempt browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('MediQueue — Your Turn!', {
          body: `Queue ${data.queueNumber} — Please proceed to ${data.room}`,
          icon: '/logo192.png',
        });
      } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
      fetchQueueStatus();
    };

    const handleCheckedIn = () => fetchQueueStatus();
    const handleQueueUpdated = (data) => {
      // Only refresh if it looks like it might be for this patient
      if (data?.queueEntry?.patient === user._id || !data?.queueEntry) {
        fetchQueueStatus();
      }
    };

    const handleDoctorUnavailable = () => {
      toast.error('Your doctor is unavailable. Please reschedule your appointment.');
      fetchDashboardData();
    };

    socketService.on('queue:yourTurn', handleYourTurn);
    socketService.on('queue:checkedIn', handleCheckedIn);
    socketService.on('queue:updated', handleQueueUpdated);
    socketService.on('queue:completed', handleQueueUpdated);
    socketService.on('queue:recalculated', handleQueueUpdated);
    socketService.on('queue:paused', handleQueueUpdated);
    socketService.on('queue:resumed', handleQueueUpdated);
    socketService.on('appointment:doctor-unavailable', handleDoctorUnavailable);

    return () => {
      socketService.off('queue:yourTurn', handleYourTurn);
      socketService.off('queue:checkedIn', handleCheckedIn);
      socketService.off('queue:updated', handleQueueUpdated);
      socketService.off('queue:completed', handleQueueUpdated);
      socketService.off('queue:recalculated', handleQueueUpdated);
      socketService.off('queue:paused', handleQueueUpdated);
      socketService.off('queue:resumed', handleQueueUpdated);
      socketService.off('appointment:doctor-unavailable', handleDoctorUnavailable);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  const fetchQueueStatus = useCallback(async () => {
    try {
      setQueueLoading(true);
      const res = await queueAPI.getMyStatus();
      if (res.data.success) setQueueStatus(res.data.data);
    } catch {
      // Silent — not an error if patient isn't in queue
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const fetchDashboardData = async () => {
    // Prevent duplicate simultaneous calls
    if (isFetching) return;
    
    try {
      setLoading(true);
      setIsFetching(true);
      
      // Fetch appointments - get all statuses to show both upcoming and history
      const appointmentsRes = await appointmentAPI.getAppointments({
        status: 'scheduled,confirmed,cancelled,completed,no-show,doctor-unavailable'
      });
      
      if (appointmentsRes.data.success) {
        const allAppts = appointmentsRes.data.data.appointments || [];
        setAppointments(allAppts);
        
        console.log('All appointments:', allAppts);
        console.log('Cancelled appointments:', allAppts.filter(apt => apt.status === 'cancelled'));
        
        // Update stats - count only active upcoming appointments (future date/time)
        const now = new Date();
        
        const activeUpcoming = allAppts.filter(apt => {
          // Combine date and time for accurate comparison
          const apptDate = new Date(apt.appointmentDate);
          const [hours, minutes] = apt.appointmentTime.split(':');
          apptDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          
          return apptDate > now && !['cancelled', 'completed', 'no-show', 'doctor-unavailable'].includes(apt.status);
        }).length;
        
        setStats(prev => ({
          ...prev,
          upcomingAppointments: activeUpcoming
        }));
      }

      // Fetch medical records
      const recordsRes = await medicalRecordsAPI.getRecords();
      
      if (recordsRes.data.success) {
        const records = recordsRes.data.data.records || [];
        setMedicalRecords(records);
        
        // Count recent records (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentCount = records.filter(r => 
          new Date(r.createdAt) > thirtyDaysAgo
        ).length;
        
        setStats(prev => ({
          ...prev,
          totalRecords: records.length,
          recentRecords: recentCount
        }));
      }
      
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setIsFetching(false);
    }
  };

  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Handle appointment cancellation — requires >2 hours in the future
  const canCancelAppointment = (appointment) => {
    if (!['scheduled', 'confirmed'].includes(appointment.status)) return false;
    const apptDate = new Date(appointment.appointmentDate);
    const [hours, minutes] = appointment.appointmentTime.split(':');
    apptDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
    return apptDate > twoHoursFromNow;
  };

  const openCancelModal = (appointment) => {
    setCancelModal({
      open: true,
      appointmentId: appointment._id,
      appointmentTitle: `Dr. ${appointment.doctor?.firstName} ${appointment.doctor?.lastName} on ${formatDate(appointment.appointmentDate)} at ${appointment.appointmentTime}`,
    });
  };

  const handleCancelAppointment = async () => {
    if (!cancelModal.appointmentId) return;
    try {
      setCancelling(true);
      await appointmentAPI.cancelAppointment(cancelModal.appointmentId, 'Patient requested cancellation');
      toast.success('Appointment cancelled successfully');
      setCancelModal({ open: false, appointmentId: null, appointmentTitle: '' });
      fetchDashboardData();
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      toast.error('Failed to cancel appointment');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  const unavailableAppointments = appointments.filter((appointment) => appointment.status === 'doctor-unavailable');

  const handleReschedule = (appointment) => {
    const doctorId = appointment.doctor?._id;
    const params = new URLSearchParams({ tab: 'book-appointment' });
    if (doctorId) params.set('doctorId', doctorId);
    if (appointment._id) params.set('rescheduleFrom', appointment._id);
    if (appointment.chiefComplaint) params.set('chiefComplaint', encodeURIComponent(appointment.chiefComplaint));
    if (appointment.appointmentType) params.set('appointmentType', appointment.appointmentType);
    navigate(`/dashboard?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50 p-4 sm:p-6 lg:p-8">
      {/* Cancellation Confirmation Modal */}
      {cancelModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate-fade-in">
            <div className="flex items-center space-x-4 mb-6">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Cancel Appointment?</h3>
                <p className="text-sm text-gray-500 mt-1">This action cannot be undone.</p>
              </div>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-6">
              <p className="text-sm text-red-800 font-medium">{cancelModal.appointmentTitle}</p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setCancelModal({ open: false, appointmentId: null, appointmentTitle: '' })}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                disabled={cancelling}
              >
                Keep Appointment
              </button>
              <button
                onClick={handleCancelAppointment}
                disabled={cancelling}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center space-x-2"
              >
                {cancelling ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : <XMarkIcon className="w-4 h-4" />}
                <span>{cancelling ? 'Cancelling...' : 'Yes, Cancel'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Welcome back, {user?.firstName}! 👋
              </h1>
              <p className="text-gray-600">
                Manage your appointments, health card, and medical records
              </p>
            </div>
            
          </div>
        </div>

        {unavailableAppointments.length > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Action Required</p>
                <p className="text-sm text-amber-800">
                  Dr. {unavailableAppointments[0]?.doctor?.firstName} {unavailableAppointments[0]?.doctor?.lastName}'s appointment on{' '}
                  {formatDate(unavailableAppointments[0]?.appointmentDate)} at {unavailableAppointments[0]?.appointmentTime} needs rescheduling.
                </p>
              </div>
            </div>
            <button
              onClick={() => handleReschedule(unavailableAppointments[0])}
              className="px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700"
            >
              Reschedule Now
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {tabs.map((tab) => {
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <IconComponent className="w-5 h-5" />
                    <span>{tab.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <>
            {/* Queue Status Card */}
            {(queueStatus?.inQueue || queueLoading) && (
              <div className="mb-8">
                {queueLoading ? (
                  <div className="h-24 bg-blue-50 rounded-2xl animate-pulse" />
                ) : (
                  <div className={`rounded-2xl p-6 border-2 shadow-lg ${
                    queueStatus.status === 'in_consultation' || queueStatus.status === 'in-consultation'
                      ? 'bg-gradient-to-r from-purple-50 to-purple-100 border-purple-300'
                      : queueStatus.status === 'called'
                      ? 'bg-gradient-to-r from-orange-50 to-orange-100 border-orange-300'
                      : queueStatus.status === 'ready'
                      ? 'bg-gradient-to-r from-orange-50 to-amber-100 border-amber-300'
                      : queueStatus.sessionStatus === 'paused'
                      ? 'bg-gradient-to-r from-yellow-50 to-yellow-100 border-yellow-300'
                      : 'bg-gradient-to-r from-blue-50 to-blue-100 border-blue-300'
                  }`}>
                    {/* Paused / delay banner */}
                    {queueStatus.sessionStatus === 'paused' && (
                      <div className="mb-3 bg-yellow-200 text-yellow-900 text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-2">
                        ⏸ Queue is temporarily paused.
                        {queueStatus.delayMessage && ` ${queueStatus.delayMessage}`}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-5">
                        {/* Token badge */}
                        <div className={`text-4xl font-black px-5 py-3 rounded-xl shadow-md ${
                          queueStatus.status === 'in_consultation' || queueStatus.status === 'in-consultation' ? 'bg-purple-600 text-white' :
                          queueStatus.status === 'called' ? 'bg-orange-500 text-white' :
                          queueStatus.status === 'ready' ? 'bg-amber-500 text-white' :
                          queueStatus.tokenType === 'E' ? 'bg-red-600 text-white' :
                          queueStatus.tokenType === 'W' ? 'bg-amber-500 text-white' :
                          'bg-blue-600 text-white'
                        }`}>
                          {queueStatus.queueNumber}
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Your Queue Token</p>
                          <p className={`text-xl font-bold ${
                            queueStatus.status === 'in_consultation' || queueStatus.status === 'in-consultation' ? 'text-purple-800' :
                            queueStatus.status === 'called' ? 'text-orange-800' :
                            queueStatus.status === 'ready' ? 'text-amber-800' :
                            'text-blue-800'
                          }`}>
                            {(queueStatus.status === 'in_consultation' || queueStatus.status === 'in-consultation') ? '🩺 In Consultation' :
                             queueStatus.status === 'called' ? '📢 Please proceed to the room!' :
                             queueStatus.status === 'ready' ? '✅ Please be ready — you are next!' :
                             queueStatus.status === 'temporarily_away' ? '⏳ Temporarily Away — Please return' :
                             queueStatus.zone === 'READY' ? '✅ Please be ready — you are next!' :
                             `Position ${queueStatus.position} in queue`}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            {queueStatus.room} · Dr. {queueStatus.doctor?.firstName} {queueStatus.doctor?.lastName}
                          </p>
                          {queueStatus.estimatedWaitMinutes > 0 &&
                           !['in_consultation', 'in-consultation', 'called', 'ready'].includes(queueStatus.status) && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              Estimated wait: approximately {queueStatus.estimatedWaitMinutes} minutes. This may change due to emergencies, doctor delays, and consultation duration.
                            </p>
                          )}
                          {queueStatus.appointmentReference && (
                            <p className="text-xs text-gray-400 mt-0.5 font-mono">Ref: {queueStatus.appointmentReference}</p>
                          )}
                          {/* Standard message for all queued patients */}
                          <p className="text-xs text-gray-400 mt-1 italic">
                            Token No: {queueStatus.queueNumber}. Please watch the display board. Appointment patients, emergency cases, doctor delays, and consultation duration may affect waiting time.
                          </p>
                        </div>
                      </div>
                      <button onClick={fetchQueueStatus} className="p-2 text-gray-400 hover:text-blue-600 transition-colors" title="Refresh">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold text-gray-900 mb-1">{stats.upcomingAppointments}</p>
                    <p className="text-gray-600 text-sm font-medium">Upcoming Appointments</p>
                    <p className="text-xs text-blue-600 mt-1">Next 30 days</p>
                  </div>
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <CalendarIcon className="w-8 h-8 text-white" />
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold text-gray-900 mb-1">{stats.totalRecords}</p>
                    <p className="text-gray-600 text-sm font-medium">Medical Records</p>
                    <p className="text-xs text-green-600 mt-1">{stats.recentRecords} recent</p>
                  </div>
                  <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <DocumentTextIcon className="w-8 h-8 text-white" />
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold text-gray-900 mb-1">Active</p>
                    <p className="text-gray-600 text-sm font-medium">Health Card Status</p>
                    <p className="text-xs text-teal-600 mt-1">Digital ID ready</p>
                  </div>
                  <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <QrCodeIcon className="w-8 h-8 text-white" />
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold text-gray-900 mb-1">
                      {user?.identityVerificationStatus === 'verified' ? 'Verified' : 
                       user?.identityVerificationStatus === 'pending' ? 'Pending' : 
                       user?.identityVerificationStatus === 'rejected' ? 'Rejected' : 'Unverified'}
                    </p>
                    <p className="text-gray-600 text-sm font-medium">Identity Status</p>
                    <p className={`text-xs mt-1 ${
                      user?.identityVerificationStatus === 'verified' ? 'text-green-600' :
                      user?.identityVerificationStatus === 'pending' ? 'text-blue-600' :
                      user?.identityVerificationStatus === 'rejected' ? 'text-red-600' :
                      'text-orange-600'
                    }`}>
                      {user?.identityVerificationStatus === 'verified' ? 'Identity verified ✓' : 
                       user?.identityVerificationStatus === 'pending' ? 'Under review' : 
                       user?.identityVerificationStatus === 'rejected' ? 'Verification rejected' : 'Verification needed'}
                    </p>
                  </div>
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${
                    user?.identityVerificationStatus === 'verified' ? 'bg-gradient-to-br from-green-500 to-green-600' :
                    user?.identityVerificationStatus === 'pending' ? 'bg-gradient-to-br from-blue-500 to-blue-600' :
                    user?.identityVerificationStatus === 'rejected' ? 'bg-gradient-to-br from-red-500 to-red-600' :
                    'bg-gradient-to-br from-orange-500 to-orange-600'
                  }`}>
                    <ShieldCheckIcon className="w-8 h-8 text-white" />
                  </div>
                </div>
              </div>
            </div>

            {/* Upcoming Appointments */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 mb-8">
              <div className="p-6 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                      <CalendarIcon className="w-6 h-6 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900">
                      Upcoming Appointments
                    </h2>
                  </div>
                  <button
                    onClick={() => setActiveTab('book-appointment')}
                    className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-200 transform hover:scale-105 shadow-lg font-medium"
                  >
                    <PlusIcon className="w-4 h-4" />
                    <span>Book New</span>
                  </button>
                </div>
              </div>
              <div className="p-6">
                {(() => {
                  const now = new Date();
                  const upcomingAppts = appointments.filter(apt => {
                    // Combine date and time for accurate comparison
                    const apptDate = new Date(apt.appointmentDate);
                    const [hours, minutes] = apt.appointmentTime.split(':');
                    apptDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                    
                    return apptDate > now && !['cancelled', 'completed', 'no-show'].includes(apt.status);
                  });
                  
                  return upcomingAppts.length > 0 ? (
                  <div className="space-y-4">
                    {upcomingAppts.slice(0, 2).map((appointment) => (
                      <div
                        key={appointment._id}
                        className="bg-gradient-to-r from-blue-50 to-gray-50 border border-blue-100 p-6 rounded-2xl hover:shadow-lg transition-all duration-300"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                              <UserIcon className="w-8 h-8 text-white" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-gray-900 mb-1">
                                {appointment.doctor?.firstName} {appointment.doctor?.lastName}
                              </h3>
                              <p className="text-sm text-blue-700 font-medium mb-1">
                                {appointment.doctor?.specialization} • {appointment.appointmentType}
                              </p>
                              <div className="flex items-center space-x-4">
                                <div className="flex items-center space-x-2">
                                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                                  <span className="text-sm text-gray-600">{formatDate(appointment.appointmentDate)}</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <ClockIcon className="w-4 h-4 text-gray-500" />
                                  <span className="text-sm text-gray-600">{appointment.appointmentTime}</span>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center flex-wrap gap-2">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  appointment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                                  appointment.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                                  appointment.status === 'in_queue' ? 'bg-teal-100 text-teal-800' :
                                  appointment.status === 'doctor-unavailable' ? 'bg-amber-100 text-amber-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {appointment.status === 'doctor-unavailable' ? 'doctor unavailable' :
                                   appointment.status === 'in_queue' ? 'in queue' : appointment.status}
                                </span>
                                {appointment.appointmentReference && (
                                  <span className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">
                                    {appointment.appointmentReference}
                                  </span>
                                )}
                                {/* Show check-in message for scheduled/confirmed appointments */}
                                {['scheduled', 'confirmed'].includes(appointment.status) && (
                                  <span className="text-xs text-blue-600 italic">
                                    Your live queue token will be issued after check-in at the hospital.
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col space-y-2">
                            <button 
                              onClick={() => navigate(`/appointments/${appointment._id}`)}
                              className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-md"
                            >
                              View Details
                            </button>
                            {canCancelAppointment(appointment) && (
                              <button
                                onClick={() => openCancelModal(appointment)}
                                className="px-6 py-2 bg-white text-red-600 border-2 border-red-200 rounded-xl hover:bg-red-50 transition-colors font-medium text-sm"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {upcomingAppts.length > 2 && (
                      <div className="text-center pt-4">
                        <button
                          onClick={() => setActiveTab('appointments')}
                          className="inline-flex items-center space-x-2 px-6 py-3 bg-white text-blue-600 border-2 border-blue-200 rounded-xl hover:bg-blue-50 transition-colors font-medium"
                        >
                          <ClockIcon className="w-5 h-5" />
                          <span>View All Appointments ({upcomingAppts.length})</span>
                          <ArrowRightIcon className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <CalendarIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No upcoming appointments</h3>
                    <p className="text-gray-500 mb-6">Schedule your next appointment to stay on top of your health</p>
                    <button
                      onClick={() => setActiveTab('book-appointment')}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                    >
                      <PlusIcon className="w-5 h-5" />
                      <span>Book Your Appointment</span>
                    </button>
                  </div>
                  );
                })()}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button
                onClick={() => setActiveTab('health-card')}
                className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 text-left"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center">
                    <QrCodeIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Digital Health Card</h3>
                    <p className="text-sm text-gray-600">View your QR code and medical info</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('documents')}
                className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 text-left"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center">
                    <DocumentTextIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Medical Records</h3>
                    <p className="text-sm text-gray-600">View and manage your medical history</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('profile')}
                className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 text-left"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center">
                    <UserCircleIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Update Profile</h3>
                    <p className="text-sm text-gray-600">Manage personal info & verification</p>
                  </div>
                </div>
              </button>
            </div>
          </>
        )}

        {/* Book Appointment Tab */}
        {activeTab === 'book-appointment' && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
            <AppointmentBooking />
          </div>
        )}

        {/* My Appointments Tab */}
        {activeTab === 'appointments' && (
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-blue-600">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <ClockIcon className="w-6 h-6 text-white" />
                  <h2 className="text-2xl font-bold text-white">
                    My Appointments
                  </h2>
                </div>
              </div>
            </div>
            
            <div className="p-6">
              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-600 mt-4">Loading appointments...</p>
                </div>
              ) : (
                <>
                  {/* Upcoming Appointments */}
                  <div className="mb-8">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
                      <CalendarIcon className="w-5 h-5 text-blue-600" />
                      <span>Upcoming Appointments</span>
                    </h3>
                    {(() => {
                      const now = new Date();
                      const upcomingAppts = appointments.filter(apt => {
                        // Combine date and time for accurate comparison
                        const apptDate = new Date(apt.appointmentDate);
                        const [hours, minutes] = apt.appointmentTime.split(':');
                        apptDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                        
                        return apptDate > now && !['cancelled', 'completed', 'no-show'].includes(apt.status);
                      });
                      
                      return upcomingAppts.length > 0 ? (
                      <div className="space-y-4">
                        {upcomingAppts.map((appointment) => (
                          <div
                            key={appointment._id}
                            className="bg-gradient-to-r from-blue-50 to-gray-50 border-2 border-blue-100 p-6 rounded-2xl hover:shadow-lg transition-all duration-300"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-4 flex-1">
                                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0">
                                  <UserIcon className="w-7 h-7 text-white" />
                                </div>
                                <div className="flex-1">
                                  <h4 className="text-lg font-bold text-gray-900 mb-1">
                                    Dr. {appointment.doctor?.firstName} {appointment.doctor?.lastName}
                                  </h4>
                                  <p className="text-sm text-blue-700 font-medium mb-2">
                                    {appointment.doctor?.specialization} • {appointment.appointmentType}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center space-x-1">
                                      <CalendarIcon className="w-4 h-4 text-gray-500" />
                                      <span className="text-sm text-gray-600 font-medium">{formatDate(appointment.appointmentDate)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <ClockIcon className="w-4 h-4 text-gray-500" />
                                      <span className="text-sm text-gray-600 font-medium">{appointment.appointmentTime}</span>
                                    </div>
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                      appointment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                                      appointment.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                                      appointment.status === 'doctor-unavailable' ? 'bg-amber-100 text-amber-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {appointment.status === 'doctor-unavailable' ? 'doctor unavailable' : appointment.status}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col space-y-2 ml-4 flex-shrink-0">
                                <button
                                  onClick={() => navigate(`/appointments/${appointment._id}`)}
                                  className="px-5 py-2.5 bg-white text-blue-600 border-2 border-blue-200 rounded-xl hover:bg-blue-50 transition-colors font-semibold shadow-sm"
                                >
                                  View
                                </button>
                                {canCancelAppointment(appointment) && (
                                  <button
                                    onClick={() => openCancelModal(appointment)}
                                    className="px-5 py-2 bg-white text-red-600 border-2 border-red-200 rounded-xl hover:bg-red-50 transition-colors font-semibold text-sm"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-gray-50 rounded-2xl">
                        <CalendarIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-600">No upcoming appointments</p>
                      </div>
                      );
                    })()}
                  </div>

                  {/* Past Appointments (History) */}
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center space-x-2">
                      <ClockIcon className="w-5 h-5 text-gray-600" />
                      <span>Appointment History</span>
                    </h3>
                    {appointments.filter(apt => 
                      new Date(apt.appointmentDate) < new Date() || 
                      ['cancelled', 'completed', 'no-show'].includes(apt.status)
                    ).length > 0 ? (
                      <div className="space-y-4">
                        {appointments.filter(apt => 
                          new Date(apt.appointmentDate) < new Date() || 
                          ['cancelled', 'completed', 'no-show'].includes(apt.status)
                        ).map((appointment) => (
                          <div
                            key={appointment._id}
                            className="bg-gray-50 border border-gray-200 p-6 rounded-2xl hover:shadow-md transition-all duration-300"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-4 flex-1">
                                <div className="w-14 h-14 bg-gradient-to-br from-gray-400 to-gray-500 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0">
                                  <UserIcon className="w-7 h-7 text-white" />
                                </div>
                                <div className="flex-1">
                                  <h4 className="text-lg font-bold text-gray-900 mb-1">
                                    Dr. {appointment.doctor?.firstName} {appointment.doctor?.lastName}
                                  </h4>
                                  <p className="text-sm text-gray-700 font-medium mb-2">
                                    {appointment.doctor?.specialization} • {appointment.appointmentType}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex items-center space-x-1">
                                      <CalendarIcon className="w-4 h-4 text-gray-500" />
                                      <span className="text-sm text-gray-600 font-medium">{formatDate(appointment.appointmentDate)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <ClockIcon className="w-4 h-4 text-gray-500" />
                                      <span className="text-sm text-gray-600 font-medium">{appointment.appointmentTime}</span>
                                    </div>
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                      appointment.status === 'completed' ? 'bg-green-100 text-green-800' :
                                      appointment.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                      appointment.status === 'no-show' ? 'bg-orange-100 text-orange-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {appointment.status}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => navigate(`/appointments/${appointment._id}`)}
                                className="px-5 py-2.5 bg-white text-gray-600 border-2 border-gray-200 rounded-xl hover:bg-gray-50 transition-colors font-semibold shadow-sm"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-gray-50 rounded-2xl">
                        <ClockIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-600">No past appointments</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Health Card Tab */}
        {activeTab === 'health-card' && <HealthCardDisplay />}

        {/* Medical Records Tab */}
        {activeTab === 'documents' && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
            <MedicalRecords />
          </div>
        )}

        {/* Profile & Verification Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <NICVerification />
          </div>
        )}
      </div>
    </div>
  );
};

export default PatientDashboardEnhanced;
