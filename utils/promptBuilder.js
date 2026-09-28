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
IMPORTANT: Make this specific piece of copy fresh and distinct — vary your
sentence structure, hook style, opening line, and word choice each time,
even if you've been asked to write about this same product or theme before.
Do not repeat generic phrasing or reuse the same sentence pattern as a
typical previous response.

Write:
- A caption with a strong hook in the first line
- A short list of relevant hashtags
- A clear call-to-action sentence (cta) for the caption text
- A two-part headline for the ad graphic: headlineMain (under 4 words) and headlineAccent (under 3 words) — accent gets a highlighted color
- A subheadline (under 10 words) supporting the headline
- A short catchy tagline (under 6 words) for beneath the brand name
- Exactly 4 short feature/benefit bullet points (2-4 words each), each starting with one relevant emoji
- The complete offer (offerText) on ONE line, up to 10 words, including what it applies to and any deadline (e.g. "20% OFF annual membership — this month only"). Never a fragment.- A very short button label (ctaButtonLabel) — 2-3 words max, starting with one relevant emoji
- A detailed, specific real-world scene description (photoKeywords) — 6-10 words, precisely describing what the product photo should show. The setting must match what THIS business actually does (read the product/service and offer details above). IMPORTANT: if the business involves fitness/exercise/gym equipment (even home-based), the photo's main subject must be the equipment or the physical activity itself — never the room, furniture, or "cozy home" decor around it. A running or outdoor training brand should still show outdoor running. Not vague, not the brand name.
`.trim();
}

module.exports = { buildAdPrompt };