import { describe, it, expect } from 'vitest';
import { stripReasoning, extractJSON, parseLabelledFields } from '../sanitize.js';
import { parseToolCalls } from '../tool-parse.js';

describe('stripReasoning', () => {
  it('removes complete think blocks', () => {
    expect(stripReasoning('<think>hmm</think>hello')).toBe('hello');
  });

  it('removes thought/reasoning variants', () => {
    expect(stripReasoning('<thought>x</thought>answer')).toBe('answer');
    expect(stripReasoning('<reasoning>long</reasoning>final')).toBe('final');
  });

  it('returns empty for truncated reasoning (open tag, no close)', () => {
    expect(stripReasoning('<think>still thinking...')).toBe('');
  });

  it('keeps content after a lone closing tag', () => {
    expect(stripReasoning('leftover</think>real answer')).toBe('real answer');
  });

  it('leaves plain text untouched', () => {
    expect(stripReasoning('  just text  ')).toBe('just text');
  });

  it('handles null/undefined', () => {
    expect(stripReasoning(null)).toBe('');
    expect(stripReasoning(undefined)).toBe('');
  });
});

describe('extractJSON', () => {
  it('parses clean JSON', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts fenced JSON', () => {
    expect(extractJSON('```json\n{"tool":"x"}\n```')).toEqual({ tool: 'x' });
  });

  it('strips reasoning before parsing', () => {
    expect(extractJSON('<think>...</think>{"action":"allow"}')).toEqual({ action: 'allow' });
  });

  it('extracts outer object from prose', () => {
    expect(extractJSON('here you go {"a": 2} bye')).toEqual({ a: 2 });
  });

  it('supports arrays', () => {
    expect(extractJSON('[1,2]')).toEqual([1, 2]);
  });

  it('returns null for malformed input', () => {
    expect(extractJSON('not json at all')).toBeNull();
    expect(extractJSON('')).toBeNull();
  });
});

describe('parseLabelledFields', () => {
  it('parses KEY: value lines case-insensitively', () => {
    expect(parseLabelledFields('ACTION: delete\nCONFIDENCE: 0.8', ['action', 'confidence'])).toEqual({
      action: 'delete',
      confidence: '0.8',
    });
  });

  it('ignores unknown keys', () => {
    expect(parseLabelledFields('ACTION: allow\nFOO: bar', ['action'])).toEqual({ action: 'allow' });
  });

  it('returns null when nothing matches', () => {
    expect(parseLabelledFields('hello world', ['action'])).toBeNull();
  });
});

describe('parseToolCalls', () => {
  const known = ['list_commands', 'run_command', 'get_context'];

  it('parses TOOL: {...} lines', () => {
    const out = parseToolCalls('TOOL: {"name":"list_commands","arguments":{"query":"weather"}}', known);
    expect(out.via).toBe('tool-line');
    expect(out.calls).toEqual([{ name: 'list_commands', args: { query: 'weather' } }]);
  });

  it('parses tagged calls', () => {
    const out = parseToolCalls(
      '<tool_call>{"name": "get_context", "arguments": {}}</tool_call>',
      known,
    );
    expect(out.via).toBe('tagged');
    expect(out.calls[0]?.name).toBe('get_context');
  });

  it('parses function tags', () => {
    const out = parseToolCalls('<function=list_commands>{"query":"x"}</function>', known);
    expect(out.via).toBe('function-tag');
    expect(out.calls[0]).toEqual({ name: 'list_commands', args: { query: 'x' } });
  });

  it('parses ReAct action blocks', () => {
    const out = parseToolCalls('Action: run_command\nAction Input: {"command":"ping"}', known);
    expect(out.via).toBe('react');
    expect(out.calls[0]).toEqual({ name: 'run_command', args: { command: 'ping' } });
  });

  it('parses call syntax for known tools', () => {
    const out = parseToolCalls('list_commands({"query": "w"})', known);
    expect(out.via).toBe('call-syntax');
    expect(out.calls[0]?.name).toBe('list_commands');
  });

  it('refuses call syntax for unknown names', () => {
    const out = parseToolCalls('delete_everything({"x": 1})', known);
    expect(out.calls).toEqual([]);
  });

  it('parses loose JSON with alias keys', () => {
    const out = parseToolCalls('{"tool":"run_command","args":{"command":"ping"}}', known);
    expect(out.via).toBe('loose-json');
    expect(out.calls[0]).toEqual({ name: 'run_command', args: { command: 'ping' } });
  });

  it('accepts bare tool names only', () => {
    expect(parseToolCalls('list_commands', known).via).toBe('bare-name');
    expect(parseToolCalls('I like list_commands a lot', known).calls).toEqual([]);
  });

  it('never fires on ordinary user JSON', () => {
    const out = parseToolCalls('{"city":"Manila","temp":30}', known);
    expect(out.calls).toEqual([]);
    expect(out.cleaned).toContain('Manila');
  });

  it('handles empty input', () => {
    expect(parseToolCalls('', known)).toEqual({ calls: [], cleaned: '', via: null });
  });
});
