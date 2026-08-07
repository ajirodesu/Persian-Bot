import type { Request, Response } from 'express';
import { requireAdmin } from '@/server/validators/auth-session.validator.js';
import { adminAuth } from '@/server/lib/better-auth.lib.js';
import { botRepo } from '@/server/repos/bot.repo.js';
import { botService } from '@/server/services/bot.service.js';
import {
  listSystemAdmins,
  listAllUsers,
  deleteUser,
  resetAllDatabase,
} from 'database';
// System admin mutations/checks MUST go through the cached repo wrapper (not the
// bare 'database' package functions above) — it writes through to the shared
// in-memory Set so Add/Remove take effect immediately on the very next command
// or API call, with no server restart and no waiting on the LRU's 5-min TTL.
import {
  addSystemAdmin,
  removeSystemAdmin,
  isSystemAdmin,
} from '@/engine/repos/system-admin.repo.js';
import type {
  AddSystemAdminRequestDto,
  ResetAllDatabaseRequestDto,
  ResetAllDatabaseResponseDto,
  UpdateMaintenanceModeRequestDto,
} from '@/server/dtos/admin.dto.js';
import { RESET_ALL_DATABASE_CONFIRMATION_PHRASE } from '@/server/dtos/admin.dto.js';
// Maintenance Mode state goes through the cached engine repo (not the bare
// 'database' getMaintenanceModeEnabled) so a toggle reflects immediately on the
// very next command via the shared in-memory flag.
import {
  getMaintenanceModeEnabled,
  setMaintenanceModeEnabled,
} from '@/engine/repos/maintenance-mode.repo.js';

/** Max length for a system admin ID — generous enough for any platform's native ID format (Discord/Telegram snowflakes, UUIDs, etc). */
const SYSTEM_ADMIN_ID_MAX_LENGTH = 128;

/**
 * Validates a submitted system admin ID server-side — the client-side check in
 * settings.tsx is a UX convenience only, never the source of truth. Returns the
 * trimmed ID on success, or an error message string on failure.
 */
function validateSystemAdminId(raw: unknown): { id: string } | { error: string } {
  if (typeof raw !== 'string') {
    return { error: 'adminId must be a string' };
  }
  const id = raw.trim();
  if (!id) {
    return { error: 'adminId cannot be empty' };
  }
  if (id.length > SYSTEM_ADMIN_ID_MAX_LENGTH) {
    return { error: `adminId must be ${SYSTEM_ADMIN_ID_MAX_LENGTH} characters or fewer` };
  }
  // Reject embedded whitespace/control characters — a valid platform user ID never contains these.
  if (/[\s\u0000-\u001f]/.test(id)) {
    return { error: 'adminId cannot contain whitespace or control characters' };
  }
  return { id };
}

export class AdminController {
  // In-process re-entrancy guard — see resetAllDatabase() safeguard #3.
  #resetInProgress = false;

  // GET /api/v1/admin/users — fetches all users, delegating pagination and search directly to the database.
  async listUsers(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const page = parseInt(req.query['page'] as string, 10) || 1;
      // Enforce a hard maximum to avoid massive performance drops from querying unlimited pages
      const limit = Math.min(
        parseInt(req.query['limit'] as string, 10) || 10,
        100,
      );
      const search = ((req.query['search'] as string | undefined) || '').trim();

      // WHY: Search and pagination MUST happen in the packages/database layer natively (using SQL
      // LIMIT/OFFSET or MongoDB $facet) rather than dynamically slicing arrays in the server layer.
      // This ensures O(1) memory complexity and O(limit) time complexity even with 100k+ users.
      const result = await listAllUsers(search, page, limit);

      res.status(200).json(result);
    } catch (error) {
      console.error('[AdminController.listUsers]', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }

  // GET /api/v1/admin/bots — all bot sessions across all owners
  async listBots(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const page = parseInt(req.query['page'] as string, 10) || 1;
      const limit = Math.min(
        parseInt(req.query['limit'] as string, 10) || 10,
        100,
      );
      const search = ((req.query['search'] as string | undefined) || '').trim();

      // WHY: Delegated to the database adapter. Never load the full bot_session table into memory
      // to perform dynamic Array.prototype.slice pagination here.
      const result = await botRepo.listAll(search, page, limit);

      res.status(200).json(result);
    } catch (error) {
      console.error('[AdminController.listBots]', error);
      res.status(500).json({ error: 'Failed to fetch all bot sessions' });
    }
  }

