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

function titleOf(post) {
  return (post.headline_main || post.caption || 'Short').split('\n')[0];
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
      description: found.post.caption || '',
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
      description: found.post.caption || '',
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