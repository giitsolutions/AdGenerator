const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, registerFont } = require('canvas');
const sharp = require('sharp');
const imageService = require('./imageService');
const { stripAccentFromCombinedHeadline } = require('./reelCopy');

const regularFont = path.join(__dirname, '../fonts/Poppins-Regular.ttf');
const boldFont = path.join(__dirname, '../fonts/Poppins-Bold.ttf');
const FONT = fs.existsSync(regularFont) && fs.existsSync(boldFont) ? 'Poppins' : 'Arial';

if (FONT === 'Poppins') {
  registerFont(regularFont, { family: 'Poppins', weight: 'normal' });
  registerFont(boldFont, { family: 'Poppins', weight: 'bold' });
}

function wrappedLines(context, text, maxWidth, maxLines) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,!?;:]?$/, '')}…`;
  }
  return lines;
}

function drawLines(context, lines, x, y, lineHeight) {
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

async function loadLogoImage(logoPath) {
  let logo;
  try {
    logo = await loadImage(logoPath);
  } catch (_) {
    logo = await loadImage(await sharp(logoPath).png().toBuffer());
  }
  return imageService.removeLogoBackground(logo);
}

async function renderReelOverlay({
  width = 1080, height = 1920, logoPath, brand, headline,
  headlineMain, headlineAccent, subheadline, caption, offer, cta, layoutIndex = 0
}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Video dimensions are required to render the reel overlay');
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const scale = Math.min(width / 1080, height / 1920);
  const margin = Math.round(width * 0.07);
  const center = width / 2;
  const textWidth = width - margin * 2;
  const accent = imageService.pickColor(brand || headlineMain || headline || '');
  const layout = Number.isInteger(Number(layoutIndex)) && Number(layoutIndex) >= 0 && Number(layoutIndex) < 8
    ? Number(layoutIndex)
    : 0;
  const offerText = String(offer || '').trim();

  if (logoPath) {
    try {
      const logo = await loadLogoImage(logoPath);
      const maxLogoWidth = width * 0.3;
      const maxLogoHeight = height * 0.12;
      const logoScale = Math.min(maxLogoWidth / logo.width, maxLogoHeight / logo.height, 1);
      const logoWidth = Math.max(1, Math.round(logo.width * logoScale));
      const logoHeight = Math.max(1, Math.round(logo.height * logoScale));
      const logoX = width - margin - logoWidth;
      context.drawImage(logo, logoX, Math.round(height * 0.045), logoWidth, logoHeight);
    } catch (error) {
      throw new Error(`Could not render campaign logo: ${error.message}`);
    }
  }

  const panelTop = Math.round(height * (layout === 4 ? 0.53 : 0.58));
  const panel = context.createLinearGradient(0, panelTop, 0, height);
  panel.addColorStop(0, 'rgba(0, 0, 0, 0)');
  panel.addColorStop(0.25, 'rgba(0, 0, 0, 0.68)');
  panel.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
  context.fillStyle = panel;
  context.fillRect(0, panelTop, width, height - panelTop);

  if (layout === 1) {
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(2, Math.round(12 * scale));
    context.strokeRect(margin / 2, margin / 2, width - margin, height - margin);
    context.fillStyle = 'rgba(0, 0, 0, 0.94)';
    context.fillRect(0, Math.round(height * 0.87), width, Math.round(height * 0.13));
  } else if (layout === 2) {
    context.fillStyle = 'rgba(0, 0, 0, 0.42)';
    context.fillRect(0, 0, width, Math.round(height * 0.18));
  } else if (layout === 3) {
    context.fillStyle = accent;
    context.fillRect(0, Math.round(height * 0.86), width, Math.round(height * 0.14));
  } else if (layout === 4) {
    context.save();
    context.translate(-width * 0.12, height * 0.56);
    context.rotate(-Math.PI / 12);
    context.fillStyle = accent;
    context.fillRect(0, 0, width * 0.75, Math.round(height * 0.055));
    context.restore();
  } else if (layout === 5) {
    const cardY = Math.round(height * 0.62);
    const cardHeight = Math.round(height * 0.34);
    context.fillStyle = 'rgba(12, 12, 16, 0.68)';
    context.beginPath();
    context.roundRect(margin / 2, cardY, width - margin, cardHeight, Math.round(28 * scale));
    context.fill();
  } else if (layout === 6) {
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.lineWidth = Math.max(2, Math.round(8 * scale));
    context.strokeRect(margin / 2, margin / 2, width - margin, height - margin);
    context.strokeStyle = 'rgba(255,255,255,0.52)';
    context.lineWidth = Math.max(1, Math.round(3 * scale));
    context.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
  }

  if (layout === 0 && offerText) {
    const pillFontSize = Math.round(32 * scale);
    context.font = `bold ${pillFontSize}px ${FONT}`;
    const pillWidth = Math.min(width * 0.78, context.measureText(offerText).width + width * 0.1);
    const pillHeight = Math.round(68 * scale);
    const pillY = Math.round(height * 0.58);
    context.fillStyle = accent;
    context.beginPath();
    context.roundRect(center - pillWidth / 2, pillY, pillWidth, pillHeight, pillHeight / 2);
    context.fill();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(offerText, center, pillY + pillHeight / 2, pillWidth - 20 * scale);
  }

  const leftAligned = layout === 4 || layout === 5;
  const textX = leftAligned ? margin : center;
  const textAlign = leftAligned ? 'left' : 'center';
  context.textAlign = textAlign;
  context.textBaseline = 'top';
  context.shadowColor = 'rgba(0, 0, 0, 0.55)';
  context.shadowBlur = Math.round(8 * scale);
  context.shadowOffsetY = Math.round(2 * scale);

  let y = Math.round(height * 0.7);
  const accentText = String(headlineAccent || '').trim();
  const combinedOrMainText = String(headlineMain || headline || brand || '').trim();
  const mainText = headlineMain
    ? combinedOrMainText
    : stripAccentFromCombinedHeadline(combinedOrMainText, accentText) || combinedOrMainText;
  const mainFontSize = Math.round(64 * scale);
  context.font = `bold ${mainFontSize}px ${FONT}`;
  context.fillStyle = '#ffffff';
  y = drawLines(context, wrappedLines(context, mainText, textWidth, 2), textX, y, Math.round(mainFontSize * 1.12));

  if (accentText) {
    const accentFontSize = Math.round(60 * scale);
    context.font = `bold ${accentFontSize}px ${FONT}`;
    const accentLines = wrappedLines(context, accentText, textWidth, 2);
    if (layout === 7) {
      context.save();
      context.globalAlpha = 0.3;
      context.fillStyle = accent;
      context.fillRect(margin / 2, y - Math.round(4 * scale), width - margin, accentLines.length * Math.round(accentFontSize * 1.12) + Math.round(8 * scale));
      context.restore();
      context.fillStyle = '#ffffff';
    } else {
      context.fillStyle = accent;
    }
    y = drawLines(context, accentLines, textX, y, Math.round(accentFontSize * 1.12));
  }

  const subText = String(subheadline || '').trim();
  if (subText) {
    const subFontSize = Math.round(28 * scale);
    context.font = `${subFontSize}px ${FONT}`;
    context.fillStyle = 'rgba(255,255,255,0.94)';
    y = drawLines(context, wrappedLines(context, subText, textWidth, 2), textX, y + Math.round(10 * scale), Math.round(subFontSize * 1.3));
  }

  if (offerText && layout !== 0 && layout !== 3 && layout !== 7) {
    const offerFontSize = Math.round(34 * scale);
    context.font = `bold ${offerFontSize}px ${FONT}`;
    context.fillStyle = layout === 1 ? '#ffffff' : accent;
    if (layout === 4) {
      y = Math.round(height * 0.635);
    } else if (layout === 1) {
      y = Math.round(height * 0.87);
    } else {
      y += Math.round(12 * scale);
    }
    y = drawLines(context, wrappedLines(context, offerText, textWidth, 2), textX, y, Math.round(offerFontSize * 1.2));
  }

  const buttonText = String(cta || '').trim();
  if (buttonText) {
    const buttonFontSize = Math.round(30 * scale);
    context.font = `bold ${buttonFontSize}px ${FONT}`;
    const buttonLabel = wrappedLines(context, buttonText, width * 0.72, 1)[0];
    const buttonWidth = layout === 3
      ? Math.min(width * 0.43, Math.max(width * 0.28, context.measureText(buttonLabel).width + width * 0.07))
      : Math.min(width * 0.8, Math.max(width * 0.28, context.measureText(buttonLabel).width + width * 0.08));
    const buttonHeight = Math.round(76 * scale);
    const buttonY = layout === 3
      ? Math.round(height * 0.9)
      : layout === 1
      ? Math.round(height * 0.925)
      : Math.min(Math.round(height * 0.92), y + Math.round(18 * scale));
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = layout === 3 ? '#ffffff' : layout === 7 ? '#111111' : accent;
    context.beginPath();
    const buttonCenterX = layout === 3 ? width - margin - buttonWidth / 2 : center;
    context.roundRect(buttonCenterX - buttonWidth / 2, buttonY, buttonWidth, buttonHeight, buttonHeight * 0.28);
    context.fill();
    context.fillStyle = layout === 3 ? accent : '#ffffff';
    context.textBaseline = 'middle';
    context.fillText(buttonLabel, buttonCenterX, buttonY + buttonHeight / 2, buttonWidth - 24 * scale);
  }

  if (layout === 3 && offerText) {
    const offerFontSize = Math.round(28 * scale);
    context.font = `bold ${offerFontSize}px ${FONT}`;
    context.fillStyle = '#ffffff';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(offerText, margin, Math.round(height * 0.9), width * 0.43);
  } else if (layout === 7 && offerText) {
    const offerFontSize = Math.round(28 * scale);
    context.font = `bold ${offerFontSize}px ${FONT}`;
    context.fillStyle = '#111111';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(offerText, center, Math.round(height * 0.89), width * 0.7);
  }

  return canvas.toBuffer('image/png');
}

async function renderUploadReelOverlay(options) {
  return renderReelOverlay(options);
}

module.exports = { renderUploadReelOverlay, renderReelOverlay };
