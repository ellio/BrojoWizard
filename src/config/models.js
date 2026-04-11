/**
 * Shared model configuration.
 * Single source of truth for model selection — used by both the live bot and testbed.
 */

/** Model preference order — first that succeeds wins. */
export const MODELS = [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-lite',
];

/** The primary (preferred) model. */
export const PRIMARY_MODEL = MODELS[0];
