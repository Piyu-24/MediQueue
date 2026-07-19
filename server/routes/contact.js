const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

// Limit contact messages so the form can't be used to spam the inbox
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many messages sent. Please try again in a little while.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Where contact-form messages are sent (falls back to the sending account)
const OFFICIAL_EMAIL = process.env.CONTACT_EMAIL || process.env.EMAIL_USER || 'queuemedi@gmail.com';

// POST /api/contact - send a contact-form message to the official inbox
router.post('/',
  contactLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
    body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 30 }),
    body('subject').trim().notEmpty().withMessage('Subject is required').isLength({ max: 100 }),
    body('message').trim().notEmpty().withMessage('Message is required').isLength({ min: 5, max: 2000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
    }

    const { name, email, phone, subject, message } = req.body;

    try {
      await sendEmail({
        email: OFFICIAL_EMAIL,
        replyTo: email, // so we can reply straight to the person who wrote in
        subject: `Contact form: ${subject} - from ${name}`,
        message:
          'New message from the MediQueue contact form.\n\n' +
          `Name: ${name}\n` +
          `Email: ${email}\n` +
          `Phone: ${phone || 'N/A'}\n` +
          `Subject: ${subject}\n\n` +
          `Message:\n${message}\n`,
      });

      return res.json({ success: true, message: 'Your message has been sent. We will get back to you soon.' });
    } catch (err) {
      console.error('Contact form email error:', err.message);
      return res.status(502).json({ success: false, message: 'Sorry, we could not send your message right now. Please try again later.' });
    }
  }
);

module.exports = router;
