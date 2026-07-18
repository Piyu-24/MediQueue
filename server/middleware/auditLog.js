const AuditLog = require('../models/AuditLog');

// Builds middleware that writes an audit log entry after a successful response.
// Use it after auth so req.user is set, e.g. auditLog('QUEUE_CHECKIN', 'QueueEntry').
// It never blocks the request - logging failures are just swallowed.
const auditLog = (action, resourceType) => {
  return async (req, res, next) => {
    // Wrap res.json so we can log after the response is sent
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      // Only log successful (2xx) responses
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const resourceId =
          res.locals.auditResourceId ||
          body?.data?.queueEntry?._id ||
          body?.data?.record?._id ||
          body?.data?._id ||
          req.params.id ||
          req.user.id; // fallback

        // Don't await - just write it in the background
        AuditLog.createLog({
          userId: req.user.id,
          userRole: req.user.role,
          action,
          resourceType,
          resourceId,
          patientId:
            req.body?.patientId ||
            body?.data?.queueEntry?.patient ||
            body?.data?.record?.patient ||
            undefined,
          ipAddress: req.ip || req.connection?.remoteAddress || '0.0.0.0',
          userAgent: req.headers['user-agent'] || 'unknown',
          status: 'SUCCESS',
          description: `${action} by ${req.user.role} (${req.user.id})`,
          metadata: {
            method: req.method,
            path: req.originalUrl,
          },
        }).catch((err) =>
          console.warn('[AuditLog] Failed to write log:', err.message)
        );
      }

      return originalJson(body);
    };

    next();
  };
};

module.exports = auditLog;
