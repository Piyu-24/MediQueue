const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  let transporter;

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    // Real SMTP — works in any environment as long as credentials are set in .env
    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || undefined,
      host:    process.env.EMAIL_HOST    || undefined,
      port:    process.env.EMAIL_PORT    ? Number(process.env.EMAIL_PORT) : 587,
      secure:  process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  } else if (process.env.NODE_ENV !== 'production') {
    // Development fallback: generate a real Ethereal test account on demand.
    // Emails are captured at https://ethereal.email — they are NOT delivered to
    // real inboxes. Open the preview URL logged below to read the email.
    const account = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: account.user, pass: account.pass },
    });
    console.warn(
      '\n  No SMTP credentials in .env — using Ethereal test account.\n' +
      '   Emails are captured on Ethereal and will NOT arrive in real inboxes.\n' +
      '   Add EMAIL_USER and EMAIL_PASS to .env to enable real delivery.\n'
    );
  } else {
    throw new Error(
      'Email service not configured. ' +
      'Set EMAIL_USER and EMAIL_PASS (and optionally EMAIL_SERVICE or EMAIL_HOST) in environment variables.'
    );
  }

  const htmlBody = options.html || options.message.replace(/\n/g, '<br>');

  let info;
  try {
    info = await transporter.sendMail({
      from:    `${process.env.FROM_NAME || 'MediQueue'} <${process.env.FROM_EMAIL || 'noreply@mediqueue.lk'}>`,
      to:      options.email,
      replyTo: options.replyTo || undefined,
      subject: options.subject,
      text:    options.message,
      html:    htmlBody,
    });
  } catch (err) {
    // Translate common SMTP auth failures into a clear actionable message
    if (err.code === 'EAUTH') {
      const isGmail = (process.env.EMAIL_SERVICE || '').toLowerCase() === 'gmail'
        || (process.env.EMAIL_HOST || '').includes('gmail');
      const hint = isGmail
        ? 'Gmail rejected the credentials. Regular Gmail passwords no longer work for SMTP. ' +
          'Generate an App Password at https://myaccount.google.com/apppasswords and set it as EMAIL_PASS in .env.'
        : 'SMTP authentication failed. Check that EMAIL_USER and EMAIL_PASS in .env are correct.';
      const friendly = new Error(hint);
      friendly.code       = 'EAUTH';
      friendly.originalError = err;
      throw friendly;
    }
    throw err;
  }

  console.log('Email sent — id: %s  to: %s', info.messageId, options.email);

  // When using Ethereal, log the preview URL so developers can read the email
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log('Ethereal preview (open in browser): %s', previewUrl);
  }

  return info;
};

module.exports = sendEmail;
