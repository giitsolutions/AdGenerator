const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const instagramAuthRoutes = require('./routes/instagramAuthRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const postRoutes = require('./routes/postRoutes');
const errorHandler = require('./middleware/errorHandler');
const { startIntervalScheduler, startThemeScheduler } = require('./scheduler/scheduler');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/instagram', instagramAuthRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/posts', postRoutes);

app.use(errorHandler); // must be registered last

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);

  // The daily theme queue is always active — it's the intended,
  // controlled way to auto-generate posts (one per day, per campaign
  // that has themes loaded), so it doesn't get disabled by the
  // interval scheduler's off-switch below.
  startThemeScheduler();

  if (config.scheduler.enabled) {
    startIntervalScheduler();
  } else {
    console.log('[scheduler] Interval scheduler disabled (SCHEDULER_ENABLED=false) — only the daily theme queue is active.');
  }
});
