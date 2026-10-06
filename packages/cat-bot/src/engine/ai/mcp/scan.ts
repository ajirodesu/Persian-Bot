/**
 * Danger scanner for user-added MCP servers and Skills.
 *
 * A user integration that can execute code, touch the filesystem, run shell
 * commands, or reach internal network endpoints must never run with a normal
 * member's privileges. The scanner reports signals; the caller converts them
 * into enforcement:
 *
 *   critical signal → risk 2, minRole SYSTEM_ADMIN, status 'restricted'
 *   suspicious     → risk 1, status 'pending_review' (admin approval required)
 *   clean          → risk 0/1 by kind, status 'active'
 *
 * Regular users can never lower what the scanner assigns — every user-side
 * save re-runs the scan. Admins may override explicitly from the admin
 * dashboard (their decision is recorded via approved_by).
 */

export type IntegrationKind = 'mcp' | 'skill';

export interface ScanTarget {
  kind: IntegrationKind;
  name: string;
  description?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  parameters?: unknown;
  instructions?: string | undefined;
  /** Actual tool names advertised by the MCP server (when listable). */
  toolNames?: string[] | undefined;
  toolDescriptions?: Record<string, string> | undefined;
  /** Skill mode — webhook skills exfiltrate arguments to a URL. */
  skillMode?: 'tool' | 'prompt' | undefined;
}

export type ScanStatus = 'active' | 'pending_review' | 'restricted';

export interface ScanVerdict {
  risk: 0 | 1 | 2;
  /** Persian-Bot Role level required to trigger the integration. */
  minRole: number;
  status: ScanStatus;
  reasons: string[];
}

// ── Signal patterns ──────────────────────────────────────────────────────────

/** Shell / code-execution / destructive primitives. */
const CRITICAL_KEYWORDS = [
  /\bshell\s*exec/i,
  /\bexec\s*\(/,
  /child_process/i,
  /spawn\s*\(/,
  /eval\s*\(/,
  /Function\s*\(/,
  /os\.system/i,
  /subprocess/i,
  /powershell/i,
  /\brm\s+-rf?\b/i,
  /deltree/i,
  /format\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*{\s*:\|/,
  /\bsudo\b/i,
  /\bsu\s+-/i,
  /chmod\s+(-R\s+)?777/i,
  /chown/i,
  /curl\s+.*\|\s*(sh|bash)/i,
  /wget\s+.*\|\s*(sh|bash)/i,
  /base64\s+(-d|--decode).*sh/i,
  /powershell\s+-(enc|EncodedCommand)/i,
  /IEX\s*\(/i,
  /Invoke-Expression/i,
  /reg\s+(add|delete)/i,
  /schtasks/i,
  /crontab/i,
  /killall/i,
  /kill\s+-9\s+1\b/i,
  /shutdown|reboot|halt\b/i,
  /drop\s+(table|database)/i,
  /delete\s+from/i,
  /truncate\s+table/i,
  /keylog/i,
  /ransom/i,
  /mimikatz/i,
];

/** Worth a human look but not an automatic lockdown. */
const SUSPICIOUS_KEYWORDS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bdestroy\b/i,
  /\bwipe\b/i,
  /\bdrop\b/i,
  /\bwrite\b/i,
  /\bexecute\b/i,
  /\brun\s+command/i,
  /file\s*system/i,
  /read\s+file/i,
  /database/i,
  /credential/i,
  /exfiltrat/i,
  /upload/i,
  /webhook/i,
  /\badmin\b/i,
  /\broot\b/i,
];

/** Prompt-injection / instruction-override directives in skill packs. */
const PROMPT_ATTACK = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /override\s+(the\s+)?system\s+prompt/i,
  /reveal\s+(your\s+)?(system|secret|hidden)\s+(prompt|instructions|key)/i,
  /you\s+are\s+now\s+(?!.*assistant)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
];

/** MCP tool names that are dangerous on their face. */
const DANGEROUS_TOOL_NAMES = [
  'exec',
  'execute',
  'shell',
  'terminal',
  'command',
  'run_command',
  'runcommand',
  'eval',
  'evaluate',
  'delete',
  'delete_file',
  'remove',
  'destroy',
  'wipe',
  'drop',
  'format',
  'write_file',
  'write',
  'edit_file',
  'patch_file',
  'sudo',
  'chmod',
  'kill',
  'shutdown',
  'reboot',
];

/** Cloud metadata endpoints — classic SSRF targets. */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.169.253',
  'metadata.google.internal',
  'metadata.google.com',
  'instance-data',
]);

function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(h)) return true;
  if (h === 'localhost' || h === '::1') return true;
  if (/^(127\.)/.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^0\.0\.0\.0$/.test(h)) return true;
  if (/\.(local|internal|lan|home|corp|intranet)$/.test(h)) return true;
  return false;
}

