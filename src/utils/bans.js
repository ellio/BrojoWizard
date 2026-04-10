/**
 * User ban system — time-limited bans from using bot commands.
 * Seeded from BANNED_USERS env var, with runtime add/remove via commands.
 * Format: "userId:isoExpiry,userId:isoExpiry"
 *
 * Note: Runtime bans are in-memory and reset on redeploy.
 * Persistent bans should be added to the BANNED_USERS env var.
 */

/** @type {Map<string, Date>} "guildId:userId" → expiry Date */
const bans = new Map();

// Seed from env var on startup
for (const entry of (process.env.BANNED_USERS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) continue;
    const userId = entry.slice(0, colonIdx).trim();
    const expiry = entry.slice(colonIdx + 1).trim();
    if (userId && expiry) {
        const date = new Date(expiry);
        if (!isNaN(date.getTime())) bans.set(userId, date);
    }
}

/**
 * Check if a user is currently banned in a specific server.
 * @param {string} guildId
 * @param {string} userId
 * @returns {{ banned: boolean, expiresAt?: Date, remainingLabel?: string }}
 */
export function checkBan(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const expiry = bans.get(key);
    if (!expiry) return { banned: false };

    const now = new Date();
    if (now >= expiry) {
        bans.delete(key); // auto-cleanup expired bans
        return { banned: false };
    }

    return { banned: true, expiresAt: expiry, remainingLabel: formatRemaining(expiry - now) };
}

/**
 * Ban a user in a specific server for a specified duration.
 * @param {string} guildId
 * @param {string} userId
 * @param {number} durationMs
 * @returns {{ expiresAt: Date, label: string }}
 */
export function addBan(guildId, userId, durationMs) {
    const key = `${guildId}:${userId}`;
    const expiresAt = new Date(Date.now() + durationMs);
    bans.set(key, expiresAt);
    return { expiresAt, label: formatRemaining(durationMs) };
}

/**
 * Remove a ban for a user in a specific server.
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean} true if they were banned
 */
export function removeBan(guildId, userId) {
    return bans.delete(`${guildId}:${userId}`);
}

/**
 * Parse a ban duration string (e.g. "30m", "12h", "3d", "7d").
 * No upper limit for bans.
 * @param {string} input
 * @returns {{ ms: number, label: string } | { error: string }}
 */
export function parseBanDuration(input) {
    if (!input) return { error: 'Duration is required.' };
    const match = input.trim().match(/^(\d+)\s*([mhd])$/i);
    if (!match) return { error: 'Invalid format. Use e.g. `30m`, `12h`, `3d`, `7d`.' };

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const multipliers = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    const labels = { m: 'minute', h: 'hour', d: 'day' };

    return {
        ms: value * multipliers[unit],
        label: `${value} ${labels[unit]}${value !== 1 ? 's' : ''}`,
    };
}

/**
 * Format a millisecond duration into a human-readable label.
 * @param {number} diffMs
 * @returns {string}
 */
function formatRemaining(diffMs) {
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.ceil((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return `${days}d ${remHours}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}
