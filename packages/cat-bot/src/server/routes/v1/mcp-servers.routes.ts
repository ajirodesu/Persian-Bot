/**
 * MCP Servers Routes — v1
 *
 * Mounted at /api/v1/admin/mcp-servers by routes/v1/index.ts.
 * Every handler in mcpServersController verifies adminAuth session + role ===
 * 'admin' before executing — no additional middleware guard is needed here.
 */

import { Router } from 'express';
import { mcpServersController } from '@/server/controllers/v1/mcp-servers.controller.js';

const mcpServersRouter = Router();

// GET /api/v1/admin/mcp-servers — list all configured MCP servers
mcpServersRouter.get('/', (req, res) => {
  void mcpServersController.listServers(req, res);
});

// POST /api/v1/admin/mcp-servers — add a new MCP server
mcpServersRouter.post('/', (req, res) => {
  void mcpServersController.createServer(req, res);
});

// POST /api/v1/admin/mcp-servers/test — one-shot connectivity + tool probe
mcpServersRouter.post('/test', (req, res) => {
  void mcpServersController.testServer(req, res);
});

// PUT /api/v1/admin/mcp-servers/:id — update a server's name/url/enabled/headers
mcpServersRouter.put('/:id', (req, res) => {
  void mcpServersController.updateServer(req, res);
});

// DELETE /api/v1/admin/mcp-servers/:id — remove a server
mcpServersRouter.delete('/:id', (req, res) => {
  void mcpServersController.removeServer(req, res);
});

export default mcpServersRouter;