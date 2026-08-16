/**
 * AI Agent — send_file tool
 *
 * Port of canis src/components/ai/tools/sendFile.ts. Execution is delegated to
 * ToolContext.sendFile, which the agent handler binds to the platform chat.
 */

import type { ToolMeta, ToolContext } from './types.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'send_file',
  description:
    'Send a local file to the user in chat. ' +
    'Use this after creating files with the shell tool. ' +
    'Supports any file type: HTML, zip, images, PDFs, scripts, etc.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to send, e.g. site/index.html',
      },
      caption: {
        type: 'string',
        description: 'Optional caption shown with the file',
      },
    },
    required: ['path'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { path, caption }: { path?: string; caption?: string },
  ctx: ToolContext,
): Promise<string> => {
  return ctx.sendFile(
    String(path ?? '').trim(),
    caption !== undefined ? String(caption) : undefined,
  );
};
