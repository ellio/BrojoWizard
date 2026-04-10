/**
 * Duration parser — converts shorthand strings like '4h', '3d' into a cutoff Date.
 * Maximum allowed duration: 3 days.
 */

const UNITS = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};

const MAX_MS = 3 * UNITS.d; // 3 days

/**
 * Parse a duration string and return a cutoff Date.
 * @param {string} input — e.g. '30m', '4h', '3d'
 * @returns {{ cutoff: Date, label: string } | { error: string }}
 */
export function parseDuration(input) {
    if (!input || typeof input !== 'string') {
        return { error: 'Duration is required. Examples: `30m`, `4h`, `2d`' };
    }

    const cleaned = input.trim().toLowerCase();
    const match = cleaned.match(/^(\d+)\s*(m|h|d)$/);

    if (!match) {
        return { error: `Invalid duration \`${input}\`. Use a number + unit: \`30m\`, \`4h\`, \`2d\`` };
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (value <= 0) {
        return { error: 'Duration must be greater than zero.' };
    }

    const ms = value * UNITS[unit];

    if (ms > MAX_MS) {
        return { error: `Duration too long. Maximum is **3 days** (\`3d\`). You requested \`${input}\`.` };
    }

    const cutoff = new Date(Date.now() - ms);
    const label = `${value}${unit}`;

    return { cutoff, label };
}
