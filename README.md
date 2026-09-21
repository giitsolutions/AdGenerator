# AI Instagram Ad Generator — Modular Structure

## Architecture (layered, single-responsibility per module)

```
config/         → environment variables & scheduler settings, loaded once, reused everywhere
db/             → raw DB connection only (no business logic)
models/         → all SQL queries live here (campaignModel, postModel)
services/       → external API calls only (Gemini, image generation/hosting, Make.com webhook) — no DB, no Express
utils/          → pure helper functions (e.g. prompt builder) — no side effects, easy to test
controllers/    → request/response handling — calls models + services, never talks to DB or APIs directly
routes/         → just maps URLs to controller functions, no logic
middleware/     → cross-cutting concerns (error handling)
scheduler/      → cron job — reuses the SAME models/services as the API, no duplicated logic
public/         → frontend dashboard (HTML/JS)
server.js       → wires everything together, ~20 lines
```

## Why this structure (for your mentor)
- **Single responsibility**: each file has exactly one reason to change. Need to switch from SQLite to MySQL? Only `db/connection.js` and the two files in `models/` change — nothing else.
- **No duplicated logic**: the manual "Generate" button and the automatic scheduler both call the exact same `aiService.generateAdContent()` and `postModel.createPost()` — the pipeline is written once, used twice.
- **Testable in isolation**: `utils/promptBuilder.js` and the services are pure/isolated functions you could unit test without spinning up the whole server.
- **Easy to extend**: adding image-generation later just means adding `services/imageService.js` and calling it from the controller — no restructuring needed.

## Setup Steps

### 1. Install dependencies
```bash
cd insta-ai-poster
npm install
```

### 2. Get your free API keys
- **Gemini API key (free):** https://aistudio.google.com/app/apikey
- **imgbb API key (free):** https://api.imgbb.com/ — used to host the auto-generated ad image publicly
- **Instagram posting via Make.com (free tier):**
  1. Convert your Instagram account to a **Business account**, linked to a Facebook Page.
  2. Sign up at https://www.make.com
  3. Create a scenario: **Webhooks (Custom webhook)** → **Instagram for Business (Create a Photo Post)**
  4. Connect your Instagram account when prompted (Make.com handles the Facebook OAuth for you — no Developer Portal needed).
  5. Map the webhook's `imageUrl` and `caption` fields into the Instagram module's Photo URL / Caption fields.
  6. Turn the scenario **ON**, and copy its webhook URL.

### 3. Configure environment variables
```bash
cp .env.example .env
```
Fill in `GEMINI_API_KEY`, `IMGBB_API_KEY`, and `MAKE_WEBHOOK_URL` in `.env`.

### 4. Run the server
```bash
npm start
```
Visit **http://localhost:5000**

### 5. Try the flow
1. Save a campaign → 2. Generate with AI (this also auto-generates and hosts an ad image) → 3. Review the draft (image + caption + hashtags shown together) → 4. Approve & Post — no manual image needed, it's already attached.

## API Routes (now organized by resource)
```
POST   /api/campaigns              → create a campaign
GET    /api/campaigns              → list campaigns
POST   /api/campaigns/:id/generate → generate a new draft for a campaign

GET    /api/posts                  → list all posts/drafts
POST   /api/posts/:id/approve      → approve + auto-post to Instagram
POST   /api/posts/:id/reject       → reject a draft
```
