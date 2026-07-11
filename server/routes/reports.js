const express = require('express');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const QueueEntry = require('../models/QueueEntry');
const Report = require('../models/Report');

const router = express.Router();

// @desc    Get dashboard statistics
// @route   GET /api/reports/dashboard
// @access  Private (Manager)
router.get('/dashboard', auth, authorize('admin'), async (req, res) => {
  try {
    // Get total counts
    const totalPatients = await User.countDocuments({ role: 'patient', isActive: true });
    const totalDoctors = await User.countDocuments({ role: 'doctor', isActive: true });
    const totalStaff = await User.countDocuments({ role: 'staff', isActive: true });
    
    // Get today's appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const appointmentsToday = await Appointment.countDocuments({
      appointmentDate: { $gte: today, $lt: tomorrow }
    });
    
    res.json({
      success: true,
      data: {
        totalPatients,
        totalDoctors,
        totalStaff,
        appointmentsToday
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get appointment reports
// @route   GET /api/reports/appointments
// @access  Private (Manager/Admin)
router.get('/appointments', auth, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate, doctorId, department } = req.query;
    
    // Build query
    let query = {};
    if (startDate && endDate) {
      query.appointmentDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    if (doctorId) query.doctor = doctorId;
    
    const appointments = await Appointment.find(query)
      .populate('patient', 'firstName lastName email')
      .populate('doctor', 'firstName lastName specialization')
      .sort({ appointmentDate: -1 });
    
    // Generate summary statistics
    const summary = {
      totalAppointments: appointments.length,
      completedAppointments: appointments.filter(a => a.status === 'completed').length,
      cancelledAppointments: appointments.filter(a => a.status === 'cancelled').length,
      pendingAppointments: appointments.filter(a => a.status === 'scheduled').length
    };
    
    res.json({
      success: true,
      data: {
        appointments,
        summary
      }
    });
  } catch (error) {
    console.error('Get appointment reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Patient Visits Report — real aggregation from Appointment records
// @route   GET /api/reports/patient-visits
// @access  Private (Admin)
//
// Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
//
// Returns:
//   summary — totalAppointments, byStatus counts, uniquePatients
//   dailyTrend — total appointments per calendar day in range
//   byDepartment — count per department string
//   byType — count per appointmentType
//   insufficient — true when fewer than 1 record exists
router.get('/patient-visits', auth, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end   = endDate   ? new Date(endDate)   : new Date();
    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);

    // ── 1. All appointments in range ────────────────────────────────────────
    const appointments = await Appointment.find({
      appointmentDate: { $gte: start, $lte: end }
    }).lean();

    const total = appointments.length;
    const insufficient = total < 1;

    if (insufficient) {
      return res.json({
        success: true,
        data: {
          insufficient: true,
          summary: null, dailyTrend: [], byDepartment: [], byType: [],
          meta: { periodStart: start.toISOString().split('T')[0], periodEnd: end.toISOString().split('T')[0], totalRecords: 0 }
        }
      });
    }

    // ── 2. Status breakdown ─────────────────────────────────────────────────
    const statusCounts = appointments.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    }, {});

    // ── 3. Unique patients ──────────────────────────────────────────────────
    const uniquePatients = new Set(appointments.map(a => String(a.patient))).size;

    // ── 4. Daily trend ──────────────────────────────────────────────────────
    const dailyMap = {};
    for (const a of appointments) {
      const day = new Date(a.appointmentDate).toISOString().split('T')[0];
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }
    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // ── 5. Department breakdown (uses department string on Appointment) ──────
    const deptMap = {};
    for (const a of appointments) {
      if (a.department) {
        deptMap[a.department] = (deptMap[a.department] || 0) + 1;
      }
    }
    const byDepartment = Object.entries(deptMap)
      .sort(([, a], [, b]) => b - a)
      .map(([department, count]) => ({ department, count }));

    // ── 6. Appointment type breakdown ───────────────────────────────────────
    const typeMap = {};
    for (const a of appointments) {
      if (a.appointmentType) {
        typeMap[a.appointmentType] = (typeMap[a.appointmentType] || 0) + 1;
      }
    }
    const byType = Object.entries(typeMap)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => ({ type, count }));

    return res.json({
      success: true,
      data: {
        insufficient: false,
        summary: {
          totalAppointments: total,
          uniquePatients,
          completed:  statusCounts['completed']  || 0,
          cancelled:  statusCounts['cancelled']  || 0,
          noShow:     statusCounts['no-show']    || 0,
          booked:     statusCounts['booked']     || 0,
          inQueue:    statusCounts['in_queue']   || 0,
        },
        dailyTrend,
        byDepartment,
        byType,
        meta: {
          periodStart:   start.toISOString().split('T')[0],
          periodEnd:     end.toISOString().split('T')[0],
          totalRecords:  total,
          generatedAt:   new Date()
        }
      }
    });
  } catch (error) {
    console.error('Patient visits report error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @desc    Doctor Activity Report — real aggregation from Appointment records
// @route   GET /api/reports/doctor-activity
// @access  Private (Admin)
//
// Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
//
// Returns:
//   doctors — per-doctor: name, total, completed, cancelled, noShow
//   insufficient — true when no appointments with a doctor exist in range
router.get('/doctor-activity', auth, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end   = endDate   ? new Date(endDate)   : new Date();
    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);

    // Only include appointments that have a doctor assigned
    const appointments = await Appointment.find({
      appointmentDate: { $gte: start, $lte: end },
      doctor: { $ne: null }
    })
      .populate('doctor', 'firstName lastName specialization')
      .lean();

    const insufficient = appointments.length < 1;

    if (insufficient) {
      return res.json({
        success: true,
        data: {
          insufficient: true,
          doctors: [],
          meta: { periodStart: start.toISOString().split('T')[0], periodEnd: end.toISOString().split('T')[0], totalRecords: 0 }
        }
      });
    }

    // Aggregate per doctor
    const doctorMap = {};
    for (const a of appointments) {
      if (!a.doctor) continue;
      const id   = String(a.doctor._id);
      const name = `${a.doctor.firstName} ${a.doctor.lastName}`;
      if (!doctorMap[id]) {
        doctorMap[id] = { name, specialization: a.doctor.specialization || '', total: 0, completed: 0, cancelled: 0, noShow: 0 };
      }
      doctorMap[id].total++;
      if (a.status === 'completed')  doctorMap[id].completed++;
      if (a.status === 'cancelled')  doctorMap[id].cancelled++;
      if (a.status === 'no-show')    doctorMap[id].noShow++;
    }

    const doctors = Object.values(doctorMap).sort((a, b) => b.total - a.total);

    return res.json({
      success: true,
      data: {
        insufficient: false,
        doctors,
        meta: {
          periodStart:  start.toISOString().split('T')[0],
          periodEnd:    end.toISOString().split('T')[0],
          totalRecords: appointments.length,
          generatedAt:  new Date()
        }
      }
    });
  } catch (error) {
    console.error('Doctor activity report error:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Revenue reports removed

// @desc    Get user reports
// @route   GET /api/reports/users
// @access  Private (Admin)
router.get('/users', auth, authorize('admin'), async (req, res) => {
  try {
    const { role, startDate, endDate } = req.query;
    
    let query = { isActive: true };
    if (role) query.role = role;
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const users = await User.find(query)
      .select('-password -refreshTokens')
      .sort({ createdAt: -1 });
    
    // Generate summary by role
    const usersByRole = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});
    
    res.json({
      success: true,
      data: {
        users,
        summary: {
          totalUsers: users.length,
          usersByRole
        }
      }
    });
  } catch (error) {
    console.error('Get user reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Export report
// @route   GET /api/reports/export/:type
// @access  Private (Manager/Admin)
router.get('/export/:type', auth, authorize('admin'), async (req, res) => {
  try {
    const { type } = req.params;
    const { format = 'json' } = req.query;
    
    // Mock export functionality
    const exportData = {
      type,
      generatedAt: new Date(),
      format,
      message: `${type} report exported as ${format.toUpperCase()}`
    };
    
    if (format === 'json') {
      res.json({
        success: true,
        data: exportData
      });
    } else {
      // For other formats, return a download response
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.${format}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(JSON.stringify(exportData, null, 2));
    }
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Generate report preview
// @route   GET /api/reports/generate/:reportType
// @access  Private (Manager)
router.get('/generate/:reportType', auth, authorize('admin'), async (req, res) => {
  try {
    const { reportType } = req.params;
    const { startDate, endDate, department, staffRole } = req.query;

    const filters = {
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    let data;
    switch (reportType) {
      case 'patient-visit':
        // Get patient visit data
        data = await Appointment.find({
          appointmentDate: filters.createdAt
        })
          .populate('patient', 'firstName lastName email')
          .populate('doctor', 'firstName lastName')
          .select('appointmentDate status reasonForVisit')
          .sort({ appointmentDate: -1 });
        break;

      case 'staff-utilization':
        // Get staff utilization data
        const staffFilters = { role: staffRole || { $in: ['doctor', 'staff'] }, isActive: true };
        const staff = await User.find(staffFilters).select('firstName lastName role');
        
        const staffData = await Promise.all(staff.map(async (member) => {
          const appointments = await Appointment.countDocuments({
            doctor: member._id,
            appointmentDate: filters.createdAt
          });
          return {
            staff: `${member.firstName} ${member.lastName}`,
            role: member.role,
            appointments
          };
        }));
        data = staffData;
        break;

      case 'financial-summary':
        data = {
          message: 'Financial reporting is disabled',
          appointments: []
        };
        break;

      case 'comprehensive':
        // Get all data for comprehensive report
        const patientVisits = await Appointment.find({
          appointmentDate: filters.createdAt
        })
          .populate('patient', 'firstName lastName email')
          .populate('doctor', 'firstName lastName')
          .select('appointmentDate status reasonForVisit')
          .sort({ appointmentDate: -1 });

        const allStaff = await User.find({ role: { $in: ['doctor', 'staff'] }, isActive: true })
          .select('firstName lastName role');
        
        const staffUtilization = await Promise.all(allStaff.map(async (member) => {
          const appointments = await Appointment.countDocuments({
            doctor: member._id,
            appointmentDate: filters.createdAt
          });
          return {
            staff: `${member.firstName} ${member.lastName}`,
            role: member.role,
            appointments
          };
        }));

        data = {
          patientVisits,
          staffUtilization,
          message: 'Comprehensive report preview'
        };
        break;

      // Legacy support for existing report types
      case 'weekly-summary':
        // Get weekly summary
        const weeklyAppointments = await Appointment.countDocuments({
          appointmentDate: filters.createdAt
        });
        
        data = {
          appointments: weeklyAppointments,
          message: 'Weekly appointment summary'
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid report type. Available types: patient-visit, staff-utilization, comprehensive'
        });
    }

    res.json({
      success: true,
      data: {
        reportType,
        dateRange: { startDate, endDate },
        totalRecords: Array.isArray(data) ? data.length : 1,
        preview: data
      }
    });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Download report as PDF
// @route   GET /api/reports/download/:reportType
// @access  Private (Manager)
router.get('/download/:reportType', auth, authorize('admin'), async (req, res) => {
  try {
    const { reportType } = req.params;
    const { startDate, endDate } = req.query;

    // For now, return a simple text response
    // In production, you would use a PDF library like pdfkit or puppeteer
    const reportContent = `MediQueue Healthcare Report
Report Type: ${reportType}
Date Range: ${startDate} to ${endDate}
Generated: ${new Date().toLocaleString()}

This is a placeholder for PDF generation.
Implement with pdfkit or similar library.`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportType}-report.pdf"`);
    res.send(Buffer.from(reportContent));
  } catch (error) {
    console.error('Download report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Peak Hours Analytics — real historical aggregation from QueueEntry
// @route   GET /api/reports/peak-hours
// @access  Private (Admin)
//
// Query params:
//   days  (number, default 30) — how many past days to include in the window
//
// Returns:
//   kpis            — total check-ins, busiest hour, avg wait time for the window
//   hourlyActivity  — one row per hour (0-23) with avg patients + avg wait
//   dailyTrend      — total check-ins per day for the last N days
//   today           — live figures for today only (check-ins so far, current hour)
//   meta            — period, record count, data quality notes
router.get('/peak-hours', auth, authorize('admin'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

    // ── Date window ───────────────────────────────────────────────────────────
    const now   = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // ── 1. Hourly activity aggregation (last N days) ───────────────────────────
    // Groups every QueueEntry by the hour extracted from checkInTime.
    // Computes the average number of check-ins per hour and the average
    // wait time (calledTime - checkInTime) for entries that were called.
    const hourlyRaw = await QueueEntry.aggregate([
      {
        $match: {
          checkInTime: { $gte: start, $lte: now },
          // Only count entries that actually entered the queue
          status: { $nin: ['cancelled'] }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$checkInTime' } },
            hour: { $hour: '$checkInTime' }
          },
          checkInsThisHour: { $sum: 1 },
          // Only average wait time for entries that were actually called
          waitTimes: {
            $push: {
              $cond: [
                { $and: [{ $ifNull: ['$calledTime', false] }, { $ifNull: ['$checkInTime', false] }] },
                { $divide: [{ $subtract: ['$calledTime', '$checkInTime'] }, 60000] },
                null
              ]
            }
          }
        }
      },
      // Roll up: for each hour-of-day, average across all matching days
      {
        $group: {
          _id: '$_id.hour',
          avgCheckIns: { $avg: '$checkInsThisHour' },
          daysPresent: { $sum: 1 },
          allWaitTimes: { $push: '$waitTimes' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── 2. Daily trend (total check-ins per calendar day) ─────────────────────
    const dailyRaw = await QueueEntry.aggregate([
      {
        $match: {
          checkInTime: { $gte: start, $lte: now },
          status: { $nin: ['cancelled'] }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$checkInTime' } },
          totalCheckIns: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── 3. Today's live totals ────────────────────────────────────────────────
    const todayTotal = await QueueEntry.countDocuments({
      checkInTime: { $gte: todayStart, $lte: todayEnd },
      status: { $nin: ['cancelled'] }
    });

    const todayCompleted = await QueueEntry.countDocuments({
      checkInTime: { $gte: todayStart, $lte: todayEnd },
      status: 'completed'
    });

    // Avg wait time for today's called patients
    const todayWaitRaw = await QueueEntry.aggregate([
      {
        $match: {
          checkInTime: { $gte: todayStart, $lte: todayEnd },
          calledTime: { $exists: true },
          status: { $nin: ['cancelled'] }
        }
      },
      {
        $group: {
          _id: null,
          avgWait: {
            $avg: { $divide: [{ $subtract: ['$calledTime', '$checkInTime'] }, 60000] }
          }
        }
      }
    ]);

    const totalRecords = hourlyRaw.reduce((s, h) => s + h.daysPresent, 0);

    // ── 4. Shape hourly data ──────────────────────────────────────────────────
    // Build a complete 0-23 array; hours with no data get null.
    const globalAvgCheckIns = hourlyRaw.length > 0
      ? hourlyRaw.reduce((s, h) => s + h.avgCheckIns, 0) / hourlyRaw.length
      : 0;

    // Classify a bucket relative to the global hourly average
    const classifyLevel = (avg, globalAvg) => {
      if (!globalAvg) return 'Low';
      const ratio = avg / globalAvg;
      if (ratio > 1.5)  return 'Very High';
      if (ratio > 1.0)  return 'High';
      if (ratio > 0.5)  return 'Medium';
      return 'Low';
    };

    // Flatten nested wait-time arrays and compute per-hour average
    const flatAvgWait = (nestedArrays) => {
      const valid = nestedArrays.flat().filter(v => v !== null && v >= 0);
      return valid.length > 0 ? Math.round(valid.reduce((s, v) => s + v, 0) / valid.length) : null;
    };

    const hourlyActivity = Array.from({ length: 24 }, (_, h) => {
      const row = hourlyRaw.find(r => r._id === h);
      if (!row) return { hour: h, label: `${String(h).padStart(2,'0')}:00`, avgCheckIns: null, avgWaitMinutes: null, demandLevel: null, daysWithData: 0 };
      const avg = Math.round(row.avgCheckIns * 10) / 10;
      return {
        hour:           h,
        label:          `${String(h).padStart(2,'0')}:00`,
        avgCheckIns:    avg,
        avgWaitMinutes: flatAvgWait(row.allWaitTimes),
        demandLevel:    classifyLevel(avg, globalAvgCheckIns),
        daysWithData:   row.daysPresent
      };
    });

    // ── 5. KPIs ───────────────────────────────────────────────────────────────
    const activeHours  = hourlyActivity.filter(h => h.avgCheckIns !== null);
    const busiestHour  = activeHours.length > 0
      ? activeHours.reduce((max, h) => h.avgCheckIns > max.avgCheckIns ? h : max)
      : null;

    const globalAvgWait = activeHours.length > 0
      ? activeHours.filter(h => h.avgWaitMinutes !== null)
      : [];

    const overallAvgWait = globalAvgWait.length > 0
      ? Math.round(globalAvgWait.reduce((s, h) => s + h.avgWaitMinutes, 0) / globalAvgWait.length)
      : null;

    const totalCheckInsInPeriod = dailyRaw.reduce((s, d) => s + d.totalCheckIns, 0);

    // ── 6. Daily trend shape ──────────────────────────────────────────────────
    const dailyTrend = dailyRaw.map(d => ({
      date:          d._id,
      totalCheckIns: d.totalCheckIns
    }));

    // ── 7. Respond ────────────────────────────────────────────────────────────
    const insufficient = totalRecords < 10; // < 10 queue records is not enough to be meaningful

    return res.json({
      success: true,
      data: {
        insufficient,
        kpis: insufficient ? null : {
          totalCheckInsInPeriod,
          busiestHour:      busiestHour ? { hour: busiestHour.hour, label: busiestHour.label, avgCheckIns: busiestHour.avgCheckIns } : null,
          overallAvgWaitMinutes: overallAvgWait,
          todayCheckIns:    todayTotal,
          todayCompleted,
          todayAvgWaitMinutes: todayWaitRaw[0]?.avgWait != null ? Math.round(todayWaitRaw[0].avgWait) : null
        },
        hourlyActivity:   insufficient ? [] : hourlyActivity,
        dailyTrend:       insufficient ? [] : dailyTrend,
        meta: {
          periodDays:      days,
          periodStart:     start.toISOString().split('T')[0],
          periodEnd:       now.toISOString().split('T')[0],
          totalQueueRecordsAnalyzed: totalRecords,
          generatedAt:     new Date(),
          note: insufficient
            ? 'Fewer than 10 queue records exist in the selected period. Collect more data before relying on these figures.'
            : `Based on ${totalRecords} queue entries over the last ${days} days.`
        }
      }
    });
  } catch (error) {
    console.error('Peak hours analytics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error computing peak hours analytics.',
      error: error.message
    });
  }
});


// @desc    Log report generation event
// @route   POST /api/reports/log
// @access  Private (Manager)
router.post('/log', auth, authorize('admin'), async (req, res) => {
  try {
    const { reportType, dateRange, filters, generatedBy } = req.body;

    const report = await Report.create({
      title: `${reportType} Report`,
      type: reportType,
      generatedBy: req.user.id,
      dateRange,
      filters,
      status: 'completed'
    });

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Log report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
