/**
 * Message fetching, ranking, and prompt formatting utilities.
 */

import { SnowflakeUtil } from 'discord.js';

const MAX_MESSAGES = 3000; // Safety cap to avoid runaway fetching
const BATCH_SIZE = 100;    // Discord API max per request

/**
 * Fetch all messages in a channel since a cutoff date, paginated.
 * @param {import('discord.js').TextChannel} channel
 * @param {Date} cutoffDate
 * @returns {Promise<import('discord.js').Message[]>}
 */
export async function fetchMessagesSince(channel, cutoffDate) {
    const cutoffSnowflake = SnowflakeUtil.generate({ timestamp: cutoffDate.getTime() }).toString();
    const allMessages = [];
    let lastId = cutoffSnowflake;

    while (allMessages.length < MAX_MESSAGES) {
        const batch = await channel.messages.fetch({
            limit: BATCH_SIZE,
            after: lastId,
        });

        if (batch.size === 0) break;

        // batch is sorted newest-first by discord.js, so get the newest ID for next page
        const sorted = [...batch.values()].sort((a, b) => {
            // Compare snowflake IDs numerically (bigger = newer)
            return a.createdTimestamp - b.createdTimestamp;
        });

        allMessages.push(...sorted);
        lastId = sorted[sorted.length - 1].id;

        // If we got fewer than a full batch, we've reached the end
        if (batch.size < BATCH_SIZE) break;
    }

    // Filter to only messages within our time window (safety check)
    return allMessages
        .filter(m => m.createdTimestamp >= cutoffDate.getTime())
        .slice(0, MAX_MESSAGES);
}

/**
 * Rank messages by highest single reaction count, tiebroken by cumulative total.
 * e.g. a message with (4)(1) beats (1)(1)(1)(1)(1)(1)(1) because 4 > 1.
 * @param {import('discord.js').Message[]} messages
 * @returns {{ topMessage: import('discord.js').Message | null, totalReactions: number }}
 */
export function findTopReactedMessage(messages) {
    if (messages.length === 0) return { topMessage: null, totalReactions: 0 };

    let topMessage = null;
    let topMaxSingle = 0;  // highest individual reaction count
    let topCumulative = 0; // tiebreaker: total reactions

    for (const msg of messages) {
        const reactions = msg.reactions.cache;
        if (reactions.size === 0) continue;

        const maxSingle = reactions.reduce((max, r) => Math.max(max, r.count), 0);
        const cumulative = reactions.reduce((sum, r) => sum + r.count, 0);

        if (maxSingle > topMaxSingle || (maxSingle === topMaxSingle && cumulative > topCumulative)) {
            topMaxSingle = maxSingle;
            topCumulative = cumulative;
            topMessage = msg;
        }
    }

    return { topMessage, totalReactions: topCumulative };
}

/**
 * Score a message for reaction ranking.
 * Primary: highest single reaction count. Tiebreaker: cumulative total.
 * @param {import('discord.js').Message} msg
 * @returns {{ maxSingle: number, cumulative: number }}
 */
function reactionScore(msg) {
    const reactions = msg.reactions.cache;
    if (reactions.size === 0) return { maxSingle: 0, cumulative: 0 };
    return {
        maxSingle: reactions.reduce((max, r) => Math.max(max, r.count), 0),
        cumulative: reactions.reduce((sum, r) => sum + r.count, 0),
    };
}

/**
 * Get top N reacted messages, sorted by reaction score (excluding specific messages).
 * @param {import('discord.js').Message[]} messages
 * @param {number} n
 * @param {Set<import('discord.js').Message> | import('discord.js').Message | null} exclude - message(s) to exclude
 * @returns {Array<{ message: import('discord.js').Message, maxSingle: number, cumulative: number }>}
 */
export function getTopReactedMessages(messages, n, exclude = null) {
    const excludeSet = exclude instanceof Set ? exclude
        : exclude ? new Set([exclude])
        : new Set();
    return messages
        .filter(msg => msg.reactions.cache.size > 0 && !excludeSet.has(msg) && !msg.author.bot)
        .map(msg => ({ message: msg, ...reactionScore(msg) }))
        .sort((a, b) => b.maxSingle - a.maxSingle || b.cumulative - a.cumulative)
        .slice(0, n);
}

/**
 * Get messages with 0-1 total reactions (hidden gem candidates).
 * Returns non-bot messages with actual text content, randomly sampled.
 * @param {import('discord.js').Message[]} messages
 * @param {number} maxCandidates - max to return
 * @returns {import('discord.js').Message[]}
 */
export function getHiddenGemCandidates(messages, maxCandidates = 15) {
    const candidates = messages.filter(msg => {
        if (msg.author.bot) return false;
        if (!msg.content || msg.content.length < 10) return false;
        const total = msg.reactions.cache.reduce((sum, r) => sum + r.count, 0);
        return total <= 1;
    });
    // Shuffle and take a sample so Gemini sees variety, not just chronological
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, maxCandidates);
}

/**
 * Get unique participants and their message counts.
 * @param {import('discord.js').Message[]} messages
 * @returns {Map<string, { displayName: string, count: number }>}
 */
export function getParticipants(messages) {
    const participants = new Map();

    for (const msg of messages) {
        if (msg.author.bot) continue;

        const existing = participants.get(msg.author.id);
        if (existing) {
            existing.count++;
        } else {
            participants.set(msg.author.id, {
                displayName: msg.member?.displayName || msg.author.displayName || msg.author.username,
                count: 1,
            });
        }
    }

    return participants;
}

/**
 * Format messages into a text block suitable for LLM summarization.
 * @param {import('discord.js').Message[]} messages
 * @returns {string}
 */
export function formatForPrompt(messages) {
    const lines = [];

    for (const msg of messages) {
        if (msg.author.bot) continue;
        if (!msg.content && msg.attachments.size === 0) continue;

        const name = msg.member?.displayName || msg.author.displayName || msg.author.username;
        const time = msg.createdAt.toISOString().slice(0, 16).replace('T', ' ');
        const reactions = msg.reactions.cache.size > 0
            ? ` [${msg.reactions.cache.map(r => `${r.emoji.name}×${r.count}`).join(', ')}]`
            : '';

        let content = msg.content || '';
        if (msg.attachments.size > 0) {
            content += ` [${msg.attachments.size} attachment(s)]`;
        }

        lines.push(`[${time}] ${name}: ${content}${reactions}`);
    }

    return lines.join('\n');
}
