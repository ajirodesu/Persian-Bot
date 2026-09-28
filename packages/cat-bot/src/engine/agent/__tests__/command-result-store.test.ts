import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  BUFFER_SENTINEL,
  STREAM_SENTINEL,
  commandResultStore,
  normalizeToJson,
} from '../lib/command-result-store.lib.js';

describe('normalizeToJson', () => {
  it('passes primitives through', () => {
    expect(normalizeToJson('hi')).toBe('hi');
    expect(normalizeToJson(42)).toBe(42);
    expect(normalizeToJson(true)).toBe(true);
    expect(normalizeToJson(null)).toBe(null);
  });

  it('converts bigint to string', () => {
    expect(normalizeToJson(10n)).toBe('10');
  });

  it('replaces Buffer with sentinel', () => {
    expect(normalizeToJson(Buffer.from('x'))).toBe(BUFFER_SENTINEL);
  });

  it('replaces Readable streams with sentinel', () => {
    const stream = Readable.from(['x']);
    expect(normalizeToJson(stream)).toBe(STREAM_SENTINEL);
  });

  it('normalizes nested arrays and objects', () => {
    expect(
      normalizeToJson({ a: [1n, Buffer.from('b')], nested: { s: 'v' } }),
    ).toEqual({ a: ['1', BUFFER_SENTINEL], nested: { s: 'v' } });
  });
});

describe('commandResultStore', () => {
  it('stores and retrieves calls under a generated key', () => {
    const key = commandResultStore.generateKey('u', 'fluxer', 's', 't', 'm', 'ping');
    expect(typeof key).toBe('string');
    commandResultStore.set(key, [{ type: 'replyMessage', args: ['t', {}] }]);
    const calls = commandResultStore.get(key);
    expect(calls).toHaveLength(1);
    expect(calls?.[0]?.type).toBe('replyMessage');
  });

  it('generates unique keys', () => {
    const a = commandResultStore.generateKey('u', 'fluxer', 's', 't', 'm', 'ping');
    const b = commandResultStore.generateKey('u', 'fluxer', 's', 't', 'm', 'ping');
    expect(a).not.toBe(b);
  });

  it('stores attachments, buttons, and binaries keyed off the base key', () => {
    const key = commandResultStore.generateKey('u', 'fluxer', 's', 't', 'm', 'dog');
    const aKey = `${key}:a`;
    const bKey = `${key}:b`;
    const binKey = `${key}:bin`;
    commandResultStore.setAttachments(aKey, [{ name: 'dog.png', url: 'https://x/dog.png' }]);
    commandResultStore.setButtons(bKey, [[[{ id: 'ping:refresh', label: 'x' }]]]);
    commandResultStore.setBinaryAttachments(binKey, [
      { name: 'cat.png', stream: Buffer.from('img') },
    ]);
    expect(commandResultStore.getAttachments(aKey)).toHaveLength(1);
    expect(commandResultStore.getButtons(bKey)).toHaveLength(1);
    expect(commandResultStore.getBinaryAttachments(binKey)).toHaveLength(1);
  });

  it('deletes single-use keys', () => {
    const key = commandResultStore.generateKey('u', 'fluxer', 's', 't', 'm', 'x');
    commandResultStore.set(key, []);
    commandResultStore.delete(key);
    expect(commandResultStore.get(key)).toBeUndefined();
  });

  it('returns undefined for unknown keys (expired/consumed)', () => {
    expect(commandResultStore.get('nope:1')).toBeUndefined();
    expect(commandResultStore.getAttachments('nope:1:a')).toBeUndefined();
    expect(commandResultStore.getButtons('nope:1:b')).toBeUndefined();
    expect(commandResultStore.getBinaryAttachments('nope:1:bin')).toBeUndefined();
  });
});
