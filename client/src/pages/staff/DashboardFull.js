import React, { useState, useEffect } from 'react';
import {
  UserIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import { appointmentAPI } from '../../services/api';
import toast from 'react-hot-toast';

const StaffDashboard = () => {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [todayAppointments, setTodayAppointments] = useState([]);
  // Filters the already-loaded today list only — no patient-directory access.
  const [filterQuery, setFilterQuery] = useState('');
  const [stats, setStats] = useState({
    pending: 0,
    checkedIn: 0,
    completed: 0
  });

  useEffect(() => {
    fetchStaffData();
  }, []);

  const fetchStaffData = async () => {
    try {
      setLoading(true);

      const today = new Date().toISOString().split('T')[0];
      const response = await appointmentAPI.getAppointments({ date: today });

      if (response.data.success) {
        const appointments = response.data.data.appointments || [];
        setTodayAppointments(appointments);

        const pending = appointments.filter(a => a.status === 'scheduled').length;
        const checkedIn = appointments.filter(a => a.status === 'confirmed').length;
        const completed = appointments.filter(a => a.status === 'completed').length;

        setStats({ pending, checkedIn, completed });
      }

    } catch (error) {
      console.error('Error fetching staff data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async (appointmentId) => {
    try {
      await appointmentAPI.checkIn(appointmentId, 'manual');
      toast.success('Patient checked in successfully');
      fetchStaffData(); // Refresh
    } catch (error) {
      console.error('Error checking in:', error);
      toast.error(error.response?.data?.message || 'Failed to check in patient');
    }
  };

  // Client-side filter over today's list — supports assisting/locating a patient
  // without querying the user directory or exposing any extra patient data.
  const q = filterQuery.trim().toLowerCase();
  const visibleAppointments = q
    ? todayAppointments.filter(a => {
        const name = `${a.patient?.firstName || ''} ${a.patient?.lastName || ''}`.toLowerCase();
        const card = (a.patient?.digitalHealthCardId || '').toLowerCase();
        return name.includes(q) || card.includes(q);
      })
    : todayAppointments;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome, {user?.firstName}
          </h1>
          <p className="text-gray-600 mt-2">
            Staff Dashboard • {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
                <p className="text-sm text-gray-600">Pending Check-in</p>
              </div>
              <ClockIcon className="w-10 h-10 text-yellow-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.checkedIn}</p>
                <p className="text-sm text-gray-600">Checked In</p>
              </div>
              <CheckCircleIcon className="w-10 h-10 text-green-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
                <p className="text-sm text-gray-600">Completed</p>
              </div>
              <CalendarIcon className="w-10 h-10 text-blue-500" />
            </div>
          </div>
        </div>

        {/* Today's Appointments */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-xl font-bold text-gray-900">Today's Appointments</h2>
            {/* Find a patient within today's list (local filter, no directory lookup) */}
            <div className="relative w-full sm:w-72">
              <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Find patient in today's list..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>
          </div>
          <div className="p-6">
            {visibleAppointments.length > 0 ? (
              <div className="space-y-4">
                {visibleAppointments.map((appointment) => (
                  <div
                    key={appointment._id}
                    className="border border-gray-200 rounded-lg p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <UserIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">
                            {appointment.patient?.firstName} {appointment.patient?.lastName}
                          </h3>
                          <p className="text-sm text-gray-600">
                            Dr. {appointment.doctor?.firstName} {appointment.doctor?.lastName}
                            {appointment.doctor?.department && (
                              <span className="text-gray-400"> • {appointment.doctor.department}</span>
                            )}
                          </p>
                          <p className="text-sm text-gray-500">
                            {appointment.appointmentTime} • {appointment.appointmentType}
                          </p>
                          <div className="mt-2">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              appointment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                              appointment.status === 'scheduled' ? 'bg-yellow-100 text-yellow-800' :
                              appointment.status === 'completed' ? 'bg-gray-100 text-gray-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {appointment.status}
                            </span>
                          </div>
                        </div>
                      </div>

                      {appointment.status === 'scheduled' && (
                        <button
                          onClick={() => handleCheckIn(appointment._id)}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                        >
                          <CheckCircleIcon className="w-4 h-4 inline mr-1" />
                          Check In
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <CalendarIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">
                  {q ? 'No matching patients in today\'s list' : 'No appointments for today'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StaffDashboard;
