const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/connection');
const yt = require('../services/youtubeService');

const JWT_SECRET = process.env.JWT_SECRET;
// Set YOUTUBE_PRIVACY=public in .env once the app is verified. Until then, keep it private.
const NOW_PRIVACY = process.env.YOUTUBE_PRIVACY || 'private';

async function loadPostAndAccount(db, userId, postId) {
  const post = await db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [postId, userId]);
  if (!post) return { error: [404, 'Video not found'] };
  if (!post.video_url) return { error: [400, 'This post has no video'] };

  const acc = await db.get('SELECT * FROM youtube_accounts WHERE user_id = ?', [userId]);
  if (!acc) return { error: [409, 'Connect YouTube first'] };

  const filePath = path.join(__dirname, '..', 'public', post.video_url.replace(/^\//, ''));
  if (!fs.existsSync(filePath)) return { error: [400, 'Video file is missing on the server'] };

  return { post: post, acc: acc, filePath: filePath };
}

function tokensOf(acc) {
  return { access_token: acc.access_token, refresh_token: acc.refresh_token, expiry_date: acc.expiry_date };
}

// The whole headline: both parts ("Unlock Your" + "Best Workout").
function titleOf(post) {
  const main = String(post.headline_main || '').trim();
  const accent = String(post.headline_accent || '').trim();
  // Do not repeat the accent if the main part already ends with it.
  const headline = accent && !main.toLowerCase().endsWith(accent.toLowerCase())
    ? (main + ' ' + accent).trim()
    : (main || accent);
  return (headline || post.caption || 'Short').split('\n')[0];
}

// The saved hashtags as a clean list like ['#gym', '#treadmill'].
function hashtagsOf(post) {
  let raw = post.hashtags;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = raw.split(/[\s,]+/); }
  }
  if (!Array.isArray(raw)) raw = [];
  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    const word = String(item || '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!word || seen.has(word.toLowerCase())) return;
    seen.add(word.toLowerCase());
    out.push('#' + word);
  });
  return out;
}

// Caption + hashtags. YouTube ignores ALL hashtags when there are more than 15,
// so at most 14 are added here and #Shorts is the 15th.
function descriptionOf(post) {
  const caption = String(post.caption || '').trim();
  const inCaption = new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
  const extra = hashtagsOf(post).filter((tag) => !inCaption.has(tag.toLowerCase()));
  const room = Math.max(0, 14 - inCaption.size);
  const tags = extra.slice(0, room);
  return tags.length ? caption + '\n\n' + tags.join(' ') : caption;
}

exports.connectUrl = function (req, res) {
  const state = jwt.sign({ uid: req.user.id, p: 'yt' }, JWT_SECRET, { expiresIn: '10m' });
  res.json({ url: yt.authUrl(state) });
};

exports.callback = async function (req, res) {
  try {
    const payload = jwt.verify(String(req.query.state || ''), JWT_SECRET);
    if (payload.p !== 'yt') throw new Error('Invalid state');
    const tokens = await yt.exchangeCode(req.query.code);
    const db = await getDb();
    await db.run(
      `INSERT INTO youtube_accounts (user_id, access_token, refresh_token, expiry_date)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, youtube_accounts.refresh_token),
         expiry_date = excluded.expiry_date`,
      [payload.uid, tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null]
    );
    res.redirect('/reels.html?youtube_connected=1');
  } catch (err) {
    console.error('[youtube] callback failed:', err.message);
    res.redirect('/reels.html?youtube_error=' + encodeURIComponent(err.message));
  }
};

exports.status = async function (req, res) {
  const db = await getDb();
  const row = await db.get('SELECT user_id FROM youtube_accounts WHERE user_id = ?', [req.user.id]);
  res.json({ connected: !!row });
};

exports.disconnect = async function (req, res) {
  const db = await getDb();
  await db.run('DELETE FROM youtube_accounts WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
};

// Post now
exports.upload = async function (req, res) {
  try {
    const db = await getDb();
    const found = await loadPostAndAccount(db, req.user.id, req.params.postId);
    if (found.error) return res.status(found.error[0]).json({ error: found.error[1] });

    const videoId = await yt.uploadShort({
      tokens: tokensOf(found.acc),
      filePath: found.filePath,
      title: titleOf(found.post),
      description: descriptionOf(found.post),
      privacy: NOW_PRIVACY
    });

    await db.run('UPDATE posts SET youtube_video_id = ? WHERE id = ?', [videoId, found.post.id]);
    res.json({ ok: true, url: 'https://youtube.com/shorts/' + videoId });
  } catch (err) {
    console.error('[youtube] upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// Schedule: uploads now as private with a publish time. YouTube publishes it at that time.
// platform: 'youtube' (YouTube only, also sets the post as scheduled) or 'both' (Instagram already scheduled it)
exports.schedule = async function (req, res) {
  try {
    const when = new Date(req.body.scheduledAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 2 * 60 * 1000) {
      return res.status(400).json({ error: 'Choose a time at least 2 minutes from now' });
    }
    const platform = req.body.platform === 'both' ? 'both' : 'youtube';

    const db = await getDb();
    const found = await loadPostAndAccount(db, req.user.id, req.params.postId);
    if (found.error) return res.status(found.error[0]).json({ error: found.error[1] });

    const publishAt = when.toISOString();
    const videoId = await yt.uploadShort({
      tokens: tokensOf(found.acc),
      filePath: found.filePath,
      title: titleOf(found.post),
      description: descriptionOf(found.post),
      privacy: 'private',
      publishAt: publishAt
    });

    if (platform === 'youtube') {
      await db.run(
        `UPDATE posts SET youtube_video_id = ?, youtube_publish_at = ?, schedule_platform = 'youtube',
           status = 'scheduled', scheduled_at = ? WHERE id = ?`,
        [videoId, publishAt, publishAt, found.post.id]
      );
    } else {
      await db.run(
        `UPDATE posts SET youtube_video_id = ?, youtube_publish_at = ?, schedule_platform = 'both' WHERE id = ?`,
        [videoId, publishAt, found.post.id]
      );
    }

    res.json({ ok: true, url: 'https://youtube.com/shorts/' + videoId, publishAt: publishAt });
  } catch (err) {
    console.error('[youtube] schedule failed:', err.message);
    res.status(500).json({ error: err.message });
  }
};