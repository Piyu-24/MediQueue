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
// @access  Private (Admin)
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Get appointment reports
// @route   GET /api/reports/appointments
// @access  Private (Admin)
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Patient visits report - built from appointment records
// @route   GET /api/reports/patient-visits?startDate=&endDate=
// @access  Private (Admin)
router.get('/patient-visits', auth, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end   = endDate   ? new Date(endDate)   : new Date();
    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);

    // All appointments in the date range
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

    // Count by status
    const statusCounts = appointments.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    }, {});

    // Count unique patients
    const uniquePatients = new Set(appointments.map(a => String(a.patient))).size;

    // Appointments per day
    const dailyMap = {};
    for (const a of appointments) {
      const day = new Date(a.appointmentDate).toISOString().split('T')[0];
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }
    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Count by department
    const deptMap = {};
    for (const a of appointments) {
      if (a.department) {
        deptMap[a.department] = (deptMap[a.department] || 0) + 1;
      }
    }
    const byDepartment = Object.entries(deptMap)
      .sort(([, a], [, b]) => b - a)
      .map(([department, count]) => ({ department, count }));

    // Count by appointment type
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
    return res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// @desc    Doctor activity report - per-doctor appointment counts
// @route   GET /api/reports/doctor-activity?startDate=&endDate=
// @access  Private (Admin)
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
        doctorMap[id] = { name, specialization: a.doctor.specialization || '', total: 0, completed: 0, cancelled: 0, noShow: 0, other: 0 };
      }
      doctorMap[id].total++;
      if (a.status === 'completed')       doctorMap[id].completed++;
      else if (a.status === 'cancelled')  doctorMap[id].cancelled++;
      else if (a.status === 'no-show')    doctorMap[id].noShow++;
      // Everything else (booked, scheduled, in_queue, in_consultation,
      // rescheduled, late, delayed, etc.) is upcoming/active — bucket it so
      // the row reconciles: total = completed + cancelled + noShow + other.
      else                                doctorMap[id].other++;
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
    return res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Export report
// @route   GET /api/reports/export/:type
// @access  Private (Admin)
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Generate report preview
// @route   GET /api/reports/generate/:reportType
// @access  Private (Admin)
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Download report as PDF
// @route   GET /api/reports/download/:reportType
// @access  Private (Admin)
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Peak hours analytics from queue check-in times
// @route   GET /api/reports/peak-hours?days=30
// @access  Private (Admin)
router.get('/peak-hours', auth, authorize('admin'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

    // Date window
    const now   = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // Group queue entries by hour of check-in, and work out the average
    // check-ins and average wait time per hour over the last N days
    const hourlyRaw = await QueueEntry.aggregate([
      {
        $match: {
          checkInTime: { $gte: start, $lte: now },
          // Skip cancelled entries
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
          // Only count wait time for patients who were called
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
      // For each hour of day, average across all the days
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

    // Total check-ins per day
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

    // Today's totals
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

    // Build a full 0-23 hour array; hours with no data are null
    const globalAvgCheckIns = hourlyRaw.length > 0
      ? hourlyRaw.reduce((s, h) => s + h.avgCheckIns, 0) / hourlyRaw.length
      : 0;

    // Rate an hour's demand against the overall hourly average
    const classifyLevel = (avg, globalAvg) => {
      if (!globalAvg) return 'Low';
      const ratio = avg / globalAvg;
      if (ratio > 1.5)  return 'Very High';
      if (ratio > 1.0)  return 'High';
      if (ratio > 0.5)  return 'Medium';
      return 'Low';
    };

    // Average the wait times for an hour
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

    // KPIs
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

    // Daily trend
    const dailyTrend = dailyRaw.map(d => ({
      date:          d._id,
      totalCheckIns: d.totalCheckIns
    }));

    // Fewer than 10 records isn't enough to be meaningful
    const insufficient = totalRecords < 10;

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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// @desc    Log report generation event
// @route   POST /api/reports/log
// @access  Private (Admin)
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