function pushUnique(into: string[], value: string): void {
  if (!into.includes(value)) into.push(value);
}

// ── Scanner ──────────────────────────────────────────────────────────────────

/**
 * Scan one integration definition. Pure and deterministic — safe to run on
 * every save, on the test-connection path, and in unit tests.
 */
export function scanIntegration(target: ScanTarget): ScanVerdict {
  const critical: string[] = [];
  const suspicious: string[] = [];

  const haystacks: Array<{ label: string; text: string }> = [
    { label: 'name', text: target.name ?? '' },
    { label: 'description', text: target.description ?? '' },
    { label: 'url', text: target.url ?? '' },
    { label: 'instructions', text: target.instructions ?? '' },
  ];

  for (const { label, text } of haystacks) {
    if (!text) continue;
    for (const re of CRITICAL_KEYWORDS) {
      if (re.test(text)) {
        pushUnique(critical, `critical pattern ${re.source} in ${label}`);
        break;
      }
    }
    for (const re of SUSPICIOUS_KEYWORDS) {
      if (re.test(text)) {
        pushUnique(suspicious, `suspicious pattern ${re.source} in ${label}`);
        break;
      }
    }
  }

  if (target.instructions) {
    for (const re of PROMPT_ATTACK) {
      if (re.test(target.instructions)) {
        pushUnique(critical, `prompt-override pattern ${re.source} in skill instructions`);
        break;
      }
    }
  }

  // ── URL analysis ──
  if (target.url) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(target.url);
    } catch {
      pushUnique(suspicious, 'url is not a valid absolute URL');
    }
    if (parsed) {
      const scheme = parsed.protocol.toLowerCase();
      if (scheme !== 'https:' && scheme !== 'http:') {
        pushUnique(critical, `non-http(s) scheme "${scheme}" (e.g. file:// can read the server disk)`);
      } else if (scheme === 'http:' && !isPrivateHostname(parsed.hostname)) {
        pushUnique(suspicious, 'plain http:// to a public host (credentials would travel unencrypted)');
      }
      if (METADATA_HOSTS.has(parsed.hostname.toLowerCase())) {
        pushUnique(critical, `cloud metadata endpoint "${parsed.hostname}" (SSRF target)`);
      } else if (isPrivateHostname(parsed.hostname)) {
        pushUnique(
          suspicious,
          `internal/private endpoint "${parsed.hostname}" (can only reach the host network)`,
        );
      }
      if (parsed.username || parsed.password) {
        pushUnique(suspicious, 'credentials embedded in the URL');
      }
    }
  }

  // ── MCP tool surface ──
  for (const toolName of target.toolNames ?? []) {
    const norm = toolName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (DANGEROUS_TOOL_NAMES.some((d) => norm === d || norm.endsWith(d) || norm.startsWith(d))) {
      pushUnique(critical, `advertised tool "${toolName}" can execute or destroy`);
      continue;
    }
    const desc = target.toolDescriptions?.[toolName] ?? '';
    for (const re of CRITICAL_KEYWORDS) {
      if (re.test(desc)) {
        pushUnique(critical, `advertised tool "${toolName}" describes a critical capability`);
        break;
      }
    }
  }

  // ── Headers carrying secrets to third parties ──
  if (target.headers) {
    for (const [k, v] of Object.entries(target.headers)) {
      if (!v) continue;
      if (/token|secret|key|auth|bearer/i.test(k) && target.url) {
        try {
          const host = new URL(target.url).hostname.toLowerCase();
          if (!isPrivateHostname(host)) {
            pushUnique(
              suspicious,
              `secret header "${k}" is sent to third-party host "${host}"`,
            );
          }
        } catch {
          /* url already flagged */
        }
      }
    }
  }

  if (critical.length > 0) {
    return { risk: 2, minRole: 4, status: 'restricted', reasons: critical };
  }
  if (suspicious.length > 0) {
    return { risk: 1, minRole: 3, status: 'pending_review', reasons: suspicious };
  }
  // A remote MCP server or webhook skill executes third-party code by nature.
  const baselineRisk = target.kind === 'skill' && target.skillMode === 'prompt' ? 0 : 1;
  return { risk: baselineRisk, minRole: 0, status: 'active', reasons: [] };
}

/** Runtime per-tool backstop: a listed tool that looks dangerous is admin-only. */
export function toolLooksDangerous(name: string, description?: string): boolean {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (DANGEROUS_TOOL_NAMES.some((d) => norm === d || norm.endsWith(d) || norm.startsWith(d))) {
    return true;
  }
  if (description) {
    for (const re of CRITICAL_KEYWORDS) {
      if (re.test(description)) return true;
    }
  }
  return false;
}

/** Max integrations one dashboard user may own (abuse cap). */
export const MAX_INTEGRATIONS_PER_USER = 20;
