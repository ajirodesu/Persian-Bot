/**
 * WHY: Provides a standard raw event object for dispatch tests,
 * overriding only the fields relevant to the specific test suite.
 */
export function createMockEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    threadID: 'thread-1',
    messageID: 'msg-1',
    senderID: 'user-1',
    body: 'mock body content',
    ...overrides,
  };
}
