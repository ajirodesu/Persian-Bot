/**
 * Admin DTOs — admin-only API type contracts
 *
 * Kept separate from bot.dto.ts because these types expose cross-user data
 * (listAll bots) and global configuration (system admins) that user-facing
 * endpoints must never return. Keeping them isolated enforces the boundary
 * at the type level rather than relying on runtime guards alone.
 */
export {};
//# sourceMappingURL=admin.dto.js.map