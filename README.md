# BrojoWizard 🧙

A Discord bot that summarizes channel and server-wide conversations using Google's Gemini AI. Built for the Brojo Discord community.

## Commands

| Command | Visibility | Description |
|---|---|---|
| `/tldr duration:4h` | Everyone | Summarize the current channel's last 4 hours (max 3 days) |
| `/all-tldr duration:1d` | Owner only | Server-wide summary across all channels (max 1 week) |
| `/tldr-ban @user 72h` | Admin only | Ban a user from using the bot for a duration |
| `/tldr-unban @user` | Admin only | Unban a user early |

### Duration formats
`30m` · `4h` · `2d` · `1w` (week only available for `/all-tldr`)

### Summary sections
- 📋 **TLDR** — 2-4 sentence overview
- 🏅 **Fan Favorite** — Most-reacted message (ranked by highest single reaction count)
- 🧙 **Wizard's Favorite** — AI picks the funniest from the top 10 reacted posts (≥50 messages)
- 💎 **Hidden Gem** — Funniest message with 0-1 reactions
- 👥 **Key Players** — Who was active and what they were on about
- 📊 **By The Numbers** — Stats line
- 💧 **Water usage** — Teaspoons of water used for input token processing

### Rate limits
- **Per-user:** 2 uses per 10 minutes
- **Per-channel:** 1 request per 5 minutes (cooldown)
- **Owner exemption:** Users in `OWNER_USER_IDS` bypass all limits

---

## Setup

### 1. Discord Developer Portal
1. Go to https://discord.com/developers/applications
2. Create a new application (name it **The Brojo Wizard**)
3. **Bot** tab → Reset Token → copy the **Bot Token**
4. **Bot** tab → Enable **Message Content Intent**
5. **OAuth2** → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Read Message History`, `Send Messages`
6. Use the generated URL to invite the bot to your server

### 2. Gemini API
1. Go to https://aistudio.google.com/
2. Get an API key

### 3. Configure `.env`
```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
GEMINI_API_KEY=your_gemini_key_here
OWNER_USER_IDS=176405874233835520
```

### 4. Install & Run locally
```bash
npm install
npm run register   # Register slash commands with Discord (run once, or when commands change)
npm start          # Start the bot
```

---

## Deployment

The bot runs on **Google Cloud Run** (`sidetrack-481819` / `us-central1`).

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) authenticated (`gcloud auth login`)
- Artifact Registry access to `us-central1-docker.pkg.dev/sidetrack-481819/sidetrack-repo`

### Deploy

```bash
npm run deploy           # Full: test → build → push → deploy → cleanup old images
npm run deploy:skip-build  # Skip Docker build, just update Cloud Run config
```

Or directly:
```powershell
./scripts/deploy.ps1              # Full deploy
./scripts/deploy.ps1 -SkipBuild   # Config-only update
```

### What the deploy script does
1. **Builds** a Docker image tagged with a timestamp (`20260410-193000`)
2. **Pushes** to Artifact Registry (`us-central1-docker.pkg.dev/sidetrack-481819/sidetrack-repo/brojo-bot`)
3. **Deploys** to Cloud Run with:
   - `--min-instances 1` / `--max-instances 1` — always-on for WebSocket
   - `--no-cpu-throttling` — keeps the Discord gateway alive
   - `--memory 512Mi` / `--cpu 1`
4. **Cleans up** old images, keeping the 3 most recent

### Environment variables on Cloud Run
Set once, persisted across deploys:
```bash
gcloud run services update brojo-bot \
  --project sidetrack-481819 \
  --region us-central1 \
  --set-env-vars "DISCORD_BOT_TOKEN=xxx,DISCORD_CLIENT_ID=xxx,GEMINI_API_KEY=xxx,OWNER_USER_IDS=176405874233835520"
```

### Registering commands
Commands are registered **globally** with Discord. Run this after adding/changing command definitions:
```bash
npm run register
```
Global commands can take **up to 1 hour** to propagate to all servers.

### Viewing logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=brojo-bot" \
  --project sidetrack-481819 --limit 30 --format="value(textPayload)" --freshness=30m
```

---

## Project structure

```
src/
├── index.js                 # Entry point, Discord client, interaction router
├── commands/
│   ├── register.js          # Slash command registration (npm run register)
│   ├── tldr.js              # /tldr command handler
│   ├── allTldr.js           # /all-tldr command handler
│   └── banCommands.js       # /tldr-ban and /tldr-unban handlers
├── config/
│   └── models.js            # Model fallback chains (per-command)
├── prompts/
│   ├── tldr.js              # System instruction + prompt builder for /tldr
│   └── allTldr.js           # System instruction + prompt builder for /all-tldr
└── utils/
    ├── bans.js              # Per-server timed ban system
    ├── duration.js          # Duration parser (30m, 4h, 2d, 1w)
    ├── gemini.js            # Shared Gemini client with model fallback
    ├── messages.js          # Discord message fetching, reaction scoring
    ├── rateLimiter.js       # Per-user sliding window rate limiter
    └── utils.test.js        # Unit tests

scripts/
└── deploy.ps1               # Cloud Run deployment script

testbed/                     # Offline prompt testing (fixtures + runner)
```

## Development

```bash
npm run dev                  # Start with auto-reload (--watch)
npm test                     # Run unit tests
npm run testbed              # Run prompt testbed
npm run testbed:dry          # Dry run (show prompts, don't call Gemini)
```

### Model configuration
Models are defined in `src/config/models.js`. Each command has its own fallback chain:

| Command | Primary | Fallback(s) |
|---|---|---|
| `/tldr` | `gemini-3.1-flash-lite-preview` | `gemini-2.5-flash-lite` |
| `/all-tldr` | `gemini-3.1-pro-preview` | `gemini-3.1-flash-lite-preview` → `gemini-2.5-flash-lite` |

If the primary model 503s (capacity), the bot automatically falls back and appends a note.
