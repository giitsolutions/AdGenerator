function buildAdPrompt({ productName, audience, tone, offerDetails, theme }) {
  return `
You are an expert Instagram marketing copywriter who stays current with the latest
social media trends (hook styles, hashtag patterns, caption structure, emoji usage).

Generate ONE Instagram ad post for the following product/campaign:

Product/Service: ${productName}
Target Audience: ${audience || 'general audience'}
Tone: ${tone || 'friendly and engaging'}
Offer/Details: ${offerDetails || 'none specified'}
${theme ? `\nToday's specific content angle/theme (build the post around this): ${theme}\n` : ''}
Write:
- A caption with a strong hook in the first line
- A short list of relevant hashtags
- A clear call-to-action sentence (cta) for the caption text
- A two-part headline for the ad graphic: headlineMain (under 4 words) and headlineAccent (under 3 words) — accent gets a highlighted color
- A subheadline (under 10 words) supporting the headline
- A short catchy tagline (under 6 words) for beneath the brand name
- Exactly 4 short feature/benefit bullet points (2-4 words each), each starting with one relevant emoji
- The core offer (offerText) — under 6 words, short enough to fit in a circular badge
- A very short button label (ctaButtonLabel) — 2-3 words max, starting with one relevant emoji
- A detailed, specific real-world scene description (photoKeywords) — 6-10 words, precisely describing what the product photo should show, concrete enough to reliably find a matching real photo (not vague, not the brand name)
`.trim();
}

module.exports = { buildAdPrompt };
