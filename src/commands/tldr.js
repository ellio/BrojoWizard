/**
 * /tldr slash command — Summarize recent channel conversation using Gemini.
 */

import { GoogleGenAI } from '@google/genai';
import { parseDuration } from '../utils/duration.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { fetchMessagesSince, findTopReactedMessage, getParticipants, formatForPrompt } from '../utils/messages.js';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Owner IDs exempt from rate limiting (comma-separated in env)
const OWNER_IDS = new Set(
    (process.env.OWNER_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
);

const SYSTEM_INSTRUCTION = `You are BrojoWizard, a casual and witty Discord conversation summarizer. 
Your job is to read a conversation transcript and produce a concise TLDR summary.

Rules:
- Keep it casual and conversational, like you're catching up a friend
- Be concise but capture the important stuff
- Use Discord markdown formatting (bold, bullet points, etc.)
- When a "top message" link is provided, reference it naturally in your summary
- Call out key participants by name and what they were talking about
- If there were disagreements or debates, mention both sides briefly
- Don't just list every message — synthesize the themes and highlights
- Keep the total summary under 1500 characters so it fits nicely in Discord

Output format (use these exact headers):
📋 **TLDR**
A 2-4 sentence overview of what went down.

🏅 **Fan Favorite**
Reference the top-reacted message naturally with the provided link.

👥 **Key Players**
Bullet points of who was active and what they were on about.

📊 **By The Numbers**
Message count, participant count, time span — keep it one line.`;

/**
 * Handle the /tldr interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleTldr(interaction) {
    const t0 = Date.now();
    const lap = (label) => {
        const elapsed = Date.now() - t0;
        console.log(`[tldr] ${label} — ${elapsed}ms total`);
    };

    // ── Rate limit check (owners exempt) ─────────────────────────────────────
    const isOwner = OWNER_IDS.has(interaction.user.id);
    const { allowed, retryAfterMs } = isOwner
        ? { allowed: true }
        : checkRateLimit(interaction.user.id);
    if (!allowed) {
        const retryMin = Math.ceil(retryAfterMs / 60000);
        await interaction.reply({
            content: `⏳ Slow down! You can use \`/tldr\` **2 times every 10 minutes**. Try again in ~${retryMin} min.`,
            ephemeral: true,
        });
        return;
    }

    // ── Parse duration ────────────────────────────────────────────────────────
    const durationInput = interaction.options.getString('duration');
    const parsed = parseDuration(durationInput);

    if (parsed.error) {
        await interaction.reply({ content: `❌ ${parsed.error}`, ephemeral: true });
        return;
    }

    // ── Defer (this might take a while) ───────────────────────────────────────
    await interaction.deferReply({ ephemeral: true });
    lap('deferred');

    try {
        const channel = interaction.channel;

        // ── Fetch messages ────────────────────────────────────────────────────
        const messages = await fetchMessagesSince(channel, parsed.cutoff);
        lap(`fetched ${messages.length} messages`);

        if (messages.length === 0) {
            await interaction.editReply({
                content: `🤷 No messages found in the last **${parsed.label}**. The channel's been quiet!`,
            });
            return;
        }

        // ── Analyze ──────────────────────────────────────────────────────────
        const { topMessage, totalReactions } = findTopReactedMessage(messages);
        const participants = getParticipants(messages);
        const conversationText = formatForPrompt(messages);
        lap(`analyzed (${conversationText.length} chars prompt, ${participants.size} participants)`);

        // ── Build prompt ─────────────────────────────────────────────────────
        let topMessageContext = 'No messages had reactions.';
        if (topMessage && totalReactions > 0) {
            const topAuthor = topMessage.member?.displayName || topMessage.author.displayName || topMessage.author.username;
            topMessageContext = `Top-reacted message (${totalReactions} reactions) by ${topAuthor}: "${topMessage.content}"\nLink: ${topMessage.url}`;
        }

        const userPrompt = `Summarize this Discord conversation from the last ${parsed.label} (${messages.length} messages, ${participants.size} participants).

Top message info:
${topMessageContext}

Conversation transcript:
${conversationText}`;

        // ── Call Gemini ──────────────────────────────────────────────────────
        const result = await genai.models.generateContent({
            model: 'gemini-3.1-flash-lite-preview',
            contents: userPrompt,
            config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                serviceTier: 'standard',
            },
        });
        const summary = result.text;
        lap(`gemini responded (${summary.length} chars)`);

        // ── Send response ────────────────────────────────────────────────────
        // Discord has a 2000 char limit for messages
        const truncated = summary.length > 1900
            ? summary.slice(0, 1900) + '\n\n*...summary truncated*'
            : summary;

        await interaction.editReply({ content: truncated });
        lap('done');

    } catch (error) {
        console.error('[tldr] Error:', error);
        lap('error');

        const errorMsg = error.message?.includes('API key')
            ? '🔑 Gemini API key issue. Check your configuration.'
            : '💥 Something went wrong generating the summary. Try again in a moment.';

        await interaction.editReply({ content: errorMsg }).catch(() => {});
    }
}
