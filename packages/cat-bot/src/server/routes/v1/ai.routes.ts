import { Router } from 'express';
import { aiController } from '@/server/controllers/v1/ai.controller.js';

const aiRouter = Router();

// GET /api/v1/ai/status — compact operational status for the overview card
aiRouter.get('/status', (req, res) => {
  void aiController.status(req, res);
});

// GET /api/v1/ai/config — full editable config with masked secrets
aiRouter.get('/config', (req, res) => {
  void aiController.getConfig(req, res);
});

// PUT /api/v1/ai/config — validate + persist AI configuration
aiRouter.put('/config', (req, res) => {
  void aiController.saveConfig(req, res);
});

// GET /api/v1/ai/routing — per-agent provider/model candidates
aiRouter.get('/routing', (req, res) => {
  void aiController.routing(req, res);
});

// GET /api/v1/ai/tools — unified tool registry (built-in + MCP + Skills)
aiRouter.get('/tools', (req, res) => {
  void aiController.tools(req, res);
});

// GET /api/v1/ai/candidates?agent=default — model candidates for one agent
aiRouter.get('/candidates', (req, res) => {
  void aiController.candidates(req, res);
});

// GET /api/v1/ai/providers/:provider/models — live model catalog for a provider
aiRouter.get('/providers/:provider/models', (req, res) => {
  void aiController.providerModels(req, res);
});

// POST /api/v1/ai/test — live provider/model connectivity probe
aiRouter.post('/test', (req, res) => {
  void aiController.testConnection(req, res);
});

// GET /api/v1/ai/integrations — the caller's own MCP servers and Skills
aiRouter.get('/integrations', (req, res) => {
  void aiController.listIntegrations(req, res);
});

// POST /api/v1/ai/integrations — add an MCP server or Skill (auto-scanned)
aiRouter.post('/integrations', (req, res) => {
  void aiController.createIntegration(req, res);
});

// PUT /api/v1/ai/integrations/:id — edit own entry (re-scanned)
aiRouter.put('/integrations/:id', (req, res) => {
  void aiController.updateIntegration(req, res);
});

// DELETE /api/v1/ai/integrations/:id — delete own entry
aiRouter.delete('/integrations/:id', (req, res) => {
  void aiController.deleteIntegration(req, res);
});

// POST /api/v1/ai/integrations/:id/test — probe + rescan one entry
aiRouter.post('/integrations/:id/test', (req, res) => {
  void aiController.testIntegration(req, res);
});

// POST /api/v1/ai/draft — editor agent (draft only; never publishes)
aiRouter.post('/draft', (req, res) => {
  void aiController.draft(req, res);
});

// POST /api/v1/ai/moderate — dry-run classification of one message
aiRouter.post('/moderate', (req, res) => {
  void aiController.moderate(req, res);
});

// GET /api/v1/ai/policy?threadId= — current policy for a thread
aiRouter.get('/policy', (req, res) => {
  void aiController.getPolicy(req, res);
});

// GET /api/v1/ai/policy/default — blank policy shape for forms
aiRouter.get('/policy/default', (req, res) => {
  void aiController.defaultPolicy(req, res);
});

// POST /api/v1/ai/policy/compile — NL order → validated patch (no apply)
aiRouter.post('/policy/compile', (req, res) => {
  void aiController.compilePolicy(req, res);
});

// POST /api/v1/ai/policy/validate — validate a raw patch without applying
aiRouter.post('/policy/validate', (req, res) => {
  void aiController.validatePolicy(req, res);
});

// GET /api/v1/ai/audit — recent moderation audit entries
aiRouter.get('/audit', (req, res) => {
  void aiController.audit(req, res);
});

export default aiRouter;
