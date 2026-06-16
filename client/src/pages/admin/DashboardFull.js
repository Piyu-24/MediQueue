import React, { useState, useEffect, useCallback } from 'react';
import {
  UsersIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  ChartBarIcon,
  UserPlusIcon,
  MagnifyingGlassIcon,
  DocumentChartBarIcon,
  HomeIcon,
  ClipboardDocumentListIcon,
  IdentificationIcon,
  BellIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import { userAPI, adminAPI, managerAPI, queueAPI, departmentAPI, timeBlockAPI } from '../../services/api';
import ReportsDashboard from '../../components/Reports/ReportsDashboard';
import PeakHoursChartDashboard from '../../components/Analytics/PeakHoursChartDashboard';
import PatientRecordViewer from '../../components/Manager/PatientRecordViewer';
import PatientIdentityVerification from '../../components/Manager/PatientIdentityVerification';
import toast from 'react-hot-toast';

const TABS = [
  { id: 'overview',              name: 'Overview',              icon: HomeIcon },
  { id: 'users',                 name: 'User Management',       icon: UsersIcon },
  { id: 'capacity',              name: 'Depts & Time Blocks',   icon: BuildingOffice2Icon },
  { id: 'analytics',             name: 'Peak Hours Analytics',  icon: ChartBarIcon },
  { id: 'reports',               name: 'Reports & Analytics',   icon: DocumentChartBarIcon },
  { id: 'patient-records',       name: 'Patient Records',       icon: ClipboardDocumentListIcon },
  { id: 'identity-verification', name: 'Identity Verification', icon: IdentificationIcon },
];

const ROLE_COLORS = {
  admin:        'bg-red-100 text-red-800',
  manager:      'bg-teal-100 text-teal-800',
  doctor:       'bg-blue-100 text-blue-800',
  staff:        'bg-green-100 text-green-800',
  receptionist: 'bg-purple-100 text-purple-800',
  patient:      'bg-gray-100 text-gray-800',
};

const AdminDashboard = () => {
  const { user } = useAuth();

  const [loading, setLoading]           = useState(true);
  const [activeTab, setActiveTab]       = useState('overview');
  const [sidebarOpen, setSidebarOpen]   = useState(true);

  // Overview stats
  const [stats, setStats] = useState({
    totalUsers: 0, patients: 0, doctors: 0, staff: 0,
    appointmentsToday: 0, pendingAppointments: 0, completedAppointments: 0, pendingReschedule: 0
  });
  const [recentAppointments, setRecentAppointments] = useState([]);
  const [queueStats, setQueueStats]     = useState(null);

  // User management
  const [users, setUsers]               = useState([]);
  const [searchQuery, setSearchQuery]   = useState('');
  const [selectedRole, setSelectedRole] = useState('all');
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [togglingUser, setTogglingUser] = useState(null);

  // ── data fetching ────────────────────────────────────────────────────────────

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      // Try the rich manager overview endpoint first (now accessible to admin)
      try {
        const res = await managerAPI.getDashboardOverview();
        if (res.data.success) {
          const d = res.data.data;
          setStats(prev => ({
            ...prev,
            patients:              d.totalUsers        || 0,
            doctors:               d.totalDoctors      || 0,
            appointmentsToday:     d.todayAppointments || 0,
            pendingAppointments:   d.pendingAppointments   || 0,
            completedAppointments: d.completedAppointments || 0,
          }));
          setRecentAppointments(d.recentAppointments?.slice(0, 5) || []);
        }
      } catch {
        // fallback handled below with user list counts
      }

      // Always fetch full user list for user-management tab
      const searchRes = await userAPI.searchUsers('');
      if (searchRes.data.success) {
        const all = searchRes.data.data.users || [];
        setUsers(all);
        setStats(prev => ({
          ...prev,
          totalUsers: all.length,
          patients:   all.filter(u => u.role === 'patient').length,
          doctors:    all.filter(u => u.role === 'doctor').length,
          staff:      all.filter(u => ['staff', 'receptionist'].includes(u.role)).length,
        }));
      }

      // Queue stats
      try {
        const qRes = await queueAPI.getStats();
        if (qRes.data.success) setQueueStats(qRes.data.data.stats);
      } catch { /* silent */ }

      // Pending reschedule count
      try {
        const reschedRes = await fetch('/api/appointments?status=doctor-unavailable', {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` }
        });
        const reschedData = await reschedRes.json();
        if (reschedData.success) {
          setStats(prev => ({
            ...prev,
            pendingReschedule: reschedData.data?.appointments?.length || 0
          }));
        }
      } catch { /* silent */ }
    } catch (error) {
      console.error('Error fetching admin dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboardData(); }, [fetchDashboardData]);

  // Client-side filtering for user management table
  useEffect(() => {
    let filtered = users;
    if (selectedRole !== 'all') filtered = filtered.filter(u => u.role === selectedRole);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(u =>
        u.firstName?.toLowerCase().includes(q) ||
        u.lastName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q)
      );
    }
    setFilteredUsers(filtered);
  }, [users, searchQuery, selectedRole]);

  // ── actions ──────────────────────────────────────────────────────────────────

  const handleToggleUserStatus = async (userId, currentStatus) => {
    try {
      setTogglingUser(userId);
      const res = await adminAPI.toggleUserStatus(userId);
      if (res.data.success) {
        toast.success(res.data.message);
        setUsers(prev =>
          prev.map(u => u._id === userId ? { ...u, isActive: !currentStatus } : u)
        );
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update user status');
    } finally {
      setTogglingUser(null);
    }
  };

  // ── helpers ───────────────────────────────────────────────────────────────────

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ── loading state ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white shadow-lg transition-all duration-300 flex flex-col min-h-screen sticky top-0 self-start`}>
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            {sidebarOpen && (
              <div>
                <h2 className="text-lg font-bold text-gray-900">Admin Panel</h2>
                <p className="text-xs text-gray-500 mt-1">{user?.firstName} {user?.lastName}</p>
              </div>
            )}
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-lg hover:bg-gray-100">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={sidebarOpen ? 'M11 19l-7-7 7-7m8 14l-7-7 7-7' : 'M13 5l7 7-7 7M5 5l7 7-7 7'} />
              </svg>
            </button>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${
                  active ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'
                }`}
              >
                <Icon className={`${sidebarOpen ? 'mr-3' : 'mx-auto'} h-5 w-5 flex-shrink-0`} />
                {sidebarOpen && <span className="text-sm font-medium">{tab.name}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className={`${sidebarOpen ? 'flex items-center space-x-3' : 'flex justify-center'}`}>
            <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <span className="text-red-600 font-semibold text-sm">
                {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
              </span>
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="bg-white shadow-sm sticky top-0 z-10 px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {TABS.find(t => t.id === activeTab)?.name ?? 'Overview'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button onClick={fetchDashboardData} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              Refresh
            </button>
            <button className="p-2 rounded-lg hover:bg-gray-100 relative">
              <BellIcon className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        <div className="p-8 flex-1">

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
                {[
                  { label: 'Total Users',        value: stats.totalUsers,          icon: UsersIcon,            color: 'text-blue-500' },
                  { label: 'Patients',           value: stats.patients,            icon: UsersIcon,            color: 'text-green-500' },
                  { label: 'Doctors',            value: stats.doctors,             icon: ShieldCheckIcon,      color: 'text-teal-500' },
                  { label: 'Staff & Reception',  value: stats.staff,               icon: Cog6ToothIcon,        color: 'text-yellow-500' },
                ].map(s => {
                  const Icon = s.icon;
                  return (
                    <div key={s.label} className="bg-white rounded-lg shadow p-6 flex items-center justify-between">
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                        <p className="text-sm text-gray-500">{s.label}</p>
                      </div>
                      <Icon className={`w-10 h-10 ${s.color}`} />
                    </div>
                  );
                })}
              </div>

              {/* Appointment & queue stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
                {[
                  { label: "Today's Appointments", value: stats.appointmentsToday,     color: 'border-blue-300 bg-blue-50 text-blue-800' },
                  { label: 'Pending',              value: stats.pendingAppointments,   color: 'border-yellow-300 bg-yellow-50 text-yellow-800' },
                  { label: 'Completed',            value: stats.completedAppointments, color: 'border-green-300 bg-green-50 text-green-800' },
                  { label: 'Pending Reschedule',   value: stats.pendingReschedule,     color: 'border-red-300 bg-red-50 text-red-800' },
                ].map(s => (
                  <div key={s.label} className={`border-2 ${s.color} rounded-xl p-4 text-center`}>
                    <p className="text-3xl font-black">{s.value}</p>
                    <p className="text-xs font-semibold mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Recent appointments */}
                <div className="bg-white rounded-lg shadow">
                  <div className="p-5 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">Recent Appointments</h2>
                  </div>
                  <div className="p-5">
                    {recentAppointments.length > 0 ? (
                      <div className="space-y-4">
                        {recentAppointments.map(appt => (
                          <div key={appt._id} className="flex justify-between items-start border-b border-gray-100 pb-3 last:border-0">
                            <div>
                              <p className="font-medium text-gray-900 text-sm">
                                {appt.patient?.firstName} {appt.patient?.lastName}
                              </p>
                              <p className="text-xs text-gray-500">
                                Dr. {appt.doctor?.firstName} {appt.doctor?.lastName}
                              </p>
                              <p className="text-xs text-gray-400">
                                {formatDate(appt.appointmentDate)} · {appt.appointmentTime}
                              </p>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                              appt.status === 'completed' ? 'bg-green-100 text-green-800' :
                              appt.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {appt.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-gray-400 py-6">No recent appointments</p>
                    )}
                  </div>
                </div>

                {/* System health + queue */}
                <div className="space-y-6">
                  <div className="bg-white rounded-lg shadow p-5">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">System Health</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Active Users</span>
                        <span className="font-semibold text-green-600">{users.filter(u => u.isActive).length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Verified Emails</span>
                        <span className="font-semibold">{users.filter(u => u.isEmailVerified).length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Inactive Accounts</span>
                        <span className="font-semibold text-red-500">{users.filter(u => !u.isActive).length}</span>
                      </div>
                    </div>
                  </div>

                  {queueStats && (
                    <div className="bg-white rounded-lg shadow p-5">
                      <h3 className="text-lg font-bold text-gray-900 mb-4">Today's OPD Queue</h3>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Waiting',        value: queueStats.waiting,        color: 'text-yellow-600' },
                          { label: 'In Consult',     value: queueStats.inConsultation, color: 'text-purple-600' },
                          { label: 'Completed',      value: queueStats.completed,      color: 'text-green-600' },
                        ].map(s => (
                          <div key={s.label} className="text-center">
                            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                            <p className="text-xs text-gray-500">{s.label}</p>
                          </div>
                        ))}
                      </div>
                      {queueStats.avgWaitMinutes > 0 && (
                        <p className="text-xs text-gray-500 mt-3 text-center">
                          Avg wait: <strong>{queueStats.avgWaitMinutes} min</strong>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── USER MANAGEMENT TAB ──────────────────────────────────────────── */}
          {activeTab === 'users' && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <h2 className="text-xl font-bold text-gray-900">User Management</h2>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search users..."
                      className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent w-56"
                    />
                  </div>
                  <select
                    value={selectedRole}
                    onChange={e => setSelectedRole(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="all">All Roles</option>
                    <option value="patient">Patients</option>
                    <option value="doctor">Doctors</option>
                    <option value="staff">Staff</option>
                    <option value="receptionist">Receptionists</option>
                    <option value="admin">Admins</option>
                  </select>
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedRole('all'); fetchDashboardData(); }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm flex items-center gap-1"
                  >
                    <UserPlusIcon className="w-4 h-4" />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="p-6">
                <p className="text-sm text-gray-500 mb-4">
                  Showing {filteredUsers.length} of {users.length} users
                </p>
                {filteredUsers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          {['User', 'Role', 'Email Verified', 'Status', 'Joined', 'Actions'].map(h => (
                            <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredUsers.map(u => (
                          <tr key={u._id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
                                  {u.firstName?.[0]}{u.lastName?.[0]}
                                </div>
                                <span className="text-sm font-medium text-gray-900">{u.firstName} {u.lastName}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-800'}`}>
                                {u.role}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${u.isEmailVerified ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                                {u.isEmailVerified ? 'Verified' : 'Unverified'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${u.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {u.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatDate(u.createdAt)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                              <button
                                onClick={() => handleToggleUserStatus(u._id, u.isActive)}
                                disabled={togglingUser === u._id}
                                className={`${
                                  u.isActive
                                    ? 'text-red-600 hover:text-red-900'
                                    : 'text-green-600 hover:text-green-900'
                                } disabled:opacity-50`}
                              >
                                {togglingUser === u._id ? 'Updating…' : u.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <UsersIcon className="w-14 h-14 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No users match the current filter</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── ANALYTICS TAB ────────────────────────────────────────────────── */}
          {activeTab === 'analytics' && (
            <PeakHoursChartDashboard embedded={true} />
          )}

          {/* ── REPORTS TAB ──────────────────────────────────────────────────── */}
          {activeTab === 'reports' && (
            <ReportsDashboard />
          )}

          {/* ── DEPARTMENTS & TIME BLOCKS TAB ───────────────────────────────── */}
          {activeTab === 'capacity' && (
            <CapacityTab />
          )}

          {/* ── PATIENT RECORDS TAB ──────────────────────────────────────────── */}
          {activeTab === 'patient-records' && (
            <PatientRecordViewer />
          )}

          {/* ── IDENTITY VERIFICATION TAB ────────────────────────────────────── */}
          {activeTab === 'identity-verification' && (
            <PatientIdentityVerification />
          )}

        </div>
      </main>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Departments & Time Blocks management tab
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BLOCK_TEMPLATES = [
  { startTime: '08:00', endTime: '09:00', sessionName: 'Block 1 (Morning Early)',  totalCapacity: 30, reportingOffsetMinutes: 15 },
  { startTime: '09:00', endTime: '10:00', sessionName: 'Block 2 (Morning)',         totalCapacity: 30, reportingOffsetMinutes: 15 },
  { startTime: '10:00', endTime: '11:00', sessionName: 'Block 3 (Mid-Morning)',     totalCapacity: 30, reportingOffsetMinutes: 15 },
  { startTime: '14:00', endTime: '15:00', sessionName: 'Block 4 (Afternoon)',       totalCapacity: 25, reportingOffsetMinutes: 15 },
  { startTime: '15:00', endTime: '16:00', sessionName: 'Block 5 (Late Afternoon)',  totalCapacity: 25, reportingOffsetMinutes: 15 },
];

const CapacityTab = () => {
  const [section, setSection] = React.useState('departments');

  // ── Department state ───────────────────────────────────────────────────────
  const [departments, setDepartments]   = React.useState([]);
  const [deptLoading, setDeptLoading]   = React.useState(false);
  const [editingDept, setEditingDept]   = React.useState(null); // { _id, name, code, ... } | 'new'
  const [deptForm, setDeptForm]         = React.useState({ name: '', code: '', description: '', averageConsultationMinutes: 10 });
  const [deptSaving, setDeptSaving]     = React.useState(false);

  // ── Time Block Generator state ─────────────────────────────────────────────
  const [selectedDeptId, setSelectedDeptId]   = React.useState('');
  const [startDate, setStartDate]             = React.useState('');
  const [endDate, setEndDate]                 = React.useState('');
  const [blockTemplates, setBlockTemplates]   = React.useState(DEFAULT_BLOCK_TEMPLATES.map(t => ({ ...t })));
  const [generating, setGenerating]           = React.useState(false);
  const [existingBlocks, setExistingBlocks]   = React.useState([]);
  const [blocksLoading, setBlocksLoading]     = React.useState(false);
  const [previewDate, setPreviewDate]         = React.useState('');

  // ── Load departments ───────────────────────────────────────────────────────
  const loadDepts = React.useCallback(async () => {
    setDeptLoading(true);
    try {
      const res = await departmentAPI.getDepartments();
      if (res.data.success) setDepartments(res.data.data);
    } catch { toast.error('Failed to load departments'); }
    finally { setDeptLoading(false); }
  }, []);

  React.useEffect(() => { loadDepts(); }, [loadDepts]);

  // ── Save department (create or update) ────────────────────────────────────
  const saveDept = async () => {
    if (!deptForm.name.trim() || !deptForm.code.trim()) {
      toast.error('Name and code are required');
      return;
    }
    setDeptSaving(true);
    try {
      const payload = {
        ...deptForm,
        code: deptForm.code.toUpperCase(),
        averageConsultationMinutes: Number(deptForm.averageConsultationMinutes)
      };
      let res;
      if (editingDept === 'new') {
        res = await departmentAPI.createDepartment(payload);
      } else {
        res = await departmentAPI.updateDepartment(editingDept._id, payload);
      }
      if (res.data.success) {
        toast.success(editingDept === 'new' ? 'Department created' : 'Department updated');
        setEditingDept(null);
        setDeptForm({ name: '', code: '', description: '', averageConsultationMinutes: 10 });
        loadDepts();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setDeptSaving(false); }
  };

  const openEdit = (dept) => {
    setEditingDept(dept);
    setDeptForm({
      name:                      dept.name,
      code:                      dept.code,
      description:               dept.description || '',
      averageConsultationMinutes: dept.averageConsultationMinutes || 10
    });
  };

  const toggleDeptStatus = async (dept) => {
    try {
      const res = await departmentAPI.updateDepartment(dept._id, {
        status: dept.status === 'active' ? 'inactive' : 'active'
      });
      if (res.data.success) {
        toast.success(`Department ${dept.status === 'active' ? 'deactivated' : 'activated'}`);
        loadDepts();
      }
    } catch { toast.error('Failed to update status'); }
  };

  // ── Load blocks for preview date ──────────────────────────────────────────
  const loadBlocks = React.useCallback(async () => {
    if (!selectedDeptId || !previewDate) return;
    setBlocksLoading(true);
    try {
      const res = await timeBlockAPI.getBlocks({
        departmentId: selectedDeptId,
        date:         previewDate,
        includeAll:   'true'
      });
      if (res.data.success) setExistingBlocks(res.data.data);
    } catch { setExistingBlocks([]); }
    finally { setBlocksLoading(false); }
  }, [selectedDeptId, previewDate]);

  React.useEffect(() => { loadBlocks(); }, [loadBlocks]);

  // ── Generate blocks ────────────────────────────────────────────────────────
  const generateBlocks = async () => {
    if (!selectedDeptId) { toast.error('Select a department'); return; }
    if (!startDate || !endDate) { toast.error('Select start and end dates'); return; }
    if (startDate > endDate) { toast.error('End date must be after start date'); return; }
    if (blockTemplates.length === 0) { toast.error('Add at least one time block template'); return; }

    const invalidTemplate = blockTemplates.find(t => !t.startTime || !t.endTime || !t.totalCapacity || t.totalCapacity < 1);
    if (invalidTemplate) { toast.error('All block templates must have start time, end time, and capacity ≥ 1'); return; }

    setGenerating(true);
    try {
      const res = await timeBlockAPI.generateBlocks({
        departmentId:   selectedDeptId,
        startDate,
        endDate,
        blockTemplates: blockTemplates.map(t => ({
          startTime:             t.startTime,
          endTime:               t.endTime,
          sessionName:           t.sessionName,
          totalCapacity:         Number(t.totalCapacity),
          reportingOffsetMinutes: Number(t.reportingOffsetMinutes || 15)
        }))
      });
      if (res.data.success) {
        toast.success(`${res.data.message}`, { duration: 6000 });
        if (previewDate) loadBlocks();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Generation failed');
    } finally { setGenerating(false); }
  };

  const addTemplate = () => setBlockTemplates(prev => [
    ...prev,
    { startTime: '', endTime: '', sessionName: '', totalCapacity: 20, reportingOffsetMinutes: 15 }
  ]);

  const removeTemplate = (i) => setBlockTemplates(prev => prev.filter((_, idx) => idx !== i));

  const updateTemplate = (i, field, value) =>
    setBlockTemplates(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));

  const deleteBlock = async (blockId) => {
    if (!window.confirm('Delete this time block? This cannot be undone.')) return;
    try {
      await timeBlockAPI.deleteBlock(blockId);
      toast.success('Block deleted');
      loadBlocks();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    }
  };

  // ── Capacity percentage summary ────────────────────────────────────────────
  const capacitySummary = (total) => {
    const appt   = Math.floor(total * 0.65);
    const walkIn = Math.floor(total * 0.25);
    const emerg  = Math.floor(total * 0.05);
    const op     = total - appt - walkIn - emerg;
    return { appt, walkIn, emerg, op };
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex gap-2 border-b border-gray-200 pb-0">
        {[
          { id: 'departments', label: 'Departments', icon: BuildingOffice2Icon },
          { id: 'blocks',      label: 'Time Block Generator', icon: CalendarDaysIcon }
        ].map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all -mb-px ${
              section === s.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <s.icon className="w-4 h-4" />
            {s.label}
          </button>
        ))}
      </div>

      {/* ── DEPARTMENTS SECTION ───────────────────────────────────────────── */}
      {section === 'departments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Hospital Departments</h3>
              <p className="text-sm text-gray-500">Manage departments used for General OPD booking</p>
            </div>
            <button
              onClick={() => { setEditingDept('new'); setDeptForm({ name: '', code: '', description: '', averageConsultationMinutes: 10 }); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold shadow-md">
              <PlusIcon className="w-4 h-4" /> New Department
            </button>
          </div>

          {/* Create / Edit form */}
          {editingDept && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5">
              <h4 className="font-bold text-blue-900 mb-4">
                {editingDept === 'new' ? 'Create New Department' : `Edit: ${editingDept.name}`}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Department Name *</label>
                  <input value={deptForm.name} onChange={e => setDeptForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. General OPD"
                    className="w-full px-3 py-2 border-2 border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Code * (uppercase, max 10 chars)</label>
                  <input value={deptForm.code} onChange={e => setDeptForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="e.g. OPD"
                    maxLength={10}
                    className="w-full px-3 py-2 border-2 border-blue-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                  <input value={deptForm.description} onChange={e => setDeptForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Brief description"
                    className="w-full px-3 py-2 border-2 border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Avg. Consultation (minutes)</label>
                  <input type="number" min={1} max={120}
                    value={deptForm.averageConsultationMinutes}
                    onChange={e => setDeptForm(f => ({ ...f, averageConsultationMinutes: e.target.value }))}
                    className="w-full px-3 py-2 border-2 border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditingDept(null)}
                  className="px-4 py-2 border-2 border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={saveDept} disabled={deptSaving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 shadow-md">
                  {deptSaving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckIcon className="w-4 h-4" />}
                  {editingDept === 'new' ? 'Create Department' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* Departments list */}
          {deptLoading ? (
            <div className="text-center py-8"><ArrowPathIcon className="w-7 h-7 text-blue-400 animate-spin mx-auto" /></div>
          ) : departments.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <BuildingOffice2Icon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No departments yet. Create the first one above.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Code', 'Name', 'Description', 'Avg. Min', 'Status', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {departments.map(dept => (
                    <tr key={dept._id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-blue-700">{dept.code}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{dept.name}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{dept.description || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{dept.averageConsultationMinutes} min</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                          dept.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}>{dept.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(dept)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                            <PencilSquareIcon className="w-4 h-4" />
                          </button>
                          <button onClick={() => toggleDeptStatus(dept)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              dept.status === 'active'
                                ? 'text-red-500 hover:bg-red-50'
                                : 'text-green-600 hover:bg-green-50'
                            }`}
                            title={dept.status === 'active' ? 'Deactivate' : 'Activate'}>
                            {dept.status === 'active' ? <XMarkIcon className="w-4 h-4" /> : <CheckIcon className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TIME BLOCK GENERATOR SECTION ─────────────────────────────────── */}
      {section === 'blocks' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* LEFT: Generator form */}
          <div className="space-y-5">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Time Block Generator</h3>
              <p className="text-sm text-gray-500">Bulk-generate booking sessions for a department across a date range</p>
            </div>

            {/* Department + date range */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Department *</label>
                <select value={selectedDeptId} onChange={e => setSelectedDeptId(e.target.value)}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500">
                  <option value="">Select department...</option>
                  {departments.filter(d => d.status === 'active').map(d => (
                    <option key={d._id} value={d._id}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Start Date *</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">End Date *</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    min={startDate || new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>

            {/* Block templates */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900 text-sm">Session Templates</h4>
                <button onClick={addTemplate}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-100">
                  <PlusIcon className="w-3 h-3" /> Add Block
                </button>
              </div>

              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {blockTemplates.map((t, i) => (
                  <div key={i} className="border-2 border-gray-100 rounded-xl p-3 bg-gray-50">
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">Start</label>
                        <input type="time" value={t.startTime}
                          onChange={e => updateTemplate(i, 'startTime', e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">End</label>
                        <input type="time" value={t.endTime}
                          onChange={e => updateTemplate(i, 'endTime', e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">Total Cap.</label>
                        <input type="number" min={1} max={200} value={t.totalCapacity}
                          onChange={e => updateTemplate(i, 'totalCapacity', Number(e.target.value))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-400" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-end">
                      <div className="col-span-2">
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">Session Name</label>
                        <input value={t.sessionName}
                          onChange={e => updateTemplate(i, 'sessionName', e.target.value)}
                          placeholder="e.g. Morning Session"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <div className="flex items-end justify-between gap-1">
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">Arrive offset</label>
                          <input type="number" min={0} max={60} value={t.reportingOffsetMinutes}
                            onChange={e => updateTemplate(i, 'reportingOffsetMinutes', Number(e.target.value))}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-400" />
                        </div>
                        <button onClick={() => removeTemplate(i)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors" title="Remove">
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {/* Capacity split preview */}
                    {t.totalCapacity > 0 && (
                      <div className="mt-2 flex gap-2 text-[10px] flex-wrap">
                        {(() => { const s = capacitySummary(t.totalCapacity); return (
                          <>
                            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Appt: {s.appt}</span>
                            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Walk-in: {s.walkIn}</span>
                            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Emerg: {s.emerg}</span>
                            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Buffer: {s.op}</span>
                          </>
                        ); })()}
                      </div>
                    )}
                  </div>
                ))}
                {blockTemplates.length === 0 && (
                  <div className="text-center py-6 text-gray-400 text-sm">No templates. Click "Add Block" to add one.</div>
                )}
              </div>
            </div>

            {/* Generate button */}
            <button onClick={generateBlocks} disabled={generating || !selectedDeptId || !startDate || !endDate}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md">
              {generating ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <CalendarDaysIcon className="w-5 h-5" />}
              {generating ? 'Generating...' : `Generate Blocks (${startDate && endDate ? Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1 : 0} days × ${blockTemplates.length} templates)`}
            </button>
          </div>

          {/* RIGHT: Preview + existing blocks */}
          <div className="space-y-5">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Block Preview</h3>
              <p className="text-sm text-gray-500">View existing blocks for a date</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Department</label>
                  <select value={selectedDeptId} onChange={e => setSelectedDeptId(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-400">
                    <option value="">Select...</option>
                    {departments.filter(d => d.status === 'active').map(d => (
                      <option key={d._id} value={d._id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                  <input type="date" value={previewDate} onChange={e => setPreviewDate(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              {blocksLoading ? (
                <div className="text-center py-6"><ArrowPathIcon className="w-6 h-6 text-blue-400 animate-spin mx-auto" /></div>
              ) : !selectedDeptId || !previewDate ? (
                <div className="text-center py-6 text-gray-400 text-sm">Select a department and date to preview blocks</div>
              ) : existingBlocks.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  No blocks for this date yet. Use the generator on the left.
                </div>
              ) : (
                <div className="space-y-2">
                  {existingBlocks.map(b => {
                    const pct = b.appointmentCapacity > 0
                      ? Math.round(b.bookedAppointmentCount / b.appointmentCapacity * 100)
                      : 0;
                    return (
                      <div key={b._id} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-semibold text-sm text-gray-900">{b.sessionName || `${b.startTime} – ${b.endTime}`}</p>
                            <p className="text-xs text-gray-500">{b.startTime} – {b.endTime}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              b.status === 'active'    ? 'bg-green-100 text-green-700' :
                              b.status === 'full'      ? 'bg-red-100 text-red-700' :
                              b.status === 'closed'    ? 'bg-gray-100 text-gray-600' :
                              'bg-red-50 text-red-500'
                            }`}>{b.status}</span>
                            <button onClick={() => deleteBlock(b._id)}
                              disabled={b.bookedAppointmentCount > 0}
                              className="p-1 text-red-400 hover:bg-red-50 rounded disabled:opacity-30 disabled:cursor-not-allowed" title="Delete">
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* Capacity bar */}
                        <div className="text-[10px] text-gray-500 mb-1">
                          Appt: {b.bookedAppointmentCount}/{b.appointmentCapacity} · Walk-in: {b.walkInCount}/{b.walkInCapacity} · Buffer: {b.emergencyBuffer}
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{pct}% booked</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Capacity policy info box */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <h4 className="font-bold text-amber-900 text-sm mb-3">📊 Default Capacity Allocation</h4>
              <p className="text-xs text-amber-800 mb-3">
                When blocks are generated, total capacity is split automatically using these percentages:
              </p>
              <div className="space-y-1.5 text-xs">
                {[
                  { label: 'Online Appointment Booking', pct: 65, color: 'bg-blue-500' },
                  { label: 'Walk-in Reserved',           pct: 25, color: 'bg-amber-500' },
                  { label: 'Emergency Buffer',           pct: 5,  color: 'bg-red-500' },
                  { label: 'Operational Buffer',         pct: 5,  color: 'bg-gray-400' },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${row.color} shrink-0`} />
                    <span className="text-amber-800 flex-1">{row.label}</span>
                    <span className="font-bold text-amber-900">{row.pct}%</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-amber-700 mt-3">
                Only the appointment booking capacity is exposed to online booking. Walk-in capacity is managed by reception. Emergency buffer is hidden from normal booking.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
