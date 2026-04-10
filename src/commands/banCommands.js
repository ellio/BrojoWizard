/**
 * /tldr-ban and /tldr-unban commands — Admin-only user ban management.
 */

import { addBan, removeBan, checkBan, parseBanDuration } from '../utils/bans.js';

/**
 * Handle the /tldr-ban interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleTldrBan(interaction) {
    const target = interaction.options.getUser('user');
    const durationInput = interaction.options.getString('duration');

    const parsed = parseBanDuration(durationInput);
    if (parsed.error) {
        await interaction.reply({ content: `❌ ${parsed.error}`, ephemeral: true });
        return;
    }

    const { expiresAt, label } = addBan(target.id, parsed.ms);
    console.log(`[ban] ${interaction.user.tag} banned ${target.tag} (${target.id}) for ${label} until ${expiresAt.toISOString()}`);

    await interaction.reply({
        content: `🔨 **${target.displayName}** has been banned from using The Brojo Wizard for **${label}**.`,
    });
}

/**
 * Handle the /tldr-unban interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleTldrUnban(interaction) {
    const target = interaction.options.getUser('user');

    const { banned } = checkBan(target.id);
    if (!banned) {
        await interaction.reply({
            content: `ℹ️ **${target.displayName}** is not currently banned.`,
            ephemeral: true,
        });
        return;
    }

    removeBan(target.id);
    console.log(`[unban] ${interaction.user.tag} unbanned ${target.tag} (${target.id})`);

    await interaction.reply({
        content: `✅ **${target.displayName}** has been unbanned and can use The Brojo Wizard again.`,
    });
}
