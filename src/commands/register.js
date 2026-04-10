/**
 * Register slash commands globally.
 * Run once (or when command definitions change): npm run register
 */

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import 'dotenv/config';

const commands = [
    new SlashCommandBuilder()
        .setName('tldr')
        .setDescription('Get a casual AI summary of recent channel conversation')
        .addStringOption(option =>
            option
                .setName('duration')
                .setDescription('How far back to look — e.g. 30m, 4h, 2d (max 3d)')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('all-tldr')
        .setDescription('Get a server-wide AI summary across all channels')
        .addStringOption(option =>
            option
                .setName('duration')
                .setDescription('How far back to look — e.g. 30m, 4h, 2d (max 3d)')
                .setRequired(true)
        ),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

async function registerCommands() {
    try {
        console.log('🔄 Registering slash commands globally...');

        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands.map(c => c.toJSON()) },
        );

        console.log(`✅ Registered ${data.length} command(s) globally.`);
        console.log('   Note: Global commands can take up to 1 hour to propagate to all servers.');
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
        process.exit(1);
    }
}

registerCommands();
