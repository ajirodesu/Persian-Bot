/**
 * MCP Servers Controller — v1 admin API for the custom MCP server registry.
 *
 * System administrators manage the deployment-level MCP servers (name + URL +
 * optional auth headers) that the AI agent auto-loads and connects to. Every
 * handler enforces the adminAuth session + admin role check first.
 *
 * Security notes:
 *   • Header values are encrypted at rest by the engine repo (AES-256-GCM) and
 *     are NEVER returned to the client — only their keys are (for display).
 *   • URLs are validated to be absolute http(s) URLs only (no file://, no
 *     schemes, no SSRF-friendly protocols).
 */
import type { Request, Response } from 'express';
import { requireAdmin } from '@/server/validators/auth-session.validator.js';
import {
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  listMcpServers,
  invalidateMcpServersCache,
  type McpServerConfig,
} from '@/engine/repos/mcp-servers.repo.js';
import { testMcpServerConnection } from '@/engine/agent/lib/external-mcp.lib.js';

/** Admin-facing DTO — header VALUES are never exposed, only their keys. */
interface McpServerDto {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  headerKeys: string[];
  createdAt: string;
  updatedAt: string;
}

function toDto(s: McpServerConfig): McpServerDto {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    enabled: s.enabled,
    headerKeys: Object.keys(s.headers),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Validates an absolute http(s) URL. Returns the trimmed URL or null. */
function validateUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** Validates a server name. Returns the trimmed name or null. */
function validateName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return trimmed;
}

/** Validates an optional headers object ({ k: v }). null when structurally bad. */
function validateHeaders(
  value: unknown,
): Record<string, string> | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') return null;
    if (k.trim() && v.trim()) out[k.trim()] = v;
  }
  return out;
}

class McpServersController {
  // GET /api/v1/admin/mcp-servers
  async listServers(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const servers = await listMcpServers();
      res.status(200).json({ servers: servers.map(toDto) });
    } catch (err) {
      console.error('[McpServersController.listServers]', err);
      res.status(500).json({ error: 'Failed to fetch MCP servers' });
    }
  }

  // POST /api/v1/admin/mcp-servers
  async createServer(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const body = (req.body ?? {}) as {
      name?: unknown;
      url?: unknown;
      enabled?: unknown;
      headers?: unknown;
    };
    const name = validateName(body.name);
    if (!name) {
      res.status(400).json({ error: 'name must be a non-empty string (max 80 chars)' });
      return;
    }
    const url = validateUrl(body.url);
    if (!url) {
      res.status(400).json({ error: 'url must be a valid absolute http(s) URL' });
      return;
    }
    const headers = validateHeaders(body.headers);
    if (headers === null) {
      res.status(400).json({ error: 'headers must be an object of string values' });
      return;
    }
    try {
      const server = await addMcpServer({
        name,
        url,
        enabled: body.enabled !== false,
        ...(headers ? { headers } : {}),
      });
      invalidateMcpServersCache();
      res.status(201).json({ server: toDto(server) });
    } catch (err) {
      console.error('[McpServersController.createServer]', err);
      res.status(500).json({ error: 'Failed to add MCP server' });
    }
  }

  // PUT /api/v1/admin/mcp-servers/:id
  async updateServer(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const rawId = req.params['id'];
    const id = String(Array.isArray(rawId) ? rawId[0] ?? '' : rawId ?? '').trim();
    if (!id) {
      res.status(400).json({ error: 'Missing server id' });
      return;
    }
    const body = (req.body ?? {}) as {
      name?: unknown;
      url?: unknown;
      enabled?: unknown;
      headers?: unknown;
    };
    const patch: {
      name?: string;
      url?: string;
      enabled?: boolean;
      headers?: Record<string, string>;
    } = {};
    if (body.name !== undefined) {
      const name = validateName(body.name);
      if (!name) {
        res.status(400).json({ error: 'name must be a non-empty string (max 80 chars)' });
        return;
      }
      patch.name = name;
    }
    if (body.url !== undefined) {
      const url = validateUrl(body.url);
      if (!url) {
        res.status(400).json({ error: 'url must be a valid absolute http(s) URL' });
        return;
      }
      patch.url = url;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }
      patch.enabled = body.enabled;
    }
    if (body.headers !== undefined) {
      const headers = validateHeaders(body.headers);
      if (headers === null) {
        res.status(400).json({ error: 'headers must be an object of string values' });
        return;
      }
      patch.headers = headers ?? {};
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    try {
      const server = await updateMcpServer(id, patch);
      if (!server) {
        res.status(404).json({ error: 'MCP server not found' });
        return;
      }
      invalidateMcpServersCache();
      res.status(200).json({ server: toDto(server) });
    } catch (err) {
      console.error('[McpServersController.updateServer]', err);
      res.status(500).json({ error: 'Failed to update MCP server' });
    }
  }

  // DELETE /api/v1/admin/mcp-servers/:id
  async removeServer(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const rawId = req.params['id'];
    const id = String(Array.isArray(rawId) ? rawId[0] ?? '' : rawId ?? '').trim();
    if (!id) {
      res.status(400).json({ error: 'Missing server id' });
      return;
    }
    try {
      const removed = await removeMcpServer(id);
      if (!removed) {
        res.status(404).json({ error: 'MCP server not found' });
        return;
      }
      invalidateMcpServersCache();
      res.status(200).json({ status: 'removed' });
    } catch (err) {
      console.error('[McpServersController.removeServer]', err);
      res.status(500).json({ error: 'Failed to remove MCP server' });
    }
  }

  // POST /api/v1/admin/mcp-servers/test — one-shot connectivity + tool probe
  async testServer(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const body = (req.body ?? {}) as { url?: unknown; headers?: unknown };
    const url = validateUrl(body.url);
    if (!url) {
      res.status(400).json({ error: 'url must be a valid absolute http(s) URL' });
      return;
    }
    const headers = validateHeaders(body.headers);
    if (headers === null) {
      res.status(400).json({ error: 'headers must be an object of string values' });
      return;
    }
    const result = await testMcpServerConnection({
      url,
      ...(headers ? { headers } : {}),
    });
    res.status(200).json(result);
  }
}

export const mcpServersController = new McpServersController();