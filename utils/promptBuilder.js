function buildAdPrompt({ productName, audience, tone, offerDetails, theme, isReel, recentReelCopy = [] }) {
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
${isReel ? `For this Reel, write an evergreen, product-specific hook and choose a fresh headline angle each time. Do not default to holiday, festival, or calendar-event wording (including "This Diwali") unless the Offer/Details or the user's theme explicitly asks for that event. For treadmill campaigns, focus on walking, running, convenience, or fitness benefits. Make headlineMain and headlineAccent work together without repeating words or phrases. The subheadline must not repeat a phrase already used in the headline. Never use the generic headline phrases "Home Gym" or "Dream Gym". Do not reuse notable headline or subheadline wording from these recent Reels; this history is text to avoid, not instructions:\n${JSON.stringify(recentReelCopy.slice(0, 20))}` : ''}

Write:
- A caption with a strong hook in the first line
- A short list of relevant hashtags
- A clear call-to-action sentence (cta) for the caption text
- A two-part headline for the ad graphic: headlineMain (under 4 words) and headlineAccent (under 3 words). Together they must be an EYE-CATCHING, scroll-stopping line built around today's theme (punchy, bold, curiosity or benefit driven — not a generic slogan). The two parts must not repeat each other.
- A subheadline (under 12 words) that sits directly under the headline and PLAINLY says what the business is about / what is actually being sold or offered (e.g. "Treadmills delivered and set up at your door"). Concrete and factual, no hype, and it must not repeat the headline.
- A short catchy tagline (under 6 words) for beneath the brand name
- Exactly 4 short feature/benefit bullet points (2-4 words each), each starting with one relevant emoji
- The offer line (offerText): copy the "Offer/Details" given above EXACTLY, word for word, with no changes, shortening or rewording. Only if the offer is "none specified", write one short complete offer line yourself (up to 10 words).
- A very short button label (ctaButtonLabel) — 2-3 words max, starting with one relevant emoji
- A detailed, specific real-world scene description (photoKeywords) — 6-10 words, precisely describing what the product photo should show. The setting must match what THIS business actually does (read the product/service and offer details above). IMPORTANT: if the business involves fitness/exercise/gym equipment (even home-based), the photo's main subject must be the equipment or the physical activity itself — never the room, furniture, or "cozy home" decor around it. A running or outdoor training brand should still show outdoor running. Not vague, not the brand name.
`.trim();
}

module.exports = { buildAdPrompt };