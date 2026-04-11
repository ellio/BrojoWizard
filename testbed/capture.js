/**
 * Capture real Discord messages and serialize to a fixture JSON file.
 *
 * Usage:
 *   node testbed/capture.js --channel <CHANNEL_ID> --count <N> --out <NAME>
 *
 * Examples:
 *   node testbed/capture.js --channel 1234567890 --count 1 --out small
 *   node testbed/capture.js --channel 1234567890 --count 50 --out medium
 *   node testbed/capture.js --channel 1234567890 --count 200 --out large
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import 'dotenv/config';

// ── Parse CLI args ───────────────────────────────────────────────────────────
const { values: args } = parseArgs({
    options: {
        channel: { type: 'string', short: 'c' },
        count:   { type: 'string', short: 'n', default: '50' },
        out:     { type: 'string', short: 'o' },
    },
});

if (!args.channel || !args.out) {
    console.error('Usage: node testbed/capture.js --channel <ID> --count <N> --out <NAME>');
    console.error('  --channel, -c   Discord channel ID (right-click → Copy Channel ID)');
    console.error('  --count, -n     Number of recent messages to capture (default: 50)');
    console.error('  --out, -o       Fixture name (saved as testbed/fixtures/<NAME>.json)');
    process.exit(1);
}

const channelId = args.channel;
const count = Math.min(parseInt(args.count, 10) || 50, 3000);
const outName = args.out;

if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN not found in .env');
    process.exit(1);
}

// ── Boot a minimal Discord client ────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

console.log(`🔌 Connecting to Discord...`);

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
            console.error(`❌ Channel ${channelId} is not a text channel or not accessible.`);
            process.exit(1);
        }

        console.log(`📥 Fetching up to ${count} messages from #${channel.name}...`);

        // Fetch in batches (Discord API max 100 per request)
        const allMessages = [];
        let lastId = undefined;

        while (allMessages.length < count) {
            const batchSize = Math.min(100, count - allMessages.length);
            const options = { limit: batchSize };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            const sorted = [...batch.values()].sort(
                (a, b) => a.createdTimestamp - b.createdTimestamp
            );

            allMessages.push(...sorted);
            lastId = sorted[0].id; // oldest in this batch (fetch next page before this)

            if (batch.size < batchSize) break;
        }

        // Sort chronologically
        allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        // Take only the most recent `count`
        const messages = allMessages.slice(-count);

        console.log(`📦 Captured ${messages.length} messages. Serializing...`);

        // Serialize to portable JSON
        const serialized = messages.map(serializeMessage);

        const fixture = {
            meta: {
                capturedAt: new Date().toISOString(),
                channelId,
                channelName: channel.name,
                guildName: channel.guild?.name || 'DM',
                messageCount: serialized.length,
                timeRange: {
                    oldest: serialized[0]?.createdAt || null,
                    newest: serialized[serialized.length - 1]?.createdAt || null,
                },
            },
            messages: serialized,
        };

        // Write to fixtures directory
        const fixtureDir = join(process.cwd(), 'testbed', 'fixtures');
        await mkdir(fixtureDir, { recursive: true });
        const outPath = join(fixtureDir, `${outName}.json`);
        await writeFile(outPath, JSON.stringify(fixture, null, 2));

        console.log(`✅ Saved ${serialized.length} messages to ${outPath}`);

    } catch (err) {
        console.error('❌ Capture failed:', err.message);
    } finally {
        client.destroy();
        process.exit(0);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize a Discord.js Message into a portable JSON-safe object.
 * Strips class internals, keeping only the data the test bed needs.
 *
 * @param {import('discord.js').Message} msg
 * @returns {object}
 */
function serializeMessage(msg) {
    return {
        id: msg.id,
        content: msg.content || '',
        createdAt: msg.createdAt.toISOString(),
        url: msg.url,
        author: {
            id: msg.author.id,
            username: msg.author.username,
            displayName: msg.author.displayName || msg.author.username,
            bot: msg.author.bot,
        },
        member: msg.member ? {
            displayName: msg.member.displayName,
        } : null,
        reactions: [...msg.reactions.cache.values()].map(r => ({
            emoji: r.emoji.name,
            count: r.count,
        })),
        attachments: [...msg.attachments.values()].map(a => ({
            name: a.name,
            url: a.url,
            contentType: a.contentType,
        })),
    };
}
