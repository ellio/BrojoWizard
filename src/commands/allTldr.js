/**
 * /all-tldr slash command — Server-wide summary across all channels.
 */

import { ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { parseDuration, MAX_1W } from '../utils/duration.js';
import { fetchMessagesSince, findTopReactedMessage, getTopReactedMessages, getHiddenGemCandidates, getParticipants, formatForPrompt, suppressEmbeds } from '../utils/messages.js';
import { ALL_TLDR_SYSTEM_INSTRUCTION, buildAllTldrPrompt } from '../prompts/allTldr.js';
import { ALL_TLDR_MODELS } from '../config/models.js';
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
    const parsed = parseDuration(durationInput, MAX_1W);

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

        // ── Find fan favorites from top 3 channels ──────────────────────────
        const topChannelFavs = ranked
            .slice(0, 3)
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

        // ── Wizard's Favorite & Hidden Gem candidates (across all server messages) ──
        const allMessages = ranked.flatMap(ch => ch.messages);

        // Build exclusion set: global fan fav + all channel highlight messages
        const featuredMessages = new Set();
        if (globalFanFav) featuredMessages.add(globalFanFav);
        for (const fav of topChannelFavs) featuredMessages.add(fav.message);

        let wizardCandidatesContext = '';
        if (allMessages.length >= 50) {
            const topReacted = getTopReactedMessages(allMessages, 10, featuredMessages);
            if (topReacted.length > 0) {
                const formatted = topReacted.map((r, i) => {
                    const author = r.message.member?.displayName || r.message.author.displayName || r.message.author.username;
                    return `${i + 1}. [${r.maxSingle} max, ${r.cumulative} total reacts] ${author}: "${r.message.content?.slice(0, 120) || '[attachment]'}" — Link: ${r.message.url}`;
                }).join('\n');
                wizardCandidatesContext = `\n\nWIZARD'S FAVORITE CANDIDATES (pick the funniest one — these are the top-reacted messages server-wide, excluding the fan favorite):\n${formatted}`;
            }
        }

        let hiddenGemContext = '';
        const gemCandidates = getHiddenGemCandidates(allMessages)
            .filter(msg => !featuredMessages.has(msg));
        if (gemCandidates.length >= 3) {
            const formatted = gemCandidates.map((msg, i) => {
                const author = msg.member?.displayName || msg.author.displayName || msg.author.username;
                const reacts = msg.reactions.cache.size > 0
                    ? msg.reactions.cache.map(r => `${r.emoji.name}×${r.count}`).join(',')
                    : 'none';
                return `${i + 1}. [reacts: ${reacts}] ${author}: "${msg.content?.slice(0, 120)}" — Link: ${msg.url}`;
            }).join('\n');
            hiddenGemContext = `\n\nHIDDEN GEM CANDIDATES (pick the funniest underrated message with 0-1 reactions from across the server):\n${formatted}`;
        }

        const userPrompt = buildAllTldrPrompt({
            durationLabel: parsed.label,
            totalMessages,
            channelCount: channelData.size,
            participantCount: totalParticipants.size,
            channelTranscripts,
            wizardCandidatesContext,
            hiddenGemContext,
        });

        // ── Call Gemini ──────────────────────────────────────────────────────
        const { text: summary, model: modelUsed, isFallback, tokens } = await generateWithFallback(
            userPrompt, ALL_TLDR_SYSTEM_INSTRUCTION, 'all-tldr', ALL_TLDR_MODELS
        );
        const fallbackNote = isFallback ? FALLBACK_NOTE : '';
        const tsp = ((tokens.input / 1000) * 0.40 / 4.93).toFixed(1);
        const waterNote = `\n*💧 This request used ${tsp} teaspoons of water*`;
        lap(`gemini responded via ${modelUsed} (${summary.length} chars)`);

        // ── Build response ───────────────────────────────────────────────────
        const lines = [];
        lines.push(`🧙 **Server-wide TLDR** for the last **${parsed.label}**\n`);

        // Global fan favorite
        if (globalFanFav) {
            const author = globalFanFav.member?.displayName || globalFanFav.author.displayName || globalFanFav.author.username;
            lines.push(`🏅 **Server Fan Favorite** (${globalCumulative} reactions in #${globalFanFavChannel})`);
            lines.push(`> ${author}: "${suppressEmbeds(globalFanFav.content?.slice(0, 100) || '[attachment]')}" — [jump to message](${globalFanFav.url})\n`);
        }

        // Top channel fan favorites
        for (const fav of topChannelFavs) {
            const author = fav.message.member?.displayName || fav.message.author.displayName || fav.message.author.username;
            lines.push(`⭐ **#${fav.channel} Highlight** (${fav.reactions} reactions)`);
            lines.push(`> ${author}: "${suppressEmbeds(fav.message.content?.slice(0, 80) || '[attachment]')}" — [jump](${fav.message.url})\n`);
        }

        // Channel activity overview
        lines.push(`📊 **${totalMessages} messages** across **${channelData.size} channels** from **${totalParticipants.size} people**`);
        const topList = ranked.slice(0, 5).map(ch => `#${ch.name} (${ch.messages.length})`).join(', ');
        lines.push(`Most active: ${topList}\n`);

        // AI summary
        lines.push(suppressEmbeds(summary));
        lines.push(fallbackNote);
        lines.push(waterNote);

        const fullResponse = lines.join('\n');

        // ── Send ephemeral preview with approve button ───────────────────
        const approveButton = new ButtonBuilder()
            .setCustomId('all-tldr-approve')
            .setLabel('📢 Post to Channel')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(approveButton);

        // Discord 2000 char limit — split if needed
        if (fullResponse.length <= 1900) {
            await interaction.editReply({ content: fullResponse, components: [row] });
        } else {
            // Send first chunk as reply with button, rest as followups
            await interaction.editReply({
                content: fullResponse.slice(0, 1900) + '\n\n*...continued below*',
                components: [row],
            });
            const remaining = fullResponse.slice(1900);
            for (let i = 0; i < remaining.length; i += 1900) {
                await interaction.followUp({
                    content: remaining.slice(i, i + 1900),
                    flags: 64,
                });
            }
        }

        // ── Wait for button click (5 min timeout) ────────────────────────
        try {
            const reply = await interaction.fetchReply();
            const buttonInteraction = await reply.awaitMessageComponent({
                componentType: ComponentType.Button,
                filter: (i) => i.customId === 'all-tldr-approve' && i.user.id === interaction.user.id,
                time: 5 * 60 * 1000,
            });

            // Post publicly to the channel
            const requester = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
            const publicHeader = `🧙 **${requester}** requested a server-wide summary of the last **${parsed.label}**\n\n`;
            const publicResponse = publicHeader + fullResponse;

            if (publicResponse.length <= 1900) {
                await interaction.channel.send(publicResponse);
            } else {
                await interaction.channel.send(publicResponse.slice(0, 1900) + '\n\n*...continued below*');
                const remaining = publicResponse.slice(1900);
                for (let i = 0; i < remaining.length; i += 1900) {
                    await interaction.channel.send(remaining.slice(i, i + 1900));
                }
            }

            // Disable the button after use
            approveButton.setDisabled(true).setLabel('✅ Posted');
            await buttonInteraction.update({ components: [row] });
            lap('posted to channel');

        } catch {
            // Timeout — disable the button
            approveButton.setDisabled(true).setLabel('⏰ Expired');
            await interaction.editReply({ components: [row] }).catch(() => {});
            lap('button expired');
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
