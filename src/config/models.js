/**
 * Shared model configuration.
 * Single source of truth for model selection — used by both the live bot and testbed.
 *
 * Each command has its own fallback chain. First model that succeeds wins.
 */

/** Model fallback chain for /tldr (single-channel summaries). */
export const TLDR_MODELS = [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-lite',
];

/** Model fallback chain for /all-tldr (server-wide summaries). */
export const ALL_TLDR_MODELS = [
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-lite',
];
