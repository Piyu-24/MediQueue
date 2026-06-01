const AuditLog = require('../models/AuditLog');

/**
 * Audit log middleware factory.
 *
 * Usage (after auth middleware so req.user is populated):
 *   router.post('/checkin', auth, authorize(...), auditLog('QUEUE_CHECKIN', 'QueueEntry'), handler)
 *
 * The middleware extracts the resource ID from res.locals.auditResourceId
 * (set by the route handler before calling next) — OR falls back to req.params.id.
 * It fails silently so it never blocks a request.
 */
const auditLog = (action, resourceType) => {
  return async (req, res, next) => {
    // Capture the original res.json to intercept the response
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      // Only log on successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const resourceId =
          res.locals.auditResourceId ||
          body?.data?.queueEntry?._id ||
          body?.data?.record?._id ||
          body?.data?._id ||
          req.params.id ||
          req.user.id; // fallback

        // Fire-and-forget — do not await
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
