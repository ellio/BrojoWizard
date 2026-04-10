/**
 * Per-user rate limiter — sliding window, 2 uses per 10 minutes.
 */

const MAX_USES = 2;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** @type {Map<string, number[]>} userId → array of timestamps */
const userTimestamps = new Map();

/**
 * Check if a user is rate-limited. If not, records the usage.
 * @param {string} userId
 * @returns {{ allowed: boolean, retryAfterMs?: number }}
 */
export function checkRateLimit(userId) {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Get existing timestamps, prune expired ones
    let timestamps = userTimestamps.get(userId) || [];
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= MAX_USES) {
        // Blocked — calculate when earliest usage expires
        const oldestInWindow = timestamps[0];
        const retryAfterMs = oldestInWindow + WINDOW_MS - now;
        userTimestamps.set(userId, timestamps);
        return { allowed: false, retryAfterMs };
    }

    // Allowed — record this usage
    timestamps.push(now);
    userTimestamps.set(userId, timestamps);
    return { allowed: true };
}

/**
 * Clean up stale entries. Call periodically to prevent memory leaks.
 */
export function cleanupRateLimits() {
    const windowStart = Date.now() - WINDOW_MS;
    for (const [userId, timestamps] of userTimestamps) {
        const active = timestamps.filter(t => t > windowStart);
        if (active.length === 0) {
            userTimestamps.delete(userId);
        } else {
            userTimestamps.set(userId, active);
        }
    }
}