  // GET /api/v1/admin/system-admins
  async getSystemAdmins(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const admins = await listSystemAdmins();
      res.status(200).json({ admins });
    } catch (error) {
      console.error('[AdminController.getSystemAdmins]', error);
      res.status(500).json({ error: 'Failed to fetch system admins' });
    }
  }

  // POST /api/v1/admin/system-admins
  async addSystemAdmin(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const validated = validateSystemAdminId(
      (req.body as AddSystemAdminRequestDto | undefined)?.adminId,
    );
    if ('error' in validated) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const { id: adminId } = validated;
    try {
      // Explicit pre-check so duplicates surface as a clear, specific error instead of a
      // silently-idempotent 201 — addSystemAdmin() itself is still safe under a race (the
      // DB's UNIQUE constraint + ON CONFLICT DO NOTHING makes it idempotent either way).
      if (await isSystemAdmin(adminId)) {
        res
          .status(409)
          .json({ error: `"${adminId}" is already a system admin` });
        return;
      }
      const admin = await addSystemAdmin(adminId);
      res.status(201).json(admin);
    } catch (error) {
      console.error('[AdminController.addSystemAdmin]', error);
      res.status(500).json({ error: 'Failed to add system admin' });
    }
  }

  // DELETE /api/v1/admin/system-admins/:adminId
  async removeSystemAdmin(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const validated = validateSystemAdminId(req.params['adminId']);
    if ('error' in validated) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const { id: adminId } = validated;
    try {
      if (!(await isSystemAdmin(adminId))) {
        res
          .status(404)
          .json({ error: `"${adminId}" is not a registered system admin` });
        return;
      }
      await removeSystemAdmin(adminId);
      res.status(200).json({ status: 'removed' });
    } catch (error) {
      console.error('[AdminController.removeSystemAdmin]', error);
      res.status(500).json({ error: 'Failed to remove system admin' });
    }
  }

  // GET /api/v1/admin/maintenance-mode — reads the global Maintenance Mode switch state.
  async getMaintenanceMode(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const enabled = await getMaintenanceModeEnabled();
      res.status(200).json({ enabled });
    } catch (error) {
      console.error('[AdminController.getMaintenanceMode]', error);
      res.status(500).json({ error: 'Failed to fetch Maintenance Mode state' });
    }
  }

  // PUT /api/v1/admin/maintenance-mode — toggles the global Maintenance Mode switch.
  // Goes through the cached engine repo so the change takes effect immediately.
  async updateMaintenanceMode(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const { enabled } = req.body as UpdateMaintenanceModeRequestDto;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    try {
      await setMaintenanceModeEnabled(enabled);
      res.status(200).json({ enabled });
    } catch (error) {
      console.error('[AdminController.updateMaintenanceMode]', error);
      res.status(500).json({ error: 'Failed to update Maintenance Mode state' });
    }
  }

  /**
   * POST /api/v1/admin/users/:userId/ban-sessions
   * Stops all live bot transports for the given user and sets isRunning=false in the DB.
   * Called alongside better-auth's banUser so the session teardown is synchronised with
   * the auth-level ban — the client fires both requests after a successful better-auth response.
   */
  async stopUserSessions(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }
    try {
      await botService.stopAllUserSessions(userId);
      res.status(200).json({ status: 'sessions stopped' });
    } catch (error) {
      console.error('[AdminController.stopUserSessions]', error);
      res.status(500).json({ error: 'Failed to stop user sessions' });
    }
  }

  /** POST /api/v1/admin/users/:userId/unban-sessions — restarts all sessions for an unbanned user. */
  async startUserSessions(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }
    try {
      await botService.startAllUserSessions(userId);
      res.status(200).json({ status: 'sessions started' });
    } catch (error) {
      console.error('[AdminController.startUserSessions]', error);
      res.status(500).json({ error: 'Failed to start user sessions' });
    }
  }

  // PUT /api/v1/admin/users/:userId
  // Updates the user's name, email, and role.
  async updateUser(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    const { name, email, role } = req.body as {
      name?: string;
      email?: string;
      role?: string;
    };

    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }

    try {
      const ctx = await adminAuth.$context;

      // Validation: Prevent email collisions. If the email attempt already exists in user table database, reject it.
      if (email) {
        const lowerEmail = email.toLowerCase();
        const existing = await ctx.adapter.findOne<Record<string, unknown>>({
          model: 'user',
          where: [{ field: 'email', value: lowerEmail }],
        });

        if (existing && existing['id'] !== userId) {
          res
            .status(400)
            .json({ error: 'Email already exists in user table database' });
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      if (name) updateData['name'] = name;
      if (email) updateData['email'] = email.toLowerCase();
      if (role) updateData['role'] = role;

      // Using the raw adapter directly as it seamlessly updates the core user schema fields
      await ctx.adapter.update({
        model: 'user',
        where: [{ field: 'id', value: userId }],
        update: updateData,
      });

      res.status(200).json({ status: 'updated' });
    } catch (error) {
      console.error('[AdminController.updateUser]', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }

  // POST /api/v1/admin/users/:userId/verify
  async verifyUser(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }
    try {
      const ctx = await adminAuth.$context;
      await ctx.adapter.update({
        model: 'user',
        where: [{ field: 'id', value: userId }],
        update: { emailVerified: true },
      });
      res.status(200).json({ status: 'verified' });
    } catch (error) {
      console.error('[AdminController.verifyUser]', error);
      res.status(500).json({ error: 'Failed to verify user' });
    }
  }

  /**
   * DELETE /api/v1/admin/users/:userId
   * Stops all live bot transports for the user, then permanently deletes
   * the account and every associated record from the database.
   * Admins cannot delete themselves or other admin accounts.
   */
  async deleteUser(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    if (!userId) {
      res.status(400).json({ error: 'Missing userId param' });
      return;
    }
    try {
      const ctx = await adminAuth.$context;
      const target = await ctx.adapter.findOne<Record<string, unknown>>({
        model: 'user',
        where: [{ field: 'id', value: userId }],
      });
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (target['role'] === 'admin') {
        res.status(403).json({ error: 'Cannot delete an admin account' });
        return;
      }
      // Stop live transports before wiping the DB rows
      await botService.stopAllUserSessions(userId);
      await deleteUser(userId);
      res.status(200).json({ status: 'deleted' });
    } catch (error) {
      console.error('[AdminController.deleteUser]', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  /**
   * POST /api/v1/admin/reset-database
   *
   * Permanently deletes and resets ALL database records and system data, with the
   * sole exception of the account and associated data belonging to the currently
   * authenticated admin executing the reset — that admin's data is preserved intact.
   *
   * Safeguards against accidental or unauthorized use:
   *   1. requireAdmin() — only a session-authenticated user with role==='admin' may call this.
   *   2. Exact confirmation-phrase match, verified server-side (not merely gated in the UI),
   *      so no bare/automated/replayed POST can trigger a wipe without deliberate intent.
   *   3. #resetInProgress guard — rejects concurrent invocations (e.g. an accidental
   *      double-submit) so two overlapping resets can never race against each other.
   *   4. Live bot transports for every OTHER user are stopped before the DB is touched,
   *      preventing in-flight writes to rows that are about to be deleted.
   */
  async resetAllDatabase(req: Request, res: Response): Promise<void> {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (this.#resetInProgress) {
      res
        .status(409)
        .json({ error: 'A database reset is already in progress' });
      return;
    }

    const { confirmationPhrase } = req.body as ResetAllDatabaseRequestDto;
    if (confirmationPhrase !== RESET_ALL_DATABASE_CONFIRMATION_PHRASE) {
      res.status(400).json({
        error: `Confirmation phrase mismatch. Type "${RESET_ALL_DATABASE_CONFIRMATION_PHRASE}" exactly to proceed.`,
      });
      return;
    }

    this.#resetInProgress = true;
    try {
      // Halt every other user's live bot transports first so nothing writes through
      // stale credentials while their rows are being deleted below.
      await botService.stopAllSessionsExcept(admin.id);
      await resetAllDatabase(admin.id);

      const response: ResetAllDatabaseResponseDto = {
        status: 'reset',
        preservedAdminId: admin.id,
      };
      res.status(200).json(response);
    } catch (error) {
      console.error('[AdminController.resetAllDatabase]', error);
      res.status(500).json({ error: 'Failed to reset database' });
    } finally {
      this.#resetInProgress = false;
    }
  }

  // DELETE /api/v1/admin/bots/:userId/:sessionId
  // Admin-privileged hard delete — works on any user's session without a user auth cookie.
  // Delegates to botService.deleteBot which stops the live transport first, then unregisters
  // the session closure, and finally wipes all DB rows in dependency order (commands, events,
  // credentials, then the session row itself). Same teardown path as the user-facing delete.
  async deleteBot(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.params['userId'] ?? '');
    const sessionId = String(req.params['sessionId'] ?? '');
    if (!userId || !sessionId) {
      res.status(400).json({ error: 'Missing userId or sessionId param' });
      return;
    }
    try {
      await botService.deleteBot(userId, sessionId);
      res.status(200).json({ status: 'deleted' });
    } catch (error) {
      console.error('[AdminController.deleteBot]', error);
      res.status(500).json({ error: 'Failed to delete bot session' });
    }
  }
}

export const adminController = new AdminController();
