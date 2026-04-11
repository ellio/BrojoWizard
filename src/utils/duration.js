/**
 * Duration parser — converts shorthand strings like '4h', '3d', '1w' into a cutoff Date.
 * Default maximum: 3 days (configurable via maxMs parameter).
 */

const UNITS = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
};

export const MAX_3D = 3 * UNITS.d;
export const MAX_1W = 1 * UNITS.w;

/**
 * Parse a duration string and return a cutoff Date.
 * @param {string} input — e.g. '30m', '4h', '3d', '1w'
 * @param {number} [maxMs=MAX_3D] — maximum allowed duration in ms
 * @returns {{ cutoff: Date, label: string } | { error: string }}
 */
export function parseDuration(input, maxMs = MAX_3D) {
    if (!input || typeof input !== 'string') {
        return { error: 'Duration is required. Examples: `30m`, `4h`, `2d`' };
    }

    const cleaned = input.trim().toLowerCase();
    const match = cleaned.match(/^(\d+)\s*(m|h|d|w)$/);

    if (!match) {
        return { error: `Invalid duration \`${input}\`. Use a number + unit: \`30m\`, \`4h\`, \`2d\`, \`1w\`` };
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (value <= 0) {
        return { error: 'Duration must be greater than zero.' };
    }

    const ms = value * UNITS[unit];

    if (ms > maxMs) {
        const maxLabel = maxMs >= UNITS.w ? `${maxMs / UNITS.w}w`
            : maxMs >= UNITS.d ? `${maxMs / UNITS.d}d`
            : `${maxMs / UNITS.h}h`;
        return { error: `Duration too long. Maximum is **${maxLabel}**. You requested \`${input}\`.` };
    }

    const cutoff = new Date(Date.now() - ms);
    const label = `${value}${unit}`;

    return { cutoff, label };
}
