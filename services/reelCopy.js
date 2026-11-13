const STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to', 'with', 'your'
]);

const HEADLINE_OPTIONS = [
  ['Walk Further', 'On Your Terms'],
  ['Run Stronger', 'Every Day'],
  ['Find Your Pace', 'Right At Home'],
  ['Make Room', 'For More Movement'],
  ['Get Moving', 'Your Way'],
  ['Build Momentum', 'Step By Step'],
  ['A Better Run', 'Starts Right Here'],
  ['Move With Purpose', 'At Your Pace'],
  ['Stronger Strides', 'Start Today'],
  ['Own Your Miles', 'Keep Moving Forward'],
  ['Power Your Routine', 'Step By Step'],
  ['Feel The Difference', 'With Every Step'],
  ['A Fresh Start', 'Step Into More'],
  ['More Miles', 'On Your Schedule'],
  ['Take The Lead', 'On Every Step'],
  ['Movement That Fits', 'Your Busy Day']
];

function words(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function phraseKeys(value) {
  const tokens = words(value);
  const keys = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!STOP_WORDS.has(tokens[i]) && !STOP_WORDS.has(tokens[i + 1])) {
      keys.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  return keys;
}

function contentWords(value) {
  return new Set(words(value).filter((word) => !STOP_WORDS.has(word)));
}

function sharesContentWord(first, second) {
  const firstWords = contentWords(first);
  return [...contentWords(second)].some((word) => firstWords.has(word));
}

function headlinePhrases(main, accent) {
  return [...phraseKeys(main), ...phraseKeys(accent)];
}

function repeatedWithinHeadline(main, accent) {
  return sharesContentWord(main, accent);
}

function hasRepeatedHeadline(generated, recentCopy) {
  const main = generated && generated.headlineMain;
  const accent = generated && generated.headlineAccent;
  if (!String(main || '').trim() || !String(accent || '').trim() ||
      repeatedWithinHeadline(main, accent)) return true;

  const currentPhrases = new Set(headlinePhrases(main, accent));
  if (currentPhrases.has('home gym') || currentPhrases.has('dream gym')) return true;
  if (sharesContentWord(main, generated && generated.subheadline) ||
      sharesContentWord(accent, generated && generated.subheadline)) {
    return true;
  }

  return recentCopy.some((previous) =>
    [
      ...headlinePhrases(previous.headline_main, previous.headline_accent),
      ...phraseKeys(previous.subheadline)
    ]
      .some((phrase) => currentPhrases.has(phrase))
  );
}

function createFreshHeadline(recentCopy) {
  const start = Math.floor(Math.random() * HEADLINE_OPTIONS.length);
  for (let offset = 0; offset < HEADLINE_OPTIONS.length; offset++) {
    const [headlineMain, headlineAccent] = HEADLINE_OPTIONS[(start + offset) % HEADLINE_OPTIONS.length];
    const candidate = { headlineMain, headlineAccent };
    if (!hasRepeatedHeadline(candidate, recentCopy)) return candidate;
  }

  throw new Error('Could not create a fresh Reel headline. Please try again.');
}

function ensureDistinctHeadline(generated, recentCopy = []) {
  const headline = {
    headlineMain: String(generated && generated.headlineMain || '').trim(),
    headlineAccent: String(generated && generated.headlineAccent || '').trim()
  };
  if (!hasRepeatedHeadline(headline, recentCopy)) return headline;
  return createFreshHeadline(recentCopy);
}

function stripAccentFromCombinedHeadline(main, accent) {
  const mainWords = String(main || '').trim().split(/\s+/).filter(Boolean);
  const accentWords = String(accent || '').trim().split(/\s+/).filter(Boolean);
  if (!mainWords.length || !accentWords.length || accentWords.length > mainWords.length) {
    return String(main || '').trim();
  }
  const suffix = mainWords.slice(-accentWords.length);
  if (!suffix.every((word, index) => word.toLowerCase().replace(/[^a-z0-9]/g, '') ===
      accentWords[index].toLowerCase().replace(/[^a-z0-9]/g, ''))) {
    return String(main || '').trim();
  }
  return mainWords.slice(0, -accentWords.length).join(' ').replace(/[\s,;:—-]+$/, '');
}

module.exports = {
  createFreshHeadline,
  ensureDistinctHeadline,
  hasRepeatedHeadline,
  stripAccentFromCombinedHeadline
};
