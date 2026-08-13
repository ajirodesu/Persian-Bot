/**
 * Resolves display names for a list of user IDs via a platform-specific resolver.
 * Abstracting resolution behind resolveUser keeps this function agnostic between
 * the messaging path and any future interaction-like path — callers supply their
 * own resolver closure.
 */
export async function getUserInfo(
  resolveUser: (id: string) => Promise<{ name: string }>,
  userIds: string[],
): Promise<Record<string, { name: string }>> {
  const result: Record<string, { name: string }> = {};
  for (const id of userIds) {
    result[id] = await resolveUser(id);
  }
  return result;
}