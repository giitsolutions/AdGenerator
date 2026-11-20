const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const instagramAuthRoutes = require('./routes/instagramAuthRoutes');
const youtubeRoutes = require('./routes/youtubeRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const postRoutes = require('./routes/postRoutes');
const errorHandler = require('./middleware/errorHandler');
const userModel = require('./models/userModel');

// Existing theme / interval schedulers
const {
  startIntervalScheduler,
  startThemeScheduler
} = require('./scheduler/scheduler');

// Schedule + auto-publish feature
const scheduleRoutes = require('./routes/scheduleRoutes');

const { ensureReelColumns } = require('./db/reelMigration');
const { ensureContentWorkflowSchema } = require('./db/contentWorkflowMigration');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Reel videos: must come BEFORE the general static line below.
// Range requests stay on, but Chrome is told not to cache the partial responses.
app.use(
  '/uploads/reels',
  express.static(path.join(__dirname, 'public', 'uploads', 'reels'), {
    acceptRanges: true,
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store');
    }
  })
);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/posts', require('./routes/reelRoutes'));
app.use('/api/auth', authRoutes);
app.use('/api/instagram', instagramAuthRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/posts', scheduleRoutes.router);   // schedule / unschedule / retry
app.use('/api/library', require('./routes/libraryRoutes'));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), { maxAge: 0 }));
app.use(errorHandler); // must be registered last

async function startServer() {
  await ensureReelColumns();
  await ensureContentWorkflowSchema();
  await userModel.ensureFacebookColumns();

  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);

    // Daily theme queue — always on
    startThemeScheduler();

    // Auto-publish posts whose scheduled_at has passed
    scheduleRoutes.startAutoPoster();

    if (config.scheduler.enabled) {
      startIntervalScheduler();
    } else {
      console.log(
        '[scheduler] Interval scheduler disabled (SCHEDULER_ENABLED=false) — theme + scheduled runners still active.'
      );
    }
  });
}

startServer().catch(error => {
  console.error('[server] Could not initialize database or start server:', error);
  process.exitCode = 1;
});