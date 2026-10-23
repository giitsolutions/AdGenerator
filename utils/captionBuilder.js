/**
 * Caption helpers for Instagram posts.
 * WhatsApp numbers must be digits only, with country code, no "+" or spaces.
 */

function normalizeWhatsapp(number) {
  if (!number) return null;
  const digits = String(number).replace(/\D/g, '');
  return digits || null;
}

function buildWhatsappLink(number, prefilledText) {
  const digits = normalizeWhatsapp(number);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  return prefilledText ? `${base}?text=${encodeURIComponent(prefilledText)}` : base;
}

function buildContactBlock({ email, whatsappNumber, productName }) {
  const lines = [];

  if (email && String(email).trim()) {
    lines.push(`📧 ${String(email).trim()}`);
  }

  const waLink = buildWhatsappLink(
    whatsappNumber,
    `Hi, I'm interested in ${productName || 'your offer'}`
  );
  if (waLink) {
    lines.push(`💬 WhatsApp: ${waLink}`);
  }

  return lines.join('\n');
}

module.exports = {
  normalizeWhatsapp,
  buildWhatsappLink,
  buildContactBlock
};