# BrojoWizard 🧙

A Discord bot that summarizes recent channel conversations using Google's Gemini 3 Flash AI.

## Setup

### 1. Discord Developer Portal
1. Go to https://discord.com/developers/applications
2. Create a new application
3. **Bot** tab → Reset Token → copy the **Bot Token** (NOT the OAuth2 Client Secret)
4. **Bot** tab → No privileged intents needed
5. **OAuth2** → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Read Message History`, `Send Messages`
6. Use the generated URL to invite the bot to your server

### 2. Gemini API
1. Go to https://aistudio.google.com/
2. Get an API key

### 3. Configure
Fill in `.env`:
```
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
GEMINI_API_KEY=your_gemini_key_here
```

### 4. Install & Run
```bash
npm install
npm run register   # Register slash commands (one-time)
npm start          # Start the bot
```

## Usage

In any text channel where the bot is present:
```
/tldr duration:4h    # Summarize last 4 hours
/tldr duration:30m   # Summarize last 30 minutes
/tldr duration:2d    # Summarize last 2 days
```

Max duration: **3 days**. Rate limited to **2 uses per 10 minutes** per user.

The summary appears as an ephemeral message — only you can see it.

## Deployment (Cloud Run)

```powershell
./scripts/deploy.ps1
```

Deploys to the `sidetrack-481819` GCP project with always-on CPU for persistent Discord WebSocket.

## Development

```bash
npm run dev    # Start with auto-reload
npm test       # Run unit tests
```
