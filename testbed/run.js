/**
 * BrojoWizard Test Bed — CLI harness for offline prompt evaluation.
 *
 * Usage:
 *   node testbed/run.js --fixture <NAME> --command tldr [--duration 4h] [--dry-run] [--model <MODEL>]
 *   node testbed/run.js --all [--dry-run]
 *
 * Examples:
 *   node testbed/run.js --fixture medium --command tldr --duration 4h
 *   node testbed/run.js --fixture medium --command tldr --dry-run
 *   node testbed/run.js --fixture large --command tldr --model gemini-2.5-flash-lite
 *   node testbed/run.js --all
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import 'dotenv/config';

import { loadFixture, loadFixtureMeta, listFixtures } from './fixture-utils.js';
import { findTopReactedMessage, getTopReactedMessages, getHiddenGemCandidates, getParticipants, formatForPrompt } from '../src/utils/messages.js';
import { TLDR_SYSTEM_INSTRUCTION, buildTldrPrompt } from '../src/prompts/tldr.js';
import { ALL_TLDR_SYSTEM_INSTRUCTION, buildAllTldrPrompt } from '../src/prompts/allTldr.js';

// ── Parse CLI args ───────────────────────────────────────────────────────────
const { values: args } = parseArgs({
    options: {
        fixture:  { type: 'string', short: 'f' },
        command:  { type: 'string', short: 'c', default: 'tldr' },
        duration: { type: 'string', short: 'd', default: '4h' },
        model:    { type: 'string', short: 'm' },
        'dry-run': { type: 'boolean', default: false },
        all:      { type: 'boolean', default: false },
    },
});

const isDryRun = args['dry-run'];

// ── Main ─────────────────────────────────────────────────────────────────────

if (args.all) {
    await runAll();
} else if (args.fixture) {
    await runSingle(args.fixture, args.command, args.duration);
} else {
    console.error('Usage: node testbed/run.js --fixture <NAME> --command tldr [options]');
    console.error('       node testbed/run.js --all [--dry-run]');
    console.error('\nAvailable fixtures:');
    const fixtures = await listFixtures();
    for (const f of fixtures) console.error(`  - ${f}`);
    process.exit(1);
}

// ── Run all fixtures ─────────────────────────────────────────────────────────

async function runAll() {
    const fixtures = await listFixtures();
    if (fixtures.length === 0) {
        console.error('❌ No fixtures found in testbed/fixtures/. Run capture.js first.');
        process.exit(1);
    }

    console.log(`🧪 Running ${fixtures.length} fixture(s)...\n`);

    for (const fixture of fixtures) {
        console.log(`═══════════════════════════════════════════════════`);
        await runSingle(fixture, 'tldr', args.duration);
        console.log();
    }

    console.log(`✅ All ${fixtures.length} fixture(s) complete.`);
}

// ── Run a single fixture ─────────────────────────────────────────────────────

async function runSingle(fixtureName, command, durationLabel) {
    const t0 = Date.now();
    console.log(`🧪 Loading fixture: ${fixtureName}`);

    const messages = await loadFixture(fixtureName);
    const meta = await loadFixtureMeta(fixtureName);
    console.log(`   ${messages.length} messages loaded (${meta.channelName || 'unknown channel'})`);

    let systemInstruction;
    let userPrompt;

    if (command === 'tldr') {
        const result = buildTldrPayload(messages, durationLabel);
        systemInstruction = TLDR_SYSTEM_INSTRUCTION;
        userPrompt = result.userPrompt;
    } else if (command === 'all-tldr') {
        const result = buildAllTldrPayload(messages, durationLabel, meta);
        systemInstruction = ALL_TLDR_SYSTEM_INSTRUCTION;
        userPrompt = result.userPrompt;
    } else {
        console.error(`❌ Unknown command: ${command}. Use 'tldr' or 'all-tldr'.`);
        process.exit(1);
    }

    // ── Dry run: print prompt and exit ───────────────────────────────────────
    if (isDryRun) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📝 SYSTEM INSTRUCTION:`);
        console.log(`${'─'.repeat(60)}`);
        console.log(systemInstruction);
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📝 USER PROMPT (${userPrompt.length} chars):`);
        console.log(`${'─'.repeat(60)}`);
        console.log(userPrompt);
        console.log(`${'─'.repeat(60)}`);
        return;
    }

    // ── Call Gemini ──────────────────────────────────────────────────────────
    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY not found in .env (required for live runs).');
        console.error('   Use --dry-run to see prompt output without calling Gemini.');
        process.exit(1);
    }

    // Dynamic import so dry-run doesn't require the API key
    const { generateWithFallback } = await import('../src/utils/gemini.js');

    const modelOverride = args.model;
    console.log(`🤖 Calling Gemini${modelOverride ? ` (model: ${modelOverride})` : ''}...`);

    let result;
    if (modelOverride) {
        // Direct call with specific model
        const { GoogleGenAI } = await import('@google/genai');
        const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const genResult = await genai.models.generateContent({
            model: modelOverride,
            contents: userPrompt,
            config: { systemInstruction },
        });
        const usage = genResult.usageMetadata || {};
        result = {
            text: genResult.text,
            model: modelOverride,
            isFallback: false,
            tokens: {
                input: usage.promptTokenCount ?? 0,
                output: usage.candidatesTokenCount ?? 0,
                total: usage.totalTokenCount ?? 0,
            },
        };
    } else {
        result = await generateWithFallback(userPrompt, systemInstruction, 'testbed');
    }

    const elapsed = Date.now() - t0;
    console.log(`✅ Response in ${elapsed}ms via ${result.model} (${result.text.length} chars)`);

    // ── Write output ────────────────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputDir = join(process.cwd(), 'testbed', 'output');
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${command}_${fixtureName}_${timestamp}.md`);

    const tsp = ((result.tokens.input / 1000) * 0.40 / 4.93).toFixed(2);

    const markdown = `# Test Run: ${command} / ${fixtureName}
**Date:** ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
**Model:** ${result.model}${result.isFallback ? ' (fallback)' : ''}
**Fixture:** ${messages.length} messages${meta.channelName ? `, #${meta.channelName}` : ''}
**Duration label:** ${durationLabel}
**Elapsed:** ${elapsed}ms

## System Instruction

> ${systemInstruction.replace(/\n/g, '\n> ')}

## User Prompt

> ${userPrompt.replace(/\n/g, '\n> ')}

## Gemini Output

${result.text}

## Token Usage
- **Input:** ${result.tokens.input.toLocaleString()}
- **Output:** ${result.tokens.output.toLocaleString()}
- **Total:** ${result.tokens.total.toLocaleString()}
- **Water:** ${tsp} tsp
`;

    await writeFile(outputPath, markdown);
    console.log(`📄 Output saved: ${outputPath}`);
}

// ── Prompt Building ──────────────────────────────────────────────────────────

/**
 * Build the TLDR prompt payload from fixture messages.
 * Mirrors the logic in src/commands/tldr.js.
 */
