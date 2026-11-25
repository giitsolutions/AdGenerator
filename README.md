# KwikPost (AI Instagram Ad Generator)

KwikPost is a multi-user web app that uses AI to create Instagram ads as images and reels, lets the owner review and edit them, and publishes them to Instagram, a Facebook Page and YouTube Shorts, immediately or at a scheduled time.

It is one Node.js + Express server with a SQLite database file. The browser pages are plain HTML files in `public/`; there is no build step.

## Contents

1. [What it does](#what-it-does)
2. [Tech stack](#tech-stack)
3. [Installation (from Git)](#installation-from-git)
4. [Platform setup](#platform-setup) (public HTTPS address, Instagram, YouTube)
5. [Architecture](#architecture)
6. [Content workspaces and workflow](#content-workspaces-and-workflow)
7. [Reel generation details](#reel-generation-details)
8. [Scheduling](#scheduling)
9. [API routes](#api-routes)
10. [Useful commands and troubleshooting](#useful-commands)

## What it does

- **Accounts:** sign up, log in (JWT), reset password by email.
- **Campaigns:** a brand brief (product, audience, tone, offer, website, logo) that all content is built from.
- **Image posts:** Gemini writes the headline, caption and hashtags; the server draws the ad on a canvas using one of 8 layouts.
- **Reels:** stock footage from Pexels (checked by Gemini), a slideshow from your own photo library, or an uploaded MP4, with a text overlay and logo rendered by FFmpeg.
- **Editing:** every draft opens in an editor page to change text, layout and background.
- **Publishing:** Instagram (posts, reels, Stories), Facebook Page, YouTube Shorts.
- **Scheduling:** pick a day and time (default slots 11:00 AM and 5:00 PM); a background scheduler publishes due posts and retries failures.
- **Daily themed drafts:** one draft per campaign per day from a queue of themes, emailed to the owner with Approve and Reject links.

## Tech stack

| Layer | Technology |
| --- | --- |
| Server | Node.js, Express 4 |
| Database | SQLite (`sqlite`, `sqlite3`), file `db/app.db` |
| Auth | `jsonwebtoken`, `bcrypt` |
| AI text | Google Gemini |
| Images | `canvas`, `sharp`; Unsplash, Pexels, your photo library; imgbb for public hosting |
| Video | `ffmpeg-static`, Pexels stock footage |
| Instagram / Facebook | Meta Graph API; Make.com webhook for image posts |
| YouTube | `googleapis` (YouTube Data API v3) |
| Scheduling | `node-cron` and a 30-second timer |
| Email | `nodemailer` with Gmail SMTP |

## Installation (from Git)

### 1. Prerequisites

- **Git**
- **Node.js 18 or newer** (includes npm). Check with `node -v`.
- Free API keys for the services you want to use (step 4). Only Gemini is needed to start generating content.

`npm install` builds the `canvas` and `sqlite3` packages. On Windows and macOS this normally downloads ready-made binaries. On Linux, if the build fails, install the system libraries first:

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

### 2. Clone the repository

```bash
git clone https://github.com/giitsolutions/adgenerator.git
cd adgenerator
```

To get later changes: `git pull`, then `npm install`, then restart the server.

### 3. Install dependencies

```bash
npm install
```

### 4. Create the `.env` file

Copy the example file and fill it in. **Never commit `.env`** (it is in `.gitignore`).

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
copy .env.example .env
```

Generate a value for `JWT_SECRET` (any long random string):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Group | Variables | Where to get it |
| --- | --- | --- |
| Core | `PORT` (default 5000), `JWT_SECRET`, `APP_BASE_URL` | `APP_BASE_URL` is the public HTTPS address of the app (see Platform setup) |
| AI | `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey (free) |
| Photos and video | `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY` | https://unsplash.com/developers and https://www.pexels.com/api/ (free) |
| Image hosting | `IMGBB_API_KEY` | https://api.imgbb.com/ (free); hosts ad images so Instagram can fetch them |
| Instagram image posts | `MAKE_WEBHOOK_URL` | Make.com scenario (see Platform setup) |
| Instagram reels, Stories, Facebook Page | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI`, `FACEBOOK_GRAPH_API_VERSION` | Meta developer app (see Platform setup) |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_PRIVACY`, `APPROVAL_EMAIL_TO` | Google Cloud (see Platform setup) |
| Email | `EMAIL_USER`, `EMAIL_APP_PASSWORD` | Gmail address and a Gmail **app password** (not the normal password) |
| Scheduling | `DAILY_JOB_CRON`, `SCHEDULER_TIMEZONE`, `INTERVAL_SCHEDULER`, `POST_INTERVAL_CRON` | Optional. Daily job default is 13:32 in `Asia/Kolkata` |
| Reels | `REEL_MAX_MB` (100), `REEL_MAX_SECONDS` (90), `REEL_POLL_INTERVAL_MS`, `REEL_POLL_TIMEOUT_MS` | Optional upload limits and how long to wait for Instagram to process a reel |
| Local images (optional) | `LOCAL_SD_URL`, `LOCAL_SD_KEY`, `LOCAL_SD_*` | Only if you run your own Stable Diffusion server; leave unset to use Unsplash and Pexels |

Notes:

- The password-reset email currently reads `EMAIL_PASS`, while the approval emails read `EMAIL_APP_PASSWORD`. Set both to the same app password until the code uses one name.
- `HUGGINGFACE_API_KEY` is in `.env.example` but is not used by the current code.

### 5. Start the server

```bash
npm start
```

Use `npm run dev` for automatic restart on file changes (needs `nodemon`). Otherwise restart `npm start` after every code change.

Open **http://localhost:5000** (or your `PORT`) and create an account on the sign-in page. On first start the server creates `db/app.db` and adds any missing tables and columns by itself; no separate migration command is needed.

If port 5000 is already in use on Windows:

```powershell
netstat -ano | findstr :5000
taskkill /PID <pid> /F
npm start
```

### 6. YouTube tables (only if you use YouTube)

Run these once:

```bash
node create-youtube-tables.js
node create-youtube-schedule-columns.js
```

### 7. Try the flow

1. Create a campaign and add its logo under **Campaigns & branding**.
2. Open **Posts** to generate an image ad and copy, upload library photos, and manage image posts.
3. Open **Reels** to generate a stock video or slideshow, upload an MP4, and manage video posts.
4. Open a draft in the editor, post it now, or schedule it from its page or the calendar. Publishing needs the platform setup below.

## Platform setup

### Public HTTPS address

Instagram downloads images and videos from a public HTTPS URL, so a laptop needs a tunnel or a deployed address in `APP_BASE_URL`, and the Facebook and Google redirect URIs must use that same address. For example, with ngrok installed and signed in (`ngrok config add-authtoken <your-token>`):

```bash
ngrok http 5000
```

Copy the `https://...` address it prints into `APP_BASE_URL`, then restart the server. Reels uploaded from a local file can use Instagram's resumable upload instead and do not need the tunnel. Posting to YouTube uploads the local file directly and does not need it either.

### Instagram: image posts (Make.com webhook)

1. Use an Instagram **professional (Business)** account linked to a Facebook Page.
2. Create a free Make.com scenario: **Webhooks (Custom webhook)** then **Instagram for Business (Create a Photo Post)**.
3. Connect your Instagram account in Make.com (it handles the Facebook login for you).
4. Map the webhook fields `imageUrl` and `caption` to the Instagram module's Photo URL and Caption.
5. Turn the scenario on and copy its webhook URL into `MAKE_WEBHOOK_URL`.

### Instagram: reels, Stories and Facebook Page (direct Graph API)

1. Create an app at https://developers.facebook.com/apps (type: Business) and add Facebook Login and the Instagram Graph API.
2. In App Settings > Basic, copy the App ID and App Secret into `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.
3. In Facebook Login settings, add this exact Valid OAuth Redirect URI and put the same value in `FACEBOOK_REDIRECT_URI`:
   `https://<your-public-address>/api/instagram/callback`
4. The app requests these permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`. While the app is in development mode, only people added as testers or roles on the app can connect.
5. In KwikPost, open `instagram-setup.html` (or press Connect on a page) and sign in with Facebook. The Facebook Page and Instagram account are saved to your user.

### YouTube

1. In Google Cloud Console, create a project and enable the **YouTube Data API v3**.
2. Create an OAuth client (Web application). Add the redirect URI `https://<your-public-address>/api/youtube/callback` (`http://localhost:5000/api/youtube/callback` also works for local testing) and put the same value in `YOUTUBE_REDIRECT_URI`.
3. Copy the client id and secret into `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
4. While the Google app is in **Testing** mode, add each person's Gmail under Test users. `youtube-setup.html` has a button that emails `APPROVAL_EMAIL_TO` a request to add a Gmail.
5. Uploads are `private` until you set `YOUTUBE_PRIVACY=public` (do this once the app is verified).
6. Connect from `youtube-setup.html`.

## Architecture

The code is layered, with one job per folder:

```
config/        environment variables and scheduler settings, loaded once
db/            SQLite connection, table creation, migrations (no business logic)
models/        all SQL queries (posts, campaigns, users, themes, schedule)
controllers/   request/response handling; calls models and services
routes/        URL to controller mapping, no logic
services/      outside work: Gemini, images, reels/FFmpeg, Instagram, Facebook, YouTube, email, schedulers
  providers/   Unsplash, Pexels, local Stable Diffusion
scheduler/     daily themed draft job and scheduled-post runner (reuses the same models and services)
middleware/    JWT check, error handler
utils/         pure helpers (prompt, hashtag and caption builders)
public/        browser pages and scripts
scripts/       helper scripts (list or clear drafts, run the daily job)
test/          workflow tests
server.js      wires everything together and starts the schedulers
```

Why this structure:

- **Single responsibility:** each file has one reason to change. Switching from SQLite to MySQL would only touch `db/connection.js` and the files in `models/`.
- **No duplicated logic:** the manual Generate button and the daily scheduler call the same `aiService.generateAdContent()` and `postModel.createPost()`.
- **Testable in isolation:** `utils/` and the services are isolated functions that can be unit tested without starting the server.
- **Easy to extend:** a new provider means a new file in `services/` called from a controller; nothing else is restructured.

## Content workspaces and workflow

| Page | Purpose |
| --- | --- |
| `login.html`, `reset-password.html` | Sign in or sign up; set a new password |
| `index.html` | Dashboard: campaigns, themes, generate and review image posts |
| `posts.html` | Image posts: generate, review, post now or schedule, month calendar |
| `reels.html` | Reels: generate (stock or slideshow) or upload an MP4, review, post now or schedule, calendar |
| `stories.html` | Stories workspace |
| `schedule.html` | List and calendar of scheduled and posted items |
| `edit.html` | Editor opened from a draft (2-hour link) |
| `upload.html` | Upload photos to the shared image library |
| `instagram-setup.html`, `youtube-setup.html`, `support.html` | Connection steps and help centre |

- Both Posts and Reels share the selected campaign in browser storage. Reel generation and upload use the selected campaign's logo and details.
- The list APIs are type-filtered: `GET /api/posts?content_type=image` and `GET /api/posts?content_type=reel`. The unfiltered `GET /api/posts` remains available to older callers.
- **Status lifecycle:** `generated` (draft), `scheduled`, `posted`. A rejected draft is deleted. The older `ready_to_post` status is still accepted by the code (Approve moves a draft to it) and is moved back to `generated` at startup. Scheduled items can be unscheduled or rescheduled. Publish failures remain Scheduled with the error visible and can be retried. Posted items are view-only.
- **Post now:** reels use `POST /api/posts/:id/publish-now` (Instagram) and `POST /api/posts/:id/publish-facebook`; YouTube uses `POST /api/youtube/upload/:postId`. The Publish panel lets the user pick any of Instagram, Facebook Page, YouTube Shorts and Instagram Story.
- **Daily job:** creates one draft per campaign from the next unused theme and emails the owner. A theme is marked used only when its post is published.

### Database migrations

The idempotent migrations run at server startup and add any missing columns to `posts`, including `content_type`, `posted_at`, `last_error`, `scheduled_at`, and the scheduler lock and retry fields. They do not delete posts. Legacy statuses map as follows: `draft` to `generated`, `approved` to `ready_to_post`, `published` to `posted`, `rejected` to `generated`. Legacy content is classified as a Reel when `media_type = 'reel'` or a `video_url` exists; other records are Images. Old Posted rows without `posted_at` use `created_at` as the best available date.

## Reel generation details

Open **Reels** at `/reels.html`, choose a campaign, enter an optional idea or topic, and generate a 15 to 30 second reel.

- **Stock mode:** Gemini suggests search queries for the topic; Pexels returns candidate clips in any orientation (they are cropped to vertical); Gemini checks sampled frames for topic match and quality. A used clip is saved to a persistent history and never reused; if no new matching clip exists, generation reports an error instead of repeating one.
- **Slideshow mode:** builds the video from photos in the shared library. Automatic mode tries stock footage first; it does not silently switch to a slideshow.
- **Upload mode:** upload your own MP4 (100 MB and 90 seconds by default, set with `REEL_MAX_MB` and `REEL_MAX_SECONDS`); it is branded before being saved as a draft.
- The generator applies the campaign's branding and uses AI for the caption and offer text; it does not synthesize video footage. A random one of 8 overlay layouts is chosen for each reel.
- Only one reel can be generated per account at a time.
- Needs `GEMINI_API_KEY` (clip checks and copy) and `PEXELS_API_KEY` (stock search). Missing keys, network errors, no unused matching clip, an empty slideshow library and rendering errors can prevent generation.
- To publish reels, configure the Facebook app values, set `APP_BASE_URL` to a public HTTPS address (Instagram must be able to download the video) unless the reel is posted from a local file, then connect an Instagram professional account. Image posts continue to publish through the Make.com webhook.

## Scheduling

Dates entered in the UI use the browser's local timezone and are sent as ISO timestamps; timestamps are stored and compared in UTC and formatted in the user's local timezone by the calendar.

- **Default slots:** 11:00 AM first, then 5:00 PM for the chosen day; after both are taken the page asks for a time.
- **Runner:** every minute `scheduler/scheduler.js` claims due items with a 15-minute lock and publishes them. `services/schedulerService.js` also checks every 30 seconds and retries a failed publish after 5 and 10 minutes (three attempts in total).
- **Overdue items:** items more than six hours overdue remain Scheduled with an error; a manual Retry queues them again for about one minute later.
- **Rescheduling** updates the existing scheduled timestamp instead of creating another job; an active publish lock prevents a concurrent move.
- **YouTube schedules:** the video is uploaded immediately as private with a publish time, and YouTube makes it public itself.
- **Catch-up:** if the server was off at the daily job time, the job runs once at the next start.

## API routes

All paths start with `/api`. Routes marked Yes need `Authorization: Bearer <token>`.

```
POST   /auth/signup, /auth/login                  create account, log in
POST   /auth/forgot-password, /auth/reset-password   password reset by email
GET    /auth/me   PATCH /auth/profile   POST /auth/change-password   DELETE /auth/account

POST   /campaigns                       create a campaign
GET    /campaigns                       list campaigns and branding
PUT    /campaigns/:id                   update campaign details/branding
DELETE /campaigns/:id                   delete a campaign
POST   /campaigns/logo                  upload a campaign logo
POST   /campaigns/:id/generate          generate an image post
POST   /campaigns/:id/themes            add themes to the queue
GET    /campaigns/:id/themes            list themes

GET    /library                         list saved photos
POST   /library                         add a photo
DELETE /library/:id                     delete a photo

GET    /posts?content_type=image|reel   list posts (optional status filter)
GET    /posts/schedule-overview         scheduled item counts/overview
GET    /posts/schedule-calendar         scheduled and posted items (content_type, from, to required)
POST   /posts/upload-image              upload a JPG/PNG as a generated image post
POST   /posts/reel-generate             generate a video
POST   /posts/reel-upload               upload a video
POST   /posts/:id/edit-link             create a 2-hour edit link
POST   /posts/:id/approve               move generated content to ready_to_post
POST   /posts/:id/back-to-generated     move ready content back to generated
POST   /posts/:id/schedule              schedule content
PATCH  /posts/:id/schedule              change the date/time of scheduled content
POST   /posts/:id/unschedule            return scheduled content to a draft
POST   /posts/:id/retry                 retry a scheduled item after an error
POST   /posts/:id/reject                reject/delete generated content
POST   /posts/:id/publish-now           publish to Instagram immediately
POST   /posts/:id/publish-facebook      publish to the linked Facebook Page
POST   /posts/:id/story                 share as an Instagram Story
GET    /posts/email-approve, /posts/email-reject   signed links from the approval email
       /posts/edit-data, edit-preview, edit-save, edit-approve   used by edit.html (token in query)

POST   /instagram/connect-url   GET /instagram/callback   GET /instagram/status   POST /instagram/disconnect
POST   /youtube/connect-url     GET /youtube/callback     GET /youtube/status     POST /youtube/disconnect
POST   /youtube/upload/:postId  POST /youtube/schedule/:postId  POST /youtube/request-approval
```

`GET /api/posts` also accepts an optional `status` filter (`generated`, `ready_to_post`, `scheduled`, or `posted`). The calendar endpoint returns only Scheduled and Posted records in the half-open `[from, to)` range.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart (nodemon) |
| `node scripts/listDrafts.js` | List drafts |
| `node scripts/clearDrafts.js` | Delete drafts |
| `node scripts/runDailyJob.js` | Run the daily themed job once |
| `node check-posted.js`, `node check-post.js` | Inspect post status and errors |
| `node reset-post.js` | Reset one post |

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm install` fails on `canvas` | Install the system libraries listed in Installation step 1 |
| Code change has no effect | Restart `npm start` |
| "Instagram ... require a publicly reachable HTTPS video URL" | Set `APP_BASE_URL` to a public HTTPS address, or post reels from a local file |
| Connect popup keeps opening | The Instagram token expired or was removed; reconnect on `instagram-setup.html` |
| YouTube "access blocked" | Add the Gmail as a test user and check the redirect URI matches exactly |
| Approval or reset email not sent | Check `EMAIL_USER` and the Gmail app password (`EMAIL_APP_PASSWORD` and `EMAIL_PASS`) |
| Scheduled post not published | The server was off at that time; it catches up on start within 6 hours, older posts need Retry |

## Security

- Keep `.env`, `db/app.db` and `storage/` out of git. If a key or tunnel token was ever committed or pasted somewhere public, rotate it.
- Generated media in `public/uploads/` is runtime data; do not commit it.
- Passwords are stored as bcrypt hashes; login tokens expire after 30 days.