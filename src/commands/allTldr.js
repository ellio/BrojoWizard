/**
 * /all-tldr slash command — Server-wide summary across all channels.
 */

import { ChannelType } from 'discord.js';
import { parseDuration } from '../utils/duration.js';
import { fetchMessagesSince, findTopReactedMessage, getParticipants, formatForPrompt } from '../utils/messages.js';
import { ALL_TLDR_SYSTEM_INSTRUCTION, buildAllTldrPrompt } from '../prompts/allTldr.js';
import { generateWithFallback, FALLBACK_NOTE } from '../utils/gemini.js';

// Owner IDs exempt from rate limiting (comma-separated in env)
const OWNER_IDS = new Set(
    (process.env.OWNER_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
);



const MAX_SUMMARY_CHANNELS = 5;
const MIN_MESSAGES_FOR_SUMMARY = 30;

/**
 * Handle the /all-tldr interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleAllTldr(interaction) {
    const t0 = Date.now();
    const lap = (label) => {
        const elapsed = Date.now() - t0;
        console.log(`[all-tldr] ${label} — ${elapsed}ms total`);
    };

    // ── Owner-only for now ────────────────────────────────────────────────────
    const isOwner = OWNER_IDS.has(interaction.user.id);
    if (!isOwner) {
        await interaction.reply({
            content: '🔒 `/all-tldr` is currently in testing — only bot owners can use it for now.',
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

    // ── Defer (ephemeral while testing) ──────────────────────────────────────
    await interaction.deferReply({ flags: 64 }); // 64 = ephemeral
    lap('deferred');

    try {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('❌ This command only works in a server.');
            return;
        }

        // ── Fetch messages from all text channels ────────────────────────────
        const textChannels = guild.channels.cache.filter(
            ch => ch.type === ChannelType.GuildText && ch.viewable
        );

        /** @type {Map<string, { name: string, messages: any[], fanFavorite: any }>} */
        const channelData = new Map();

        for (const [, channel] of textChannels) {
            try {
                const msgs = await fetchMessagesSince(channel, parsed.cutoff);
                if (msgs.length === 0) continue;

                const { topMessage, totalReactions } = findTopReactedMessage(msgs);
                channelData.set(channel.id, {
                    name: channel.name,
                    messages: msgs,
                    fanFavorite: topMessage ? { message: topMessage, reactions: totalReactions } : null,
                });
            } catch (err) {
                // Bot might not have permission in some channels — skip silently
                console.log(`[all-tldr] Skipped #${channel.name}: ${err.message?.slice(0, 60)}`);
            }
        }

        lap(`fetched from ${channelData.size}/${textChannels.size} channels`);

        if (channelData.size === 0) {
            await interaction.editReply(`🤷 No messages found across the server in the last **${parsed.label}**.`);
            return;
        }

        // ── Rank channels by message count ───────────────────────────────────
        const ranked = [...channelData.entries()]
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => b.messages.length - a.messages.length);

        const totalMessages = ranked.reduce((sum, ch) => sum + ch.messages.length, 0);
        const totalParticipants = new Set();
        for (const ch of ranked) {
            for (const msg of ch.messages) {
                if (!msg.author.bot) totalParticipants.add(msg.author.id);
            }
        }

        // ── Find global fan favorite ─────────────────────────────────────────
        let globalFanFav = null;
        let globalFanFavChannel = null;
        let globalMaxSingle = 0;
        let globalCumulative = 0;

        for (const ch of ranked) {
            if (!ch.fanFavorite) continue;
            const msg = ch.fanFavorite.message;
            const reactions = msg.reactions.cache;
            const maxSingle = reactions.reduce((max, r) => Math.max(max, r.count), 0);
            const cumulative = reactions.reduce((sum, r) => sum + r.count, 0);

            if (maxSingle > globalMaxSingle || (maxSingle === globalMaxSingle && cumulative > globalCumulative)) {
                globalMaxSingle = maxSingle;
                globalCumulative = cumulative;
                globalFanFav = msg;
                globalFanFavChannel = ch.name;
            }
        }

        // ── Find fan favorites from top 2 channels ──────────────────────────
        const topChannelFavs = ranked
            .slice(0, 2)
            .filter(ch => ch.fanFavorite && ch.fanFavorite.message !== globalFanFav)
            .map(ch => ({
                channel: ch.name,
                message: ch.fanFavorite.message,
                reactions: ch.fanFavorite.reactions,
            }));

        // ── Channels eligible for summary (30+ msgs, top 5) ─────────────────
        const summaryChannels = ranked
            .filter(ch => ch.messages.length >= MIN_MESSAGES_FOR_SUMMARY)
            .slice(0, MAX_SUMMARY_CHANNELS);

        lap(`analyzing ${summaryChannels.length} channels for summary`);

        // ── Build prompt ─────────────────────────────────────────────────────
        let channelTranscripts = '';
        for (const ch of summaryChannels) {
            const transcript = formatForPrompt(ch.messages);
            // Cap per-channel prompt to ~3000 chars to stay within limits
            const trimmed = transcript.length > 3000
                ? transcript.slice(0, 3000) + '\n[...truncated]'
                : transcript;
            channelTranscripts += `\n--- #${ch.name} (${ch.messages.length} messages) ---\n${trimmed}\n`;
        }

        const userPrompt = buildAllTldrPrompt({
            durationLabel: parsed.label,
            totalMessages,
            channelCount: channelData.size,
            participantCount: totalParticipants.size,
            channelTranscripts,
        });

        // ── Call Gemini ──────────────────────────────────────────────────────
        const { text: summary, model: modelUsed, isFallback } = await generateWithFallback(
            userPrompt, ALL_TLDR_SYSTEM_INSTRUCTION, 'all-tldr'
        );
        const fallbackNote = isFallback ? FALLBACK_NOTE : '';
        lap(`gemini responded via ${modelUsed} (${summary.length} chars)`);

        // ── Build response ───────────────────────────────────────────────────
        const lines = [];
        lines.push(`🧙 **Server-wide TLDR** for the last **${parsed.label}**\n`);

        // Global fan favorite
        if (globalFanFav) {
            const author = globalFanFav.member?.displayName || globalFanFav.author.displayName || globalFanFav.author.username;
            lines.push(`🏅 **Server Fan Favorite** (${globalCumulative} reactions in #${globalFanFavChannel})`);
            lines.push(`> ${author}: "${globalFanFav.content?.slice(0, 100) || '[attachment]'}" — [jump to message](${globalFanFav.url})\n`);
        }

        // Top channel fan favorites
        for (const fav of topChannelFavs) {
            const author = fav.message.member?.displayName || fav.message.author.displayName || fav.message.author.username;
            lines.push(`⭐ **#${fav.channel} Highlight** (${fav.reactions} reactions)`);
            lines.push(`> ${author}: "${fav.message.content?.slice(0, 80) || '[attachment]'}" — [jump](${fav.message.url})\n`);
        }

        // Channel activity overview
        lines.push(`📊 **${totalMessages} messages** across **${channelData.size} channels** from **${totalParticipants.size} people**`);
        const topList = ranked.slice(0, 5).map(ch => `#${ch.name} (${ch.messages.length})`).join(', ');
        lines.push(`Most active: ${topList}\n`);

        // AI summary
        lines.push(summary);
        lines.push(fallbackNote);

        const fullResponse = lines.join('\n');

        // Discord 2000 char limit — split if needed
        if (fullResponse.length <= 1900) {
            await interaction.editReply(fullResponse);
        } else {
            // Send first chunk as reply, rest as followups
            await interaction.editReply(fullResponse.slice(0, 1900) + '\n\n*...continued below*');
            const remaining = fullResponse.slice(1900);
            for (let i = 0; i < remaining.length; i += 1900) {
                await interaction.followUp({
                    content: remaining.slice(i, i + 1900),
                    flags: 64,
                });
            }
        }
        lap('done');

    } catch (error) {
        console.error('[all-tldr] Error:', error);
        lap('error');

        const errorMsg = error.message?.includes('API key')
            ? '🔑 Gemini API key issue. Check your configuration.'
            : '💥 Something went wrong generating the server summary. Try again in a moment.';

        await interaction.editReply(errorMsg).catch(() => {});
    }
}
