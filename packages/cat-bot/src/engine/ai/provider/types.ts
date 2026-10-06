/**
 * AI Provider Types — OpenAI-compatible chat contracts shared by every provider.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** null when an assistant turn carries nothing but tool calls. */
  content: string | null;
  tool_calls?: ToolCall[];
  /** Required on role:'tool' — identifies the answered call. */
  tool_call_id?: string;
  name?: string;
}

/** JSON Schema subset every supported provider agrees on. */
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON text — models emit malformed JSON often enough to parse defensively. */
    arguments: string;
  };
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  /** Structured-output switch used by JSON-mode agents. */
  response_format?: { type: 'json_object' | 'text' };
  seed?: number;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason:
    | 'stop'
    | 'length'
    | 'content_filter'
    | 'tool_calls'
    | (string & {})
    | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: Usage;
  provider?: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  maxRetries?: number;
  timeout?: number;
  /**
   * Whether a 429 is retried against the *same* model after backoff.
   * The agent runner sets this to false whenever another model or provider
   * is available — rotating immediately is faster and more likely to succeed.
   */
  retryRateLimit?: boolean;
}

export interface Provider {
  readonly name: string;
  readonly baseUrl: string;
  chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  isConfigured(): boolean;
  /** Live model ids from GET {baseUrl}/models. Empty when unsupported. */
  listModels?(): Promise<string[]>;
}

/**
 * Known provider names. `(string & {})` keeps autocomplete while still
 * allowing a custom provider via registerProvider().
 */
export type ProviderName =
  | 'groq'
  | 'openrouter'
  | 'deepinfra'
  | 'venice'
  | 'openai'
  | 'together'
  | 'fireworks'
  | 'lepton'
  | 'ollama'
  | 'lmstudio'
  | (string & {});
