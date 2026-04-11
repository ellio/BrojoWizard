# BrojoWizard Test Bed 🧪

Offline prompt-engineering workbench for iterating on BrojoWizard's summarization prompts without touching Discord infrastructure.

## How It Works

The test bed shares the same prompt definitions and model config as the live bot:

```
src/prompts/tldr.js          ← shared system instruction + prompt builder
src/prompts/allTldr.js       ← shared system instruction + prompt builder
src/config/models.js         ← shared model preference list
```

Both `src/commands/tldr.js` (live bot) and `testbed/run.js` import from these files. **Edit a prompt once, it applies everywhere.**

## Quick Start

### 1. Capture fixtures from a real Discord channel

Right-click a channel → **Copy Channel ID** (Developer Mode must be on).

```bash
# Small (1 message — edge case)
node testbed/capture.js --channel <CHANNEL_ID> --count 1 --out small

# Medium (50 messages — typical /tldr 1h)
node testbed/capture.js --channel <CHANNEL_ID> --count 50 --out medium

# Large (200 messages — busy day)
node testbed/capture.js --channel <CHANNEL_ID> --count 200 --out large
```

The bot must have `Read Message History` permission in that channel. Fixtures are saved to `testbed/fixtures/<name>.json`.

### 2. Dry-run (inspect prompt without calling Gemini)

```bash
node testbed/run.js --fixture medium --command tldr --dry-run
```

Prints the system instruction and assembled user prompt to the console. No API call, no API key needed.

### 3. Full run (call Gemini, write output)

```bash
node testbed/run.js --fixture medium --command tldr
```

Calls Gemini with the default model fallback chain and writes a timestamped markdown report to `testbed/output/`.

### 4. Run all fixtures

```bash
node testbed/run.js --all
```

### 5. Test with a specific model

```bash
node testbed/run.js --fixture medium --command tldr --model gemini-2.5-flash-lite
```

## npm Scripts

| Script | Command |
|--------|---------|
| `npm run testbed -- --fixture medium --command tldr` | Run a single fixture |
| `npm run testbed:dry -- --fixture medium` | Dry-run a fixture |
| `npm run testbed:all` | Run all fixtures |
| `npm run testbed:capture -- --channel <ID> --count 50 --out medium` | Capture from Discord |

## Output Format

Each run produces a markdown file in `testbed/output/`:

```
testbed/output/tldr_medium_2026-04-10T18-50-00.md
```

Contains:
- System instruction (full text)
- User prompt (full text)
- Gemini response
- Token usage + water consumption

Compare outputs across prompt iterations by diffing two `.md` files.

## Files

| File | Purpose |
|------|---------|
| `capture.js` | One-shot Discord fetch → fixture JSON |
| `run.js` | CLI harness: fixture → analysis → prompt → Gemini → markdown |
| `fixture-utils.js` | Hydrates fixture JSON into Discord.js-compatible message objects |
| `fixtures/` | Captured message data (gitignored) |
| `output/` | Generated test reports (gitignored) |

## Changing Prompts

1. Edit `src/prompts/tldr.js` (or `allTldr.js`)
2. Run `node testbed/run.js --fixture medium --command tldr`
3. Review the output in `testbed/output/`
4. Repeat until satisfied
5. Deploy — the live bot uses the same prompt file, no copy-paste needed

## Changing Models

Edit `src/config/models.js` to change the model preference order. This applies to both the live bot and the test bed.
