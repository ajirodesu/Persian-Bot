import { describe, expect, it } from 'vitest';
import {
  buildNeedleTools,
  helpToolSchema,
  sendResultToolSchema,
  testCommandToolSchema,
} from '../lib/tool-schema.lib.js';

describe('tool-schema', () => {
  it('builds exactly the three workflow tools', () => {
    const tools = buildNeedleTools(['ping', 'help']);
    expect(tools.map((t) => t.name)).toEqual([
      'help',
      'test_command',
      'send_result',
    ]);
  });

  it('binds the live catalogue as the command enum', () => {
    const schema = testCommandToolSchema(['ping', 'warn']);
    const props = schema.parameters['properties'] as Record<string, unknown>;
    const commands = props['commands'] as Record<string, unknown>;
    const items = commands['items'] as Record<string, unknown>;
    const itemProps = items['properties'] as Record<string, unknown>;
    const command = itemProps['command'] as Record<string, unknown>;
    expect(command['enum']).toEqual(['ping', 'warn']);
    expect(schema.parameters['required']).toEqual(['commands']);
  });

  it('falls back to string constraints when the catalogue is empty', () => {
    const schema = testCommandToolSchema([]);
    const props = schema.parameters['properties'] as Record<string, unknown>;
    const commands = props['commands'] as Record<string, unknown>;
    const items = commands['items'] as Record<string, unknown>;
    const itemProps = items['properties'] as Record<string, unknown>;
    const command = itemProps['command'] as Record<string, unknown>;
    expect(command['enum']).toBeUndefined();
    expect(command['minLength']).toBe(1);
  });

  it('requires message on send_result', () => {
    expect(sendResultToolSchema().parameters['required']).toEqual(['message']);
  });

  it('produces valid JSON Schema shapes (round-trips through JSON)', () => {
    for (const tool of [helpToolSchema(), testCommandToolSchema(['a']), sendResultToolSchema()]) {
      const revived = JSON.parse(JSON.stringify(tool)) as Record<string, unknown>;
      expect(revived['name']).toBe(tool.name);
      expect(
        (revived['parameters'] as Record<string, unknown>)['type'],
      ).toBe('object');
    }
  });
});
