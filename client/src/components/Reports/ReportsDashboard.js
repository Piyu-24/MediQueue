/**
 * ReportsDashboard
 *
 * Displays appointment and doctor activity analytics derived exclusively from
 * real Appointment records stored in the database.
 *
 * Data sources:
 *   GET /api/reports/patient-visits?startDate&endDate
 *     Fields: Appointment.appointmentDate, .status, .patient, .department, .appointmentType
 *
 *   GET /api/reports/doctor-activity?startDate&endDate
 *     Fields: Appointment.doctor (populated), .status
 *
 * What was removed:
 *   - generateMockReportData() — every value was fabricated
 *   - Hardcoded "totalVisits: 1247", "growthRate: 12.5", "Dr. Sarah Johnson", etc.
 *   - Math.random() daily visit trend
 *   - Hardcoded department percentages
 *   - Fake PDF / Excel export (setTimeout with toast)
 *   - Fabricated "Insights & Recommendations" strings
 *   - "Peak Hours Analysis" report card — covered by the dedicated Peak Hours Analytics tab
 *   - "Staff Utilization" utilization% and efficiency — no staffing model in DB
 */
import React, { useState, useCallback } from 'react';
import {
  CalendarIcon,
  UsersIcon,
  ChartBarIcon,
  InformationCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { analyticsAPI } from '../../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316'];

const STATUS_LABELS = {
  completed:  'Completed',
  cancelled:  'Cancelled',
  noShow:     'No-show',
  booked:     'Booked / Pending',
  inQueue:    'In Queue',
};

