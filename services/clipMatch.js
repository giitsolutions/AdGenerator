// Keeps only stock videos whose Pexels page address names the topic.
// Example: https://www.pexels.com/video/woman-running-on-treadmill-12345/

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'for', 'in', 'on', 'with', 'to', 'my', 'your', 'our']);

function keywordsOf(topic) {
  return String(topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (w) { return w.length > 2 && !STOP_WORDS.has(w); });
}

// True when every main topic word appears in the clip's page address.
function clipMatchesTopic(video, topic) {
  const words = keywordsOf(topic);
  if (words.length === 0) return true;
  const address = String((video && video.url) || '').toLowerCase().replace(/[-_\/]/g, ' ');
  return words.every(function (w) { return address.indexOf(w) !== -1; });
}

module.exports = { clipMatchesTopic, keywordsOf };