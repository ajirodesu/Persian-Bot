import { describe, it, expect } from 'vitest';
import { validateIntegrationInput } from '../mcp/validate.js';

describe('validateIntegrationInput', () => {
  it('accepts a clean MCP server', () => {
    const r = validateIntegrationInput({
      kind: 'mcp',
      name: 'docs',
      config: { url: 'https://docs.example.com/mcp', headers: { Authorization: 'Bearer x' } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe('mcp');
      expect(r.value.name).toBe('docs');
    }
  });

  it('accepts webhook and prompt skills', () => {
    expect(
      validateIntegrationInput({
        kind: 'skill',
        name: 't',
        config: { mode: 'tool', url: 'https://api.example.com/t' },
      }).ok,
    ).toBe(true);
    const prompt = validateIntegrationInput({
      kind: 'skill',
      name: 'p',
      config: { mode: 'prompt', instructions: 'Be concise.' },
    });
    expect(prompt.ok).toBe(true);
  });

  it('rejects bad kinds, names, and URLs', () => {
    expect(validateIntegrationInput({ kind: 'evil', name: 'x', config: {} }).ok).toBe(false);
    expect(validateIntegrationInput({ kind: 'mcp', name: '', config: { url: 'https://x.example' } }).ok).toBe(false);
    expect(
      validateIntegrationInput({ kind: 'mcp', name: 'x', config: { url: 'file:///etc/passwd' } }).ok,
    ).toBe(false);
    expect(
      validateIntegrationInput({ kind: 'mcp', name: 'x', config: { url: 'not a url' } }).ok,
    ).toBe(false);
    expect(
      validateIntegrationInput({ kind: 'skill', name: 'x', config: { mode: 'prompt' } }).ok,
    ).toBe(false);
  });

  it('caps headers, timeouts, and instructions', () => {
    const r = validateIntegrationInput({
      kind: 'mcp',
      name: 'x',
      config: {
        url: 'https://x.example/mcp',
        timeoutMs: 99999999,
        headers: { a: 'b' },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.config && 'timeoutMs' in r.value.config) {
      expect(r.value.config.timeoutMs).toBe(60_000);
    }
    expect(
      validateIntegrationInput({
        kind: 'skill',
        name: 'x',
        config: { mode: 'prompt', instructions: 'x'.repeat(5000) },
      }).ok,
    ).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateIntegrationInput(null).ok).toBe(false);
    expect(validateIntegrationInput('mcp').ok).toBe(false);
    expect(validateIntegrationInput([]).ok).toBe(false);
  });
});
