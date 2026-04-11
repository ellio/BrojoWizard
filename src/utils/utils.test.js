/**
 * Unit tests for BrojoWizard utilities.
 * Run: npm test (or: node --test src/utils/*.test.js)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from './duration.js';
import { checkRateLimit } from './rateLimiter.js';

// ── Duration Parser ───────────────────────────────────────────────────────────

describe('parseDuration', () => {
    it('parses minutes', () => {
        const result = parseDuration('30m');
        assert.ok(result.cutoff instanceof Date);
        assert.equal(result.label, '30m');

        const expectedMs = 30 * 60 * 1000;
        const actualMs = Date.now() - result.cutoff.getTime();
        // Allow 100ms tolerance for execution time
        assert.ok(Math.abs(actualMs - expectedMs) < 100, `Cutoff drift: ${Math.abs(actualMs - expectedMs)}ms`);
    });

    it('parses hours', () => {
        const result = parseDuration('4h');
        assert.ok(result.cutoff instanceof Date);
        assert.equal(result.label, '4h');
    });

    it('parses days', () => {
        const result = parseDuration('2d');
        assert.ok(result.cutoff instanceof Date);
        assert.equal(result.label, '2d');
    });

    it('accepts max 3 days', () => {
        const result = parseDuration('3d');
        assert.ok(result.cutoff instanceof Date);
    });

    it('rejects durations over 3 days (default max)', () => {
        const result = parseDuration('4d');
        assert.ok(result.error);
        assert.ok(result.error.includes('3d'));
    });

    it('rejects invalid format', () => {
        assert.ok(parseDuration('abc').error);
        assert.ok(parseDuration('').error);
        assert.ok(parseDuration('10x').error);
        assert.ok(parseDuration('0h').error);
    });

    it('handles whitespace', () => {
        const result = parseDuration('  4h  ');
        assert.ok(result.cutoff instanceof Date);
    });

    it('is case insensitive', () => {
        const result = parseDuration('4H');
        assert.ok(result.cutoff instanceof Date);
    });

    it('rejects null/undefined', () => {
        assert.ok(parseDuration(null).error);
        assert.ok(parseDuration(undefined).error);
    });
});

// ── Rate Limiter ──────────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
    it('allows first two uses', () => {
        const userId = `test-user-${Date.now()}`;
        const first = checkRateLimit(userId);
        assert.equal(first.allowed, true);

        const second = checkRateLimit(userId);
        assert.equal(second.allowed, true);
    });

    it('blocks third use within window', () => {
        const userId = `test-user-block-${Date.now()}`;
        checkRateLimit(userId);
        checkRateLimit(userId);

        const third = checkRateLimit(userId);
        assert.equal(third.allowed, false);
        assert.ok(third.retryAfterMs > 0);
    });

    it('different users are independent', () => {
        const userA = `user-a-${Date.now()}`;
        const userB = `user-b-${Date.now()}`;

        checkRateLimit(userA);
        checkRateLimit(userA);

        // User B should still be allowed
        const result = checkRateLimit(userB);
        assert.equal(result.allowed, true);
    });
});
