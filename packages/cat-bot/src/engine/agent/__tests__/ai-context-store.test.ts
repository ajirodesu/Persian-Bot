import { describe, expect, it } from 'vitest';
import {
  createAiContext,
  destroyAiContext,
  validateAiContext,
} from '../lib/ai-context-store.lib.js';

const coords = {
  userId: 'owner1',
  platform: 'fluxer',
  sessionId: 'sess1',
  threadId: 'thread1',
  senderId: 'user1',
  messageId: 'msg1',
};

describe('ai-context-store', () => {
  it('creates a record with an opaque id and TTL bounds', () => {
    const rec = createAiContext(coords);
    expect(rec.id).toBeTruthy();
    expect(rec.expiresAt).toBeGreaterThan(rec.createdAt);
    expect(validateAiContext(rec.id, coords)).toEqual(rec);
    destroyAiContext(rec.id);
  });

  it('rejects unknown ids', () => {
    expect(validateAiContext('does-not-exist', coords)).toBeUndefined();
  });

  it('rejects cross-user reuse', () => {
    const rec = createAiContext(coords);
    expect(
      validateAiContext(rec.id, { ...coords, senderId: 'attacker' }),
    ).toBeUndefined();
    destroyAiContext(rec.id);
  });

  it('rejects cross-session reuse', () => {
    const rec = createAiContext(coords);
    expect(
      validateAiContext(rec.id, { ...coords, sessionId: 'other-session' }),
    ).toBeUndefined();
    destroyAiContext(rec.id);
  });

  it('rejects cross-thread reuse', () => {
    const rec = createAiContext(coords);
    expect(
      validateAiContext(rec.id, { ...coords, threadId: 'other-thread' }),
    ).toBeUndefined();
    destroyAiContext(rec.id);
  });

  it('rejects cross-platform reuse', () => {
    const rec = createAiContext(coords);
    expect(
      validateAiContext(rec.id, { ...coords, platform: 'telegram' }),
    ).toBeUndefined();
    destroyAiContext(rec.id);
  });

  it('destroy removes the handle', () => {
    const rec = createAiContext(coords);
    destroyAiContext(rec.id);
    expect(validateAiContext(rec.id, coords)).toBeUndefined();
  });
});