const STATUS_COLORS = {
  completed: '#10B981',
  cancelled: '#EF4444',
  noShow:    '#F59E0B',
  booked:    '#3B82F6',
  inQueue:   '#8B5CF6',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const nDaysAgo = (n) =>
  new Date(Date.now() - n * 86400000).toISOString().split('T')[0];

const today = () => new Date().toISOString().split('T')[0];

// ── Sub-components ────────────────────────────────────────────────────────────

const KpiCard = ({ label, value, sub, color = '#3B82F6' }) => (
  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
    <p className="text-3xl font-bold" style={{ color }}>{value ?? '—'}</p>
    {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
  </div>
);

const InsufficientData = () => (
  <div className="flex flex-col items-center justify-center py-14 text-center">
    <InformationCircleIcon className="w-10 h-10 text-gray-300 mb-3" />
    <p className="font-semibold text-gray-500">Insufficient data available.</p>
    <p className="text-sm text-gray-400 mt-1 max-w-xs">
      No appointment records were found in the selected date range.
    </p>
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="flex items-start gap-3 text-red-600 bg-red-50 rounded-xl p-4">
    <ExclamationTriangleIcon className="w-6 h-6 shrink-0" />
    <div>
      <p className="font-semibold">Unable to load report</p>
      <p className="text-sm mt-1 text-red-500">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 text-sm px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
      >
        Retry
      </button>
    </div>
  </div>
);

// ── Report Panels ─────────────────────────────────────────────────────────────

const PatientVisitsPanel = ({ data, meta }) => {
  if (!data) return <InsufficientData />;

  const { summary, dailyTrend, byDepartment, byType } = data;

  // Build status pie data from real counts
  const statusPieData = Object.entries(STATUS_LABELS)
    .filter(([key]) => summary[key] > 0)
    .map(([key, name]) => ({ name, value: summary[key], color: STATUS_COLORS[key] }));

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Appointments" value={summary.totalAppointments.toLocaleString()} sub={`${meta.periodStart} → ${meta.periodEnd}`} color="#3B82F6" />
        <KpiCard label="Unique Patients" value={summary.uniquePatients.toLocaleString()} sub="distinct patient IDs" color="#10B981" />
        <KpiCard label="Completed" value={summary.completed.toLocaleString()} sub={`${summary.totalAppointments ? Math.round(summary.completed / summary.totalAppointments * 100) : 0}% completion rate`} color="#10B981" />
        <KpiCard label="Cancelled / No-show" value={(summary.cancelled + summary.noShow).toLocaleString()} sub={`${summary.totalAppointments ? Math.round((summary.cancelled + summary.noShow) / summary.totalAppointments * 100) : 0}% of total`} color="#EF4444" />
      </div>

      {/* Daily trend */}
      {dailyTrend.length > 1 ? (
        <div className="bg-gray-50 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-gray-700 mb-1">Daily Appointment Trend</h4>
          <p className="text-xs text-gray-400 mb-4">
            Total appointments per calendar day — source: <code className="bg-gray-200 px-1 rounded">Appointment.appointmentDate</code>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailyTrend.map(d => ({ ...d, label: fmtDate(d.date) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v} appointments`, 'Total']} />
              <Line type="monotone" dataKey="count" name="Appointments" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4">Insufficient daily trend data for chart.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Appointment status breakdown */}
        {statusPieData.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Appointment Status Breakdown</h4>
            <p className="text-xs text-gray-400 mb-4">
              Source: <code className="bg-gray-200 px-1 rounded">Appointment.status</code>
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusPieData} cx="50%" cy="50%" outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false} dataKey="value">
                  {statusPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color || PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v}`, n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* By department */}
        {byDepartment.length > 0 ? (
          <div className="bg-gray-50 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Appointments by Department</h4>
            <p className="text-xs text-gray-400 mb-4">
              Source: <code className="bg-gray-200 px-1 rounded">Appointment.department</code>
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byDepartment} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="department" tick={{ fontSize: 10 }} width={110} />
                <Tooltip formatter={(v) => [`${v} appointments`, 'Total']} />
                <Bar dataKey="count" fill="#3B82F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl p-5 flex items-center justify-center">
            <p className="text-sm text-gray-400">No department data — <code>Appointment.department</code> field not populated in range.</p>
          </div>
        )}
      </div>

      {/* By type */}
      {byType.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-gray-700 mb-1">Appointments by Type</h4>
          <p className="text-xs text-gray-400 mb-4">
            Source: <code className="bg-gray-200 px-1 rounded">Appointment.appointmentType</code>
          </p>
          <div className="flex flex-wrap gap-3">
            {byType.map((item, i) => (
              <div key={i} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-4 py-2 shadow-sm">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="text-sm text-gray-700 capitalize">{item.type}</span>
                <span className="text-sm font-bold text-gray-900">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-right">
        Based on {meta.totalRecords.toLocaleString()} appointment records · Generated {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
};

const DoctorActivityPanel = ({ data, meta }) => {
  if (!data || data.length === 0) return <InsufficientData />;

  return (
    <div className="space-y-6">
      {/* Bar chart */}
      <div className="bg-gray-50 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-gray-700 mb-1">Appointments per Doctor</h4>
        <p className="text-xs text-gray-400 mb-4">
          Total appointments assigned to each doctor in the period.
          Source: <code className="bg-gray-200 px-1 rounded">Appointment.doctor</code>
        </p>
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 48)}>
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
            <Tooltip
              formatter={(v, name) => [v, name]}
            />
            <Legend />
            <Bar dataKey="total"     name="Total"           fill="#3B82F6" radius={[0, 3, 3, 0]} stackId="a" />
            <Bar dataKey="completed" name="Completed"       fill="#10B981" radius={[0, 3, 3, 0]} stackId="b" />
            <Bar dataKey="cancelled" name="Cancelled"       fill="#EF4444" radius={[0, 3, 3, 0]} stackId="c" />
            <Bar dataKey="noShow"    name="No-show"         fill="#F59E0B" radius={[0, 3, 3, 0]} stackId="d" />
            <Bar dataKey="other"     name="Upcoming/Other"  fill="#8B5CF6" radius={[0, 3, 3, 0]} stackId="e" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Doctor</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Specialization</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Completed</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Cancelled</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">No-show</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Upcoming/Other</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Completion %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.map((doc, i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-semibold text-gray-800">{doc.name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{doc.specialization || '—'}</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">{doc.total}</td>
                <td className="px-4 py-3 text-right text-green-700">{doc.completed}</td>
                <td className="px-4 py-3 text-right text-red-600">{doc.cancelled}</td>
                <td className="px-4 py-3 text-right text-amber-600">{doc.noShow}</td>
                <td className="px-4 py-3 text-right text-violet-600">{doc.other ?? (doc.total - doc.completed - doc.cancelled - doc.noShow)}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-700">
                  {doc.total > 0 ? `${Math.round(doc.completed / doc.total * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 text-right">
        Based on {meta.totalRecords.toLocaleString()} appointment records · Generated {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const REPORT_TABS = [
  { id: 'patient-visits',   label: 'Patient Visits',    icon: UsersIcon },
  { id: 'doctor-activity',  label: 'Doctor Activity',   icon: UserGroupIcon },
];

const ReportsDashboard = () => {
  const [activeReport, setActiveReport] = useState('patient-visits');
  const [dateRange, setDateRange] = useState({
    startDate: nDaysAgo(30),
    endDate:   today(),
  });
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [data,      setData]      = useState(null);
  const [meta,      setMeta]      = useState(null);
  const [generated, setGenerated] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setMeta(null);
    try {
      let res;
      if (activeReport === 'patient-visits') {
        res = await analyticsAPI.getPatientVisits(dateRange.startDate, dateRange.endDate);
        const d = res.data.data;
        setData(d.insufficient ? null : { summary: d.summary, dailyTrend: d.dailyTrend, byDepartment: d.byDepartment, byType: d.byType });
        setMeta(d.meta);
      } else if (activeReport === 'doctor-activity') {
        res = await analyticsAPI.getDoctorActivity(dateRange.startDate, dateRange.endDate);
        const d = res.data.data;
        setData(d.insufficient ? null : d.doctors);
        setMeta(d.meta);
      }
      setGenerated(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [activeReport, dateRange]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Reports &amp; Analytics</h2>
        <p className="text-sm text-gray-500 mt-1">
          All metrics are computed from actual records in the database. No mock data.
        </p>
      </div>

      {/* Report selector + date range */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {REPORT_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveReport(tab.id); setData(null); setGenerated(false); setError(null); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeReport === tab.id
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Date range */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
            <input
              type="date"
              value={dateRange.startDate}
              max={dateRange.endDate}
              onChange={e => setDateRange(r => ({ ...r, startDate: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
            <input
              type="date"
              value={dateRange.endDate}
              min={dateRange.startDate}
              max={today()}
              onChange={e => setDateRange(r => ({ ...r, endDate: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm font-medium"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Generating…' : 'Generate Report'}
          </button>
        </div>

        {/* Data source note */}
        <div className="flex items-start gap-2 mt-4 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {activeReport === 'patient-visits'
              ? 'Queries Appointment records filtered by appointmentDate. Fields used: status, patient, department, appointmentType.'
              : 'Queries Appointment records with a doctor assigned. Fields used: doctor (populated), status.'}
          </span>
        </div>
      </div>

      {/* Report output */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {!generated && !loading && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <ChartBarIcon className="w-10 h-10 text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">Select a report type and click Generate Report.</p>
            <p className="text-sm text-gray-400 mt-1">All data is pulled live from the database.</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-14">
            <ArrowPathIcon className="w-6 h-6 text-blue-500 animate-spin mr-3" />
            <span className="text-gray-500">Querying database…</span>
          </div>
        )}

        {error && <ErrorState message={error} onRetry={generate} />}

        {generated && !loading && !error && (
          <>
            {/* Report header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">
                  {REPORT_TABS.find(t => t.id === activeReport)?.label}
                </h3>
                {meta && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {meta.periodStart} → {meta.periodEnd} · {meta.totalRecords?.toLocaleString()} records analysed
                  </p>
                )}
              </div>
            </div>

            {/* Panel */}
            {activeReport === 'patient-visits' && (
              <PatientVisitsPanel data={data} meta={meta} />
            )}
            {activeReport === 'doctor-activity' && (
              <DoctorActivityPanel data={data} meta={meta} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ReportsDashboard;
