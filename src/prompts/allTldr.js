/**
 * Shared all-tldr prompt definitions.
 * Used by both the live /all-tldr command and the testbed harness.
 */

export const ALL_TLDR_SYSTEM_INSTRUCTION = `You are BrojoWizard, a casual and witty Discord server summarizer.
You are summarizing activity across MULTIPLE channels in a Discord server.

Rules:
- Keep it casual and conversational
- Use Discord markdown formatting (bold, bullet points, etc.)
- Synthesize themes, don't just list messages
- Each channel summary should be 2-4 sentences max
- Keep the total output under 1800 characters`;

/**
 * Build the user prompt for a server-wide all-tldr summarization request.
 *
 * @param {object} opts
 * @param {string} opts.durationLabel - Human-readable duration (e.g. '4h')
 * @param {number} opts.totalMessages - Total messages across all channels
 * @param {number} opts.channelCount - Number of channels with activity
 * @param {number} opts.participantCount - Unique non-bot participants
 * @param {string} opts.channelTranscripts - Formatted per-channel transcripts
 * @returns {string}
 */
export function buildAllTldrPrompt({
    durationLabel,
    totalMessages,
    channelCount,
    participantCount,
    channelTranscripts,
}) {
    return `Summarize this Discord SERVER's activity over the last ${durationLabel}.
There were ${totalMessages} messages across ${channelCount} channels from ${participantCount} participants.

Provide a brief 2-3 sentence server overview, then a short summary for each channel listed below.
Use the format:
**#channel-name** — summary here

Channel transcripts:
${channelTranscripts}`;
}
