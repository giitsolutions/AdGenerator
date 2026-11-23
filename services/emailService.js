const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.email.user, pass: env.email.appPassword },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }
  return transporter;
}

function missingCredentials() {
  return !env.email.user || !env.email.appPassword;
}

async function verifyEmailSetup() {
  if (missingCredentials()) {
    return { ok: false, error: 'EMAIL_USER or EMAIL_APP_PASSWORD is missing in .env' };
  }
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const button = (href, label, color) =>
  `<td style="padding:6px"><a href="${esc(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;
   font-weight:bold;font-family:Arial,sans-serif;font-size:15px;padding:13px 22px;border-radius:8px">${label}</a></td>`;

function buildHtml({ campaignName, themeLabel, caption, imgSrc, links }) {
  return `<div style="max-width:560px;margin:auto;font-family:Arial,sans-serif;color:#222">
  <h2 style="margin:0 0 4px">New post ready for ${esc(campaignName)}</h2>
  ${themeLabel ? `<p style="margin:0 0 12px;color:#666">Theme: <b>${esc(themeLabel)}</b></p>` : ''}
  ${imgSrc ? `<img src="${esc(imgSrc)}" alt="Post image" style="width:100%;border-radius:10px;display:block;margin:12px 0">` : ''}
  <div style="white-space:pre-wrap;line-height:1.5;background:#f6f6f8;padding:14px;border-radius:10px">${esc(caption)}</div>
  <table role="presentation" style="margin:18px auto"><tr>
    ${button(links.approve, 'Approve &amp; Post', '#16a34a')}
    ${button(links.edit, 'Edit', '#2563eb')}
    ${button(links.reject, 'Reject', '#dc2626')}
  </tr></table>
  <p style="font-size:12px;color:#888;text-align:center">These links work without logging in and expire in 7 days.</p></div>`;
}

function isUsableEmail(to) {
  const s = String(to || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(s)) return false;
  // Gmail cannot deliver to fake local addresses
  if (/@(localhost|local|example\.com)$/i.test(s)) return false;
  return true;
}

async function sendApprovalEmail({ to, campaignName, themeLabel, caption, imageUrl, imagePath, links }) {
  if (missingCredentials()) {
    throw new Error('Cannot send approval email: EMAIL_USER or EMAIL_APP_PASSWORD is missing in .env');
  }
  if (!isUsableEmail(to)) {
    throw new Error(
      `Cannot send approval email: invalid recipient "${to}". Need a real user email on the users table.`
    );
  }
  if (!links || !links.approve || !links.edit || !links.reject) {
    throw new Error('Cannot send approval email: action links are missing');
  }

  const useCid = Boolean(imagePath);
  const publicUrl =
    imageUrl &&
    /^https?:\/\//i.test(imageUrl) &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(imageUrl)
      ? imageUrl
      : null;

  console.log('[emailService] sendApprovalEmail TO:', to, '| campaign:', campaignName);

  const info = await getTransporter().sendMail({
    from: `KwikPost <${env.email.user}>`,
    to, // always the argument — never env.notificationEmail here
    subject: `New post ready: ${campaignName}${themeLabel ? ' — ' + themeLabel : ''}`,
    text: `${caption}\n\nApprove & Post: ${links.approve}\nEdit: ${links.edit}\nReject: ${links.reject}`,
    html: buildHtml({
      campaignName,
      themeLabel,
      caption,
      imgSrc: useCid ? 'cid:postimage' : publicUrl,
      links,
    }),
    attachments: useCid ? [{ filename: 'post.png', path: imagePath, cid: 'postimage' }] : [],
  });

  console.log(`Approval email sent to ${to} (${info.messageId || 'ok'})`);
  return info;
}

module.exports = { sendApprovalEmail, verifyEmailSetup, isUsableEmail };
module.exports = { ...module.exports, getTransporter };