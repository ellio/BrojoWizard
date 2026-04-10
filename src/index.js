/**
 * BrojoWizard — Discord TLDR summarizer bot.
 * Main entry point.
 */

import { Client, GatewayIntentBits, Events } from 'discord.js';
import 'dotenv/config';
import { handleTldr } from './commands/tldr.js';
import { cleanupRateLimits } from './utils/rateLimiter.js';

// ── Validate config ───────────────────────────────────────────────────────────
const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'GEMINI_API_KEY'];
for (const key of required) {
    if (!process.env[key]) {
        console.error(`❌ Missing required environment variable: ${key}`);
        console.error('   Fill in your .env file and try again.');
        process.exit(1);
    }
}

// ── Create Discord client ─────────────────────────────────────────────────────
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
    console.log(`✅ BrojoWizard is online as ${c.user.tag}`);
    console.log(`   Serving ${c.guilds.cache.size} server(s)`);
});

// ── Interaction handler ───────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'tldr') {
        await handleTldr(interaction);
    }
});

// ── Periodic cleanup of rate limiter (every 15 min) ───────────────────────────
setInterval(cleanupRateLimits, 15 * 60 * 1000);

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down BrojoWizard...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    client.destroy();
    process.exit(0);
});