function buildTldrPayload(messages, durationLabel) {
    const { topMessage, totalReactions } = findTopReactedMessage(messages);
    const participants = getParticipants(messages);
    const conversationText = formatForPrompt(messages);

    // Top message context
    let topMessageContext = 'No messages had reactions.';
    if (topMessage && totalReactions > 0) {
        const topAuthor = topMessage.member?.displayName || topMessage.author.displayName || topMessage.author.username;
        topMessageContext = `Top-reacted message (${totalReactions} reactions) by ${topAuthor}: "${topMessage.content}"\nLink: ${topMessage.url}`;
    }

    // Wizard's Favorite candidates (needs ≥50 msgs)
    let wizardCandidatesContext = '';
    if (messages.length >= 50) {
        const topReacted = getTopReactedMessages(messages, 10, topMessage);
        if (topReacted.length > 0) {
            const formatted = topReacted.map((r, i) => {
                const author = r.message.member?.displayName || r.message.author.displayName || r.message.author.username;
                return `${i + 1}. [${r.maxSingle} max, ${r.cumulative} total reacts] ${author}: "${r.message.content?.slice(0, 120) || '[attachment]'}" — Link: ${r.message.url}`;
            }).join('\n');
            wizardCandidatesContext = `\n\nWIZARD'S FAVORITE CANDIDATES (pick the funniest one — these are the top-reacted messages, excluding the fan favorite):\n${formatted}`;
        }
    }

    // Hidden Gem candidates
    let hiddenGemContext = '';
    const gemCandidates = getHiddenGemCandidates(messages);
    if (gemCandidates.length >= 3) {
        const formatted = gemCandidates.map((msg, i) => {
            const author = msg.member?.displayName || msg.author.displayName || msg.author.username;
            const reacts = msg.reactions.cache.size > 0
                ? msg.reactions.cache.map(r => `${r.emoji.name}×${r.count}`).join(',')
                : 'none';
            return `${i + 1}. [reacts: ${reacts}] ${author}: "${msg.content?.slice(0, 120)}" — Link: ${msg.url}`;
        }).join('\n');
        hiddenGemContext = `\n\nHIDDEN GEM CANDIDATES (pick the funniest underrated message with 0-1 reactions):\n${formatted}`;
    }

    const userPrompt = buildTldrPrompt({
        durationLabel,
        messageCount: messages.length,
        participantCount: participants.size,
        topMessageContext,
        wizardCandidatesContext,
        hiddenGemContext,
        conversationText,
    });

    return { userPrompt, participants };
}

/**
 * Build the all-tldr prompt payload from fixture messages.
 * Treats the fixture as a single channel for now.
 */
function buildAllTldrPayload(messages, durationLabel, meta) {
    const channelName = meta.channelName || 'general';
    const participants = getParticipants(messages);
    const transcript = formatForPrompt(messages);
    const trimmed = transcript.length > 3000
        ? transcript.slice(0, 3000) + '\n[...truncated]'
        : transcript;
    const channelTranscripts = `\n--- #${channelName} (${messages.length} messages) ---\n${trimmed}\n`;

    const userPrompt = buildAllTldrPrompt({
        durationLabel,
        totalMessages: messages.length,
        channelCount: 1,
        participantCount: participants.size,
        channelTranscripts,
    });

    return { userPrompt, participants };
}
