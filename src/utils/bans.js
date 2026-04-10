/**
 * User ban system — time-limited bans from using bot commands.
 * Configured via BANNED_USERS env var: "userId:isoExpiry,userId:isoExpiry"
 */

/**
 * Parse BANNED_USERS env var into a Map of userId → expiry Date.
 * @returns {Map<string, Date>}
 */
function parseBans() {
    const raw = process.env.BANNED_USERS || '';
    const bans = new Map();
    for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean)) {
        const [userId, expiry] = entry.split(':');
        if (userId && expiry) {
            bans.set(userId.trim(), new Date(expiry.trim()));
        }
    }
    return bans;
}

/**
 * Check if a user is currently banned.
 * @param {string} userId
 * @returns {{ banned: boolean, expiresAt?: Date, remainingLabel?: string }}
 */
export function checkBan(userId) {
    const bans = parseBans();
    const expiry = bans.get(userId);
    if (!expiry) return { banned: false };

    const now = new Date();
    if (now >= expiry) return { banned: false }; // ban expired

    // Calculate remaining time
    const diffMs = expiry - now;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.ceil((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    let remainingLabel;
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        remainingLabel = `${days}d ${remHours}h`;
    } else if (hours > 0) {
        remainingLabel = `${hours}h ${minutes}m`;
    } else {
        remainingLabel = `${minutes}m`;
    }

    return { banned: true, expiresAt: expiry, remainingLabel };
}
