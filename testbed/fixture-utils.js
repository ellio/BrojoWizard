/**
 * Fixture utilities — hydrate raw fixture JSON into objects compatible
 * with the messages.js utility functions.
 *
 * Discord.js Message objects have a specific shape (.reactions.cache,
 * .author.bot, .member.displayName, .createdAt, .url, etc.). This module
 * creates lightweight duck-typed stand-ins so the analysis pipeline works
 * identically offline.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Load a fixture file and hydrate its messages into Discord-like objects.
 *
 * @param {string} fixtureName - Name without extension (e.g. 'medium')
 * @returns {Promise<import('discord.js').Message[]>} Hydrated message-like objects
 */
export async function loadFixture(fixtureName) {
    const fixturePath = join(process.cwd(), 'testbed', 'fixtures', `${fixtureName}.json`);
    const raw = JSON.parse(await readFile(fixturePath, 'utf-8'));
    return raw.messages.map(hydrateMessage);
}

/**
 * Get fixture metadata (if present).
 *
 * @param {string} fixtureName
 * @returns {Promise<object>}
 */
export async function loadFixtureMeta(fixtureName) {
    const fixturePath = join(process.cwd(), 'testbed', 'fixtures', `${fixtureName}.json`);
    const raw = JSON.parse(await readFile(fixturePath, 'utf-8'));
    return raw.meta || {};
}

/**
 * List available fixture names in the fixtures directory.
 *
 * @returns {Promise<string[]>}
 */
export async function listFixtures() {
    const { readdir } = await import('node:fs/promises');
    const fixtureDir = join(process.cwd(), 'testbed', 'fixtures');
    try {
        const files = await readdir(fixtureDir);
        return files
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''));
    } catch {
        return [];
    }
}

/**
 * Hydrate a single raw message object into a Discord.js-compatible shape.
 *
 * The key interfaces we need to satisfy:
 * - msg.author.bot (boolean)
 * - msg.author.id (string)
 * - msg.author.username (string)
 * - msg.author.displayName (string)
 * - msg.member?.displayName (string | undefined)
 * - msg.content (string)
 * - msg.createdAt (Date)
 * - msg.createdTimestamp (number)
 * - msg.id (string)
 * - msg.url (string)
 * - msg.attachments.size (number)
 * - msg.reactions.cache — a Collection-like with .size, .map(), .reduce()
 *   where each entry has .emoji.name and .count
 *
 * @param {object} raw
 * @returns {object}
 */
function hydrateMessage(raw) {
    const createdAt = new Date(raw.createdAt);

    // Build a Collection-like for reactions
    const reactionEntries = (raw.reactions || []).map(r => ({
        emoji: { name: r.emoji },
        count: r.count,
    }));

    const reactionsCache = {
        size: reactionEntries.length,
        map: (fn) => reactionEntries.map(fn),
        reduce: (fn, init) => reactionEntries.reduce(fn, init),
        filter: (fn) => reactionEntries.filter(fn),
        [Symbol.iterator]: function* () { yield* reactionEntries; },
    };

    // Build a Collection-like for attachments
    const attachmentEntries = raw.attachments || [];
    const attachmentsCache = {
        size: attachmentEntries.length,
    };

    return {
        id: raw.id,
        content: raw.content || '',
        createdAt,
        createdTimestamp: createdAt.getTime(),
        url: raw.url || `https://discord.com/channels/fake/fake/${raw.id}`,
        author: {
            id: raw.author?.id || 'unknown',
            username: raw.author?.username || 'unknown',
            displayName: raw.author?.displayName || raw.author?.username || 'unknown',
            bot: raw.author?.bot || false,
        },
        member: raw.member ? {
            displayName: raw.member.displayName,
        } : null,
        attachments: attachmentsCache,
        reactions: {
            cache: reactionsCache,
        },
    };
}
