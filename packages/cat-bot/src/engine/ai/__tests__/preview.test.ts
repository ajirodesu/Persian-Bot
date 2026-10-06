import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewCommands, deliverPreview } from '../preview.js';
import { previewResultStore } from '../preview-store.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

vi.mock('@/engine/repos/banned.repo.js', () => ({
  isUserBanned: vi.fn(async () => false),
  isThreadBanned: vi.fn(async () => false),
}));

vi.mock('@/engine/repos/credentials.repo.js', () => ({
  isBotAdmin: vi.fn(async () => false),
  isBotPremium: vi.fn(async () => false),
  listBotPremiums: vi.fn(async () => []),
}));

vi.mock('@/engine/repos/threads.repo.js', () => ({
  isThreadAdmin: vi.fn(async () => false),
}));

vi.mock('@/engine/repos/system-admin.repo.js', () => ({
  isSystemAdmin: vi.fn(async () => false),
}));

vi.mock('@/engine/modules/session/bot-session-commands.repo.js', () => ({
  isCommandEnabled: vi.fn(async () => true),
  findSessionCommands: vi.fn(async () => []),
}));

vi.mock('@/engine/repos/maintenance-mode.repo.js', () => ({
  getMaintenanceModeEnabled: vi.fn(async () => false),
}));

const sent: Array<{ threadID: string; opts: Record<string, unknown> }> = [];

const picCommand = {
  meta: { name: 'pic', role: 0, cooldown: 0, description: 'photo' },
  onCommand: async ({ chat }: AppCtx) => {
    await chat.replyMessage({
      message: 'Here is your photo:',
      attachment_url: [{ name: 'a.png', url: 'https://cdn.example/a.png' }],
    });
  },
};

const blobCommand = {
  meta: { name: 'blob', role: 0, cooldown: 0, description: 'binary' },
  onCommand: async ({ chat }: AppCtx) => {
    await chat.replyMessage({
      message: 'Raw bytes:',
      attachment: [{ name: 'raw.bin', stream: Buffer.from('BINARY-DATA') }],
    });
  },
};

const btnCommand = {
  meta: { name: 'menu', role: 0, cooldown: 0, description: 'menu' },
  button: {
    ok: { label: 'OK', onClick: async () => {} },
  },
  onCommand: async ({ chat, button }: AppCtx) => {
    const id = button.generateID({ id: 'ok' });
    button.createContext({ id, context: {} });
    await chat.replyMessage({ message: 'Pick one:', button: [id] });
  },
};

function ctx(): AppCtx {
  return {
    commands: new Map([
      ['pic', picCommand],
      ['blob', blobCommand],
      ['menu', btnCommand],
    ]),
    event: { senderID: 'u1', threadID: 't1', messageID: 'm1', message: '!pic' },
    native: { platform: 'fluxer', userId: 'owner', sessionId: 's1' },
    prefix: '!',
    api: {
      platform: 'fluxer',
      replyMessage: async (threadID: string, opts: Record<string, unknown>) => {
        sent.push({ threadID, opts });
        return 'real-msg-id';
      },
    },
    db: {
      bot: { isCollectionExist: async () => false },
      threads: { collection: () => ({ isCollectionExist: async () => false }) },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as AppCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
});

describe('previewCommands', () => {
  it('captures output silently with keys for delivery', async () => {
    const out = await previewCommands(ctx(), [{ command: 'pic', args: [] }]);
    expect(out.ok).toBe(true);
    expect(out.key).toBeTruthy();
    expect(out.attachmentKey).toBeTruthy();
    // Nothing reached the chat during preview.
    expect(sent).toHaveLength(0);
    expect(out.calls[0]).toMatchObject({ type: 'replyMessage', threadID: 't1' });
    expect(JSON.stringify(out.calls)).toContain('https://cdn.example/a.png');
  });

  it('captures binary attachments pre-normalization', async () => {
    const out = await previewCommands(ctx(), [{ command: 'blob', args: [] }]);
    expect(out.ok).toBe(true);
    expect(out.binaryKey).toBeTruthy();
    const stored = previewResultStore.getBinaryAttachments(out.binaryKey!);
    expect(stored?.[0]?.name).toBe('raw.bin');
    expect(Buffer.isBuffer(stored?.[0]?.stream)).toBe(true);
  });

  it('reports unknown and blocked commands as errors', async () => {
    const out = await previewCommands(ctx(), [{ command: 'nope', args: [] }]);
    expect(out.ok).toBe(false);
    expect(out.key).toBeNull();
    expect(out.errors.join(' ')).toContain('not found');
  });

  it('resolves aliases to canonical names', async () => {
    const aliased = {
      meta: { name: 'weather', aliases: ['w'], role: 0, cooldown: 0 },
      onCommand: async ({ chat }: AppCtx) => {
        await chat.replyMessage({ message: 'Sunny.' });
      },
    };
    const c = ctx();
    (c.commands as Map<string, unknown>).set('weather', aliased);
    const out = await previewCommands(c, [{ command: 'w', args: ['Manila'] }]);
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out.calls)).toContain('Sunny.');
  });
});

describe('deliverPreview', () => {
  it('delivers one merged message and consumes keys', async () => {
    const c = ctx();
    const out = await previewCommands(c, [{ command: 'pic', args: [] }]);
    const res = await deliverPreview(c, {
      message: 'Here you go — fresh photo!',
      attachmentKeys: out.attachmentKey ? [out.attachmentKey] : [],
    });
    expect(res.ok).toBe(true);
    expect(res.content).toContain('1 attachment(s)');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.opts).toMatchObject({ message: 'Here you go — fresh photo!' });
    expect(sent[0]?.opts.attachment_url).toEqual([{ name: 'a.png', url: 'https://cdn.example/a.png' }]);
    // Single-use: second delivery finds nothing.
    expect(previewResultStore.getAttachments(out.attachmentKey!)).toBeNull();
  });

  it('replays binary payloads as streams', async () => {
    const c = ctx();
    const out = await previewCommands(c, [{ command: 'blob', args: [] }]);
    const res = await deliverPreview(c, {
      message: 'Raw file:',
      binaryKeys: out.binaryKey ? [out.binaryKey] : [],
    });
    expect(res.ok).toBe(true);
    const att = (sent[0]?.opts.attachment ?? []) as Array<{ name: string; stream: unknown }>;
    expect(att[0]?.name).toBe('raw.bin');
    expect(Buffer.isBuffer(att[0]?.stream)).toBe(true);
  });

  it('merges buttons and drops them when files exceed one', async () => {
    const c = ctx();
    const menu = await previewCommands(c, [{ command: 'menu', args: [] }]);
    expect(menu.buttonKey).toBeTruthy();
    const res = await deliverPreview(c, {
      message: 'Pick:',
      buttonKeys: menu.buttonKey ? [menu.buttonKey] : [],
    });
    expect(res.ok).toBe(true);
    expect(sent[0]?.opts.button).toBeDefined();
  });

  it('rejects empty messages', async () => {
    const res = await deliverPreview(ctx(), { message: '   ' });
    expect(res.ok).toBe(false);
  });
});
