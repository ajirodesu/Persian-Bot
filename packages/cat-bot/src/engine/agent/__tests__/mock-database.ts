/**
 * Shared 'database' mock for agent tests.
 *
 * Engine repos import many named bindings from the 'database' workspace
 * package. This factory provides async vi.fn() stubs for every binding the
 * agent subsystem can touch, with safe defaults (not banned, not admin).
 * Individual tests override per-case via the exported stubs object.
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';

type AnyAsyncMock = Mock<(...args: never[]) => Promise<unknown>>;

function stubFalse(): AnyAsyncMock {
  return vi.fn(async () => false);
}

function stubNull(): AnyAsyncMock {
  return vi.fn(async () => null);
}

function stubEmptyArray(): AnyAsyncMock {
  return vi.fn(async () => []);
}

export const dbStubs = {
  // Non-behavioral test doubles with loose signatures.
  banUser: vi.fn(async () => undefined) as AnyAsyncMock,
  unbanUser: vi.fn(async () => undefined) as AnyAsyncMock,
  isUserBanned: stubFalse(),
  getUserBanReason: vi.fn(async () => null) as AnyAsyncMock,
  banThread: vi.fn(async () => undefined) as AnyAsyncMock,
  unbanThread: vi.fn(async () => undefined) as AnyAsyncMock,
  isThreadBanned: stubFalse(),
  getThreadBanReason: vi.fn(async () => null) as AnyAsyncMock,
  banDiscordServer: vi.fn(async () => undefined) as AnyAsyncMock,
  unbanDiscordServer: vi.fn(async () => undefined) as AnyAsyncMock,
  isDiscordServerBanned: stubFalse(),
  getDiscordServerBanReason: vi.fn(async () => null) as AnyAsyncMock,
  // credentials / roles
  isBotAdmin: stubFalse(),
  addBotAdmin: vi.fn(async () => undefined) as AnyAsyncMock,
  removeBotAdmin: vi.fn(async () => undefined) as AnyAsyncMock,
  listBotAdmins: stubEmptyArray(),
  isBotPremium: stubFalse(),
  addBotPremium: vi.fn(async () => undefined) as AnyAsyncMock,
  removeBotPremium: vi.fn(async () => undefined) as AnyAsyncMock,
  listBotPremiums: stubEmptyArray(),
  getBotNickname: stubNull(),
  // system admin
  isSystemAdmin: stubFalse(),
  listSystemAdmins: stubEmptyArray(),
  addSystemAdmin: vi.fn(async (adminId: string) => ({ adminId })) as AnyAsyncMock,
  removeSystemAdmin: vi.fn(async () => undefined) as AnyAsyncMock,
  // threads
  isThreadAdmin: stubFalse(),
  getThreadName: vi.fn(async (id: string) => id) as AnyAsyncMock,
  getAllGroupThreadIds: stubEmptyArray(),
  deleteThread: vi.fn(async () => undefined) as AnyAsyncMock,
  getDiscordServerIdByChannel: stubNull(),
  // session commands
  findSessionCommands: stubEmptyArray(),
  isCommandEnabled: vi.fn(async () => true) as AnyAsyncMock,
  setCommandEnabled: vi.fn(async () => undefined) as AnyAsyncMock,
  upsertSessionCommands: vi.fn(async () => undefined) as AnyAsyncMock,
  // ai agent config store
  getAiAgentConfigStore: stubNull(),
  saveAiAgentConfigStore: vi.fn(async () => undefined) as AnyAsyncMock,
  clearAiAgentConfigStore: vi.fn(async () => undefined) as AnyAsyncMock,
  // misc bindings imported at module-eval time by repo chains
  getUserTimezoneOrDefault: vi.fn(async () => 'UTC') as AnyAsyncMock,
};

vi.mock('database', () => dbStubs);

export function resetDbStubs(): void {
  for (const stub of Object.values(dbStubs)) {
    stub.mockReset();
  }
  // Re-apply safe defaults (mockReset wipes implementations).
  dbStubs.isUserBanned.mockResolvedValue(false);
  dbStubs.isThreadBanned.mockResolvedValue(false);
  dbStubs.isBotAdmin.mockResolvedValue(false);
  dbStubs.isBotPremium.mockResolvedValue(false);
  dbStubs.isSystemAdmin.mockResolvedValue(false);
  dbStubs.listSystemAdmins.mockResolvedValue([]);
  dbStubs.isThreadAdmin.mockResolvedValue(false);
  dbStubs.isDiscordServerBanned.mockResolvedValue(false);
  dbStubs.isCommandEnabled.mockResolvedValue(true);
  dbStubs.findSessionCommands.mockResolvedValue([]);
  dbStubs.listBotAdmins.mockResolvedValue([]);
  dbStubs.listBotPremiums.mockResolvedValue([]);
  dbStubs.getAllGroupThreadIds.mockResolvedValue([]);
  dbStubs.getBotNickname.mockResolvedValue(null);
  dbStubs.getAiAgentConfigStore.mockResolvedValue(null);
  dbStubs.getDiscordServerIdByChannel.mockResolvedValue(null);
  dbStubs.getUserBanReason.mockResolvedValue(null);
  dbStubs.getThreadBanReason.mockResolvedValue(null);
}
