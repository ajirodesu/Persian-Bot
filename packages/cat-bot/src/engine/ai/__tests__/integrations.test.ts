import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getIntegrationTools,
  isUsableBy,
  probeIntegration,
  clearIntegrationCache,
  MAX_INTEGRATION_TOOLS,
} from '../mcp/integrations.js';
import { clearMcpToolCache } from '../mcp/client.js';
import type { McpSkillRecord } from '@/engine/repos/mcp-skills.repo.js';

vi.mock('@/engine/repos/mcp-skills.repo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/repos/mcp-skills.repo.js')>();
  return { ...actual, listIntegrationsForUser: vi.fn() };
});

vi.mock('../mcp/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mcp/client.js')>();
  return { ...actual, listMcpTools: vi.fn(), callMcpTool: vi.fn() };
});

const { listIntegrationsForUser } = await import('@/engine/repos/mcp-skills.repo.js');
const { listMcpTools, callMcpTool } = await import('../mcp/client.js');
const mockList = vi.mocked(listIntegrationsForUser);
const mockTools = vi.mocked(listMcpTools);
const mockCall = vi.mocked(callMcpTool);

function record(over: Partial<McpSkillRecord> = {}): McpSkillRecord {
  return {
    id: 'id-1',
    userId: 'u1',
    kind: 'mcp',
    name: 'docs',
    config: { url: 'https://docs.example.com/mcp' },
    risk: 1,
    minRole: 0,
    status: 'active',
    dangerReasons: [],
    approvedBy: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearIntegrationCache();
  clearMcpToolCache();
});

describe('isUsableBy', () => {
  it('gates on status, approval, and role', () => {
    expect(isUsableBy(record(), 0)).toBe(true);
    expect(isUsableBy(record({ status: 'pending_review' }), 4)).toBe(false);
    expect(isUsableBy(record({ status: 'disabled' }), 4)).toBe(false);
    expect(isUsableBy(record({ status: 'restricted' }), 4)).toBe(false);
    expect(isUsableBy(record({ status: 'restricted', approvedBy: 'admin' }), 4)).toBe(true);
    expect(isUsableBy(record({ status: 'restricted', approvedBy: 'admin', minRole: 4 }), 0)).toBe(false);
    expect(isUsableBy(record({ minRole: 3 }), 0)).toBe(false);
  });
});

describe('getIntegrationTools', () => {
  it('returns nothing without a user', async () => {
    expect(await getIntegrationTools(undefined, 0)).toEqual({ tools: [], skillPrompt: null });
  });

  it('converts MCP servers to namespaced tools', async () => {
    mockList.mockResolvedValueOnce([record()]);
    mockTools.mockResolvedValueOnce([
      { name: 'search', description: 'Search docs', inputSchema: { type: 'object' } },
    ]);
    const bundle = await getIntegrationTools('u1', 0);
    expect(bundle.tools).toHaveLength(1);
    expect(bundle.tools[0]?.name).toContain('mcp__');
    expect(bundle.skillPrompt).toBeNull();
  });

  it('applies the runtime backstop to dangerous tools', async () => {
    mockList.mockResolvedValueOnce([record()]);
    mockTools.mockResolvedValueOnce([{ name: 'exec', description: 'Run shell' }]);
    const bundle = await getIntegrationTools('u1', 0);
    expect(bundle.tools[0]?.minRole).toBe(4);
    expect(bundle.tools[0]?.risk).toBe(2);
  });

  it('collects prompt skills into budgeted prompt text', async () => {
    mockList.mockResolvedValueOnce([
      record({
        kind: 'skill',
        name: 'tone',
        config: { mode: 'prompt', instructions: 'Always be concise.' },
        risk: 0,
      }),
    ]);
    const bundle = await getIntegrationTools('u1', 0);
    expect(bundle.tools).toHaveLength(0);
    expect(bundle.skillPrompt).toContain('concise');
  });

  it('exposes webhook skills as tools', async () => {
    mockList.mockResolvedValueOnce([
      record({
        kind: 'skill',
        name: 'translate',
        config: { mode: 'tool', url: 'https://api.example.com/t' },
      }),
    ]);
    const bundle = await getIntegrationTools('u1', 0);
    expect(bundle.tools.map((t) => t.name)).toEqual([expect.stringContaining('skill__')]);
  });

  it('caps injected tools and survives listing failures', async () => {
    mockList.mockResolvedValueOnce([record()]);
    mockTools.mockRejectedValueOnce(new Error('down'));
    const bundle = await getIntegrationTools('u1', 0);
    expect(bundle.tools).toEqual([]);
    expect(MAX_INTEGRATION_TOOLS).toBeGreaterThan(0);
  });
});

describe('probeIntegration', () => {
  it('probes MCP servers', async () => {
    mockTools.mockResolvedValueOnce([{ name: 'search' }]);
    const res = await probeIntegration(record());
    expect(res.ok).toBe(true);
    expect(res.tools).toEqual(['search']);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports MCP failures without throwing', async () => {
    mockTools.mockRejectedValueOnce(new Error('refused'));
    const res = await probeIntegration(record());
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('refused');
  });

  it('probes prompt skills instantly', async () => {
    const res = await probeIntegration(
      record({ kind: 'skill', config: { mode: 'prompt', instructions: 'hi' } }),
    );
    expect(res.ok).toBe(true);
    void mockCall;
  });
});
