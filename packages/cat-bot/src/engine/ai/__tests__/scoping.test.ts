import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildToolContext, isAiInitiatedEvent } from '../service.js';
import { getIntegrationTools, clearIntegrationCache } from '../mcp/integrations.js';

vi.mock('@/engine/repos/mcp-skills.repo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/repos/mcp-skills.repo.js')>();
  return { ...actual, listIntegrationsForUser: vi.fn() };
});

const { listIntegrationsForUser } = await import('@/engine/repos/mcp-skills.repo.js');
const mockList = vi.mocked(listIntegrationsForUser);

function skillRecord(userId: string, name: string) {
  return {
    id: `${userId}-${name}`,
    userId,
    kind: 'skill' as const,
    name,
    config: { mode: 'prompt' as const, instructions: `Skill ${name} of ${userId}.` },
    risk: 0 as const,
    minRole: 0,
    status: 'active' as const,
    dangerReasons: [],
    approvedBy: null,
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearIntegrationCache();
});

describe('bot scoping', () => {
  it('maps the session owner into the tool context', () => {
    const ctx = {
      event: { threadID: 't1', senderID: 'u9', isGroup: true },
      native: { platform: 'fluxer', userId: 'owner-A', sessionId: 'sess-1' },
    } as never;
    const toolCtx = buildToolContext(ctx, { role: 0 });
    expect(toolCtx.userId).toBe('owner-A');
    expect(toolCtx.sessionId).toBe('sess-1');
    expect(toolCtx.aiInitiated).toBe(false);
  });

  it('flags AI-initiated synthetic events', () => {
    expect(isAiInitiatedEvent({ aiInitiated: true })).toBe(true);
    expect(isAiInitiatedEvent({})).toBe(false);
    const ctx = {
      event: { threadID: 't1', senderID: 'u9', aiInitiated: true },
      native: { platform: 'fluxer' },
    } as never;
    expect(buildToolContext(ctx, { role: 0 }).aiInitiated).toBe(true);
  });

  it("one owner's integrations never leak into another owner's bot", async () => {
    mockList.mockImplementation(async (userId: string) => [skillRecord(userId, 'tone')]);
    const a = await getIntegrationTools('owner-A', 0);
    const b = await getIntegrationTools('owner-B', 0);
    expect(a.skillPrompt).toContain('owner-A');
    expect(a.skillPrompt).not.toContain('owner-B');
    expect(b.skillPrompt).toContain('owner-B');
    expect(b.skillPrompt).not.toContain('owner-A');
    expect(mockList).toHaveBeenCalledWith('owner-A');
    expect(mockList).toHaveBeenCalledWith('owner-B');
  });

  it('role gating still applies per turn', async () => {
    mockList.mockResolvedValueOnce([
      { ...skillRecord('owner-A', 'tone'), minRole: 3 },
    ]);
    const low = await getIntegrationTools('owner-A', 0);
    expect(low.skillPrompt).toBeNull();
    expect(low.tools).toHaveLength(0);
  });
});
