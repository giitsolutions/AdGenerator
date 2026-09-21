const nodemailer = require('nodemailer');
const config = require('../config/env');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.email.user || !config.email.appPassword) return null;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.email.user,
      pass: config.email.appPassword
    }
  });
  return transporter;
}

/**
 * Sends an approval-request email for a freshly generated post,
 * including the image, caption, and one-click Approve/Reject links.
 * Those links are signed tokens (see routes/postRoutes.js) that work
 * without the user needing to log in first — clicking them directly
 * approves or rejects the post from the inbox.
 */
async function sendApprovalEmail({ toEmail, productName, caption, hashtags, imageUrl, approveUrl, rejectUrl }) {
  const t = getTransporter();
  if (!t) {
    console.warn('[emailService] EMAIL_USER / EMAIL_APP_PASSWORD not set — skipping approval email.');
    return false;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>New post ready for ${productName}</h2>
      <img src="${imageUrl}" alt="Generated ad" style="width:100%; border-radius:8px; margin-bottom:16px;" />
      <p><strong>Caption:</strong> ${caption}</p>
      <p><strong>Hashtags:</strong> ${hashtags.join(' ')}</p>
      <div style="margin-top: 24px;">
        <a href="${approveUrl}" style="background:#2ecc71; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; margin-right:12px;">✅ Approve & Post</a>
        <a href="${rejectUrl}" style="background:#e74c3c; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none;">❌ Reject</a>
      </div>
      <p style="color:#888; font-size:12px; margin-top:24px;">This link works without logging in — just click to approve or reject today's post.</p>
    </div>
  `;

  await t.sendMail({
    from: `"AI Ad Generator" <${config.email.user}>`,
    to: toEmail,
    subject: `📣 New post ready for approval — ${productName}`,
    html
  });

  return true;
}

module.exports = { sendApprovalEmail };
