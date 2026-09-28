/**
 * AI Agent Routes — v1
 *
 * Mounted at /api/v1/admin/ai-agent by routes/v1/index.ts.
 * Every handler verifies adminAuth session + role === 'admin' internally.
 */

import { Router } from 'express';
import { aiAgentController } from '@/server/controllers/v1/ai-agent.controller.js';

const aiAgentRouter = Router();

// GET /api/v1/admin/ai-agent — effective settings (secret masked)
aiAgentRouter.get('/', (req, res) => {
  void aiAgentController.getSettings(req, res);
});

// PUT /api/v1/admin/ai-agent — update URL / token / enabled / limits
aiAgentRouter.put('/', (req, res) => {
  void aiAgentController.updateSettings(req, res);
});

// POST /api/v1/admin/ai-agent/test — real authenticated connection test
aiAgentRouter.post('/test', (req, res) => {
  void aiAgentController.testConnection(req, res);
});

// GET /api/v1/admin/ai-agent/capabilities — live capability detection
aiAgentRouter.get('/capabilities', (req, res) => {
  void aiAgentController.getCapabilities(req, res);
});

export default aiAgentRouter;
