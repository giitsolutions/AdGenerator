const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const instagramAuthRoutes = require('./routes/instagramAuthRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const postRoutes = require('./routes/postRoutes');
const errorHandler = require('./middleware/errorHandler');

// Existing theme / interval schedulers
const {
  startIntervalScheduler,
  startThemeScheduler
} = require('./scheduler/scheduler');

// Schedule + auto-publish feature
const scheduleRoutes = require('./routes/scheduleRoutes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/instagram', instagramAuthRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/posts', scheduleRoutes.router);   // schedule / unschedule / retry
app.use('/api/library', require('./routes/libraryRoutes'));

app.use(errorHandler); // must be registered last

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