/**
 * PeakHoursChartDashboard
 *
 * Displays queue activity analytics derived exclusively from QueueEntry records
 * stored in the database. No mock data, no fabricated statistics.
 *
 * Data source: GET /api/reports/peak-hours?days=N
 * Fields used:  QueueEntry.checkInTime · QueueEntry.calledTime · QueueEntry.status
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ClockIcon,
  UsersIcon,
  ChartBarIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { analyticsAPI } from '../../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: 'Last 7 Days',  value: 7  },
  { label: 'Last 30 Days', value: 30 },
  { label: 'Last 90 Days', value: 90 },
];

const LEVEL_STYLES = {
  'Very High': 'text-red-700 bg-red-100 border-red-200',
  'High':      'text-orange-700 bg-orange-100 border-orange-200',
  'Medium':    'text-yellow-700 bg-yellow-100 border-yellow-200',
  'Low':       'text-green-700 bg-green-100 border-green-200',
};

const LEVEL_BAR_COLORS = {
  'Very High': '#EF4444',
  'High':      '#F97316',
  'Medium':    '#EAB308',
  'Low':       '#22C55E',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt12h = (hour) => {
  if (hour === 0)  return '12 AM';
  if (hour < 12)  return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
};

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });

// ── Sub-components ────────────────────────────────────────────────────────────

const KpiCard = ({ icon: Icon, label, value, sub, color = 'blue' }) => {
  const colorMap = {
    blue:   'bg-blue-50 text-blue-700',
    green:  'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    teal:   'bg-teal-50 text-teal-700',
  };
  return (
    <div className={`rounded-xl p-5 ${colorMap[color]}`}>
      <div className="flex items-start gap-3">
        <Icon className="w-7 h-7 shrink-0 mt-0.5 opacity-80" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide opacity-70 mb-0.5">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
};

const InsufficientData = ({ note }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <InformationCircleIcon className="w-12 h-12 text-gray-300 mb-4" />
    <h3 className="text-gray-500 font-semibold mb-2">Insufficient data available.</h3>
    <p className="text-sm text-gray-400 max-w-sm">{note || 'More queue activity is needed before analytics can be displayed.'}</p>
  </div>
);

// Custom bar shape that colours each bar by its demand level
const LevelBar = (props) => {
  const { x, y, width, height, demandLevel } = props;
  const fill = LEVEL_BAR_COLORS[demandLevel] || '#94A3B8';
  return <rect x={x} y={y} width={width} height={height} fill={fill} rx={3} />;
};

// ── Main Component ────────────────────────────────────────────────────────────

const PeakHoursChartDashboard = ({ embedded = false }) => {
  const [days, setDays]           = useState(30);
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await analyticsAPI.getPeakHours(days);
      setData(res.data.data);
      setFetchedAt(new Date());
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load analytics. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Active hours (hours that have at least 1 day of data) ─────────────────
  const activeHourlyData = (data?.hourlyActivity || [])
    .filter(h => h.avgCheckIns !== null);

  // ── Chart datasets ────────────────────────────────────────────────────────
  const volumeChartData = activeHourlyData.map(h => ({
    label:       fmt12h(h.hour),
    avgCheckIns: h.avgCheckIns,
    demandLevel: h.demandLevel,
  }));

  const waitChartData = activeHourlyData
    .filter(h => h.avgWaitMinutes !== null)
    .map(h => ({
      label:          fmt12h(h.hour),
      avgWaitMinutes: h.avgWaitMinutes,
    }));

  const dailyTrendData = (data?.dailyTrend || []).map(d => ({
    label:         fmtDate(d.date),
    totalCheckIns: d.totalCheckIns,
  }));

  // ── Render states ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow p-8 flex items-center justify-center min-h-64">
        <ArrowPathIcon className="w-6 h-6 text-blue-500 animate-spin mr-3" />
        <span className="text-gray-500">Loading analytics from database…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow p-8">
        <div className="flex items-start gap-3 text-red-600 bg-red-50 rounded-xl p-4">
          <ExclamationTriangleIcon className="w-6 h-6 shrink-0" />
          <div>
            <p className="font-semibold">Unable to load analytics</p>
            <p className="text-sm mt-1 text-red-500">{error}</p>
            <button
              onClick={fetchData}
              className="mt-3 text-sm px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { kpis, meta, insufficient } = data || {};

  return (
    <div className={`bg-white rounded-2xl shadow ${embedded ? 'p-5' : 'p-6'}`}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <ChartBarIcon className="w-7 h-7 text-blue-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">Peak Hours Analytics</h2>
            <p className="text-sm text-gray-500">
              Historical queue activity — actual check-in records only
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  days === opt.value
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={fetchData}
            title="Refresh data"
            className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Data quality note ────────────────────────────────────────────── */}
      {meta && (
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-2 mb-6">
          <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{meta.note}</span>
        </div>
      )}

      {/* ── Insufficient data state ──────────────────────────────────────── */}
      {insufficient && <InsufficientData note={meta?.note} />}

      {!insufficient && (
        <>
          {/* ── KPI row ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
            <div className="col-span-2 lg:col-span-3 xl:col-span-2">
              <KpiCard
                icon={UsersIcon}
                label={`Total check-ins (${meta?.periodDays}d)`}
                value={kpis.totalCheckInsInPeriod?.toLocaleString() ?? '—'}
                sub={`${meta?.periodStart} → ${meta?.periodEnd}`}
                color="blue"
              />
            </div>
            <div className="col-span-1 lg:col-span-1 xl:col-span-2">
              <KpiCard
                icon={ClockIcon}
                label="Busiest hour (avg)"
                value={kpis.busiestHour
                  ? `${fmt12h(kpis.busiestHour.hour)}`
                  : '—'}
                sub={kpis.busiestHour
                  ? `~${kpis.busiestHour.avgCheckIns} avg check-ins`
                  : 'No data'}
                color="orange"
              />
            </div>
            <div className="col-span-1 lg:col-span-1 xl:col-span-2">
              <KpiCard
                icon={ClockIcon}
                label="Avg wait time (period)"
                value={kpis.overallAvgWaitMinutes != null
                  ? `${kpis.overallAvgWaitMinutes} min`
                  : '—'}
                sub="calledTime − checkInTime"
                color="teal"
              />
            </div>
          </div>

          {/* ── Today row ───────────────────────────────────────────────── */}
          <div className="border-t border-gray-100 pt-5 mb-8">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <CalendarDaysIcon className="w-4 h-4 text-gray-400" />
              Today's Live Totals
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <p className="text-xs text-blue-600 mb-1">Check-ins today</p>
                <p className="text-2xl font-bold text-blue-800">{kpis.todayCheckIns ?? '—'}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-4 text-center">
                <p className="text-xs text-green-600 mb-1">Completed today</p>
                <p className="text-2xl font-bold text-green-800">{kpis.todayCompleted ?? '—'}</p>
              </div>
              <div className="bg-teal-50 rounded-xl p-4 text-center">
                <p className="text-xs text-teal-600 mb-1">Avg wait today</p>
                <p className="text-2xl font-bold text-teal-800">
                  {kpis.todayAvgWaitMinutes != null ? `${kpis.todayAvgWaitMinutes} min` : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* ── Charts ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">

            {/* Patient Volume by Hour */}
            <div className="bg-gray-50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">
                Avg Patient Volume by Hour
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                Average check-ins per hour across the selected period.
                Colour = demand level relative to daily average.
              </p>
              {volumeChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={volumeChartData} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v, _) => [`${v} avg check-ins`, 'Avg patients']}
                      labelFormatter={(l) => `Hour: ${l}`}
                    />
                    <Bar dataKey="avgCheckIns" name="Avg check-ins" shape={<LevelBar />} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                  Insufficient data available.
                </div>
              )}
            </div>

            {/* Average Wait Time by Hour */}
            <div className="bg-gray-50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">
                Avg Wait Time by Hour
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                Average minutes between check-in and being called, grouped by hour.
                Only hours with recorded call-times are shown.
              </p>
              {waitChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={waitChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis unit=" min" tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => [`${v} min`, 'Avg wait']} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="avgWaitMinutes"
                      name="Avg wait (min)"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dot={{ fill: '#3B82F6', r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                  Insufficient data available.
                </div>
              )}
            </div>
          </div>

          {/* Daily Check-in Trend */}
          {dailyTrendData.length > 1 && (
            <div className="bg-gray-50 rounded-xl p-5 mb-8">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">
                Daily Check-in Trend
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                Total queue check-ins per calendar day over the selected period.
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={dailyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} check-ins`, 'Total']} />
                  <Line
                    type="monotone"
                    dataKey="totalCheckIns"
                    name="Daily check-ins"
                    stroke="#10B981"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Hourly breakdown table ───────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Hourly Activity Breakdown
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              Demand level is classified by comparing each hour's average to the
              global hourly average: Low (&lt;50%), Medium (50–100%),
              High (100–150%), Very High (&gt;150%).
            </p>

            {activeHourlyData.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hour</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg Check-ins</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg Wait</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Demand Level</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Days with Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {activeHourlyData.map(h => (
                      <tr key={h.hour} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono font-semibold text-gray-800">
                          {h.label}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {h.avgCheckIns ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {h.avgWaitMinutes != null ? `${h.avgWaitMinutes} min` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {h.demandLevel ? (
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${LEVEL_STYLES[h.demandLevel] || 'text-gray-600 bg-gray-100'}`}>
                              {h.demandLevel}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {h.daysWithData}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
                Insufficient data available.
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      {fetchedAt && (
        <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center">
          Data queried from database at {fetchedAt.toLocaleTimeString()}.
          {meta && ` Analysed ${meta.totalQueueRecordsAnalyzed?.toLocaleString()} queue records.`}
        </div>
      )}
    </div>
  );
};

export default PeakHoursChartDashboard;
