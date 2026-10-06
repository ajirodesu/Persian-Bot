import { describe, it, expect } from 'vitest';
import {
  normalizeToJson,
  previewResultStore,
  STREAM_SENTINEL,
  BUFFER_SENTINEL,
} from '../preview-store.js';
import { Readable } from 'node:stream';

describe('normalizeToJson', () => {
  it('passes through JSON-safe values', () => {
    expect(normalizeToJson({ a: 1, b: 'x', c: null, d: [1, 2] })).toEqual({
      a: 1,
      b: 'x',
      c: null,
      d: [1, 2],
    });
  });

  it('replaces Buffers, streams, and bigints', () => {
    expect(normalizeToJson(Buffer.from('hi'))).toBe(BUFFER_SENTINEL);
    expect(normalizeToJson(Readable.from(['x']))).toBe(STREAM_SENTINEL);
    expect(normalizeToJson(10n)).toBe('10');
  });

  it('recurses into nested structures', () => {
    expect(
      normalizeToJson({ file: { name: 'a.png', stream: Buffer.from('x') } }),
    ).toEqual({ file: { name: 'a.png', stream: BUFFER_SENTINEL } });
  });
});

describe('previewResultStore', () => {
  it('generates short unique keys per prefix', () => {
    const a = previewResultStore.generateKey('u', 'p', 's', 't', 'm', 'pic');
    const b = previewResultStore.generateKey('u', 'p', 's', 't', 'm', 'pic');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9]+:1$/);
    expect(b).toMatch(/^[a-z0-9]+:2$/);
  });

  it('stores, reads, and deletes each payload kind', () => {
    const key = previewResultStore.generateKey('u', 'p', 's', 't', 'm2', 'pic');
    previewResultStore.set(key, [{ type: 'replyMessage', args: [] }]);
    previewResultStore.setAttachments(`${key}:a`, [{ name: 'a.png', url: 'https://x/a.png' }]);
    previewResultStore.setBinaryAttachments(`${key}:bin`, [{ name: 'b', stream: Buffer.from('x') }]);
    previewResultStore.setButtons(`${key}:b`, [[['btn']]]);

    expect(previewResultStore.get(key)).toHaveLength(1);
    expect(previewResultStore.getAttachments(`${key}:a`)).toHaveLength(1);
    expect(previewResultStore.getBinaryAttachments(`${key}:bin`)).toHaveLength(1);
    expect(previewResultStore.getButtons(`${key}:b`)).toHaveLength(1);

    previewResultStore.delete(key);
    previewResultStore.deleteAttachments(`${key}:a`);
    previewResultStore.deleteBinaryAttachments(`${key}:bin`);
    previewResultStore.deleteButtons(`${key}:b`);
    expect(previewResultStore.get(key)).toBeNull();
  });

  it('returns null for missing keys', () => {
    expect(previewResultStore.get('nope:1')).toBeNull();
    expect(previewResultStore.getAttachments('nope:1:a')).toBeNull();
  });
});
