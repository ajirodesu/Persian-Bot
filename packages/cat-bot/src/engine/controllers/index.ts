/**
 * Controller Barrel — single public API surface for the controller layer.
 *
 * All platform listeners and app.ts import exclusively from this file.
 * Internal module structure (dispatchers/, handlers/, types.ts) is an
 * implementation detail — consumers never need to know about it.
 */

// Public types
export type {
  CommandModule,
  CommandMap,
  EventModuleMap,
  ParsedCommand,
  NativeContext,
  BaseCtx,
  AppCtx,
} from '@/engine/types/controller.types.js';

// Entry points
export { handleMessage } from './handlers/message.handler.js';
export { handleEvent } from './handlers/event.handler.js';
export { handleButtonAction } from './dispatchers/button.dispatcher.js';
