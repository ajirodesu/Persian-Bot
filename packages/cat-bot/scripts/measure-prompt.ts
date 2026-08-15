import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadAgentTools } from '@/engine/agent/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const template = fs.readFileSync(
  path.join(__dirname, '../agent/system_prompt.md'),
  'utf-8',
);
const approxTokens = (s: string): number => Math.ceil(s.length / 4);

const tools = await loadAgentTools();
const schemaText = tools
  .map((t) => JSON.stringify(t.config.parameters ?? {}))
  .join('\n');
const toolsText = tools
  .map(
    (t) =>
      `${t.config.name}: ${t.config.description}\n${JSON.stringify(t.config.parameters ?? {})}`,
  )
  .join('\n');

console.log('=== SYSTEM PROMPT ===');
console.log(`template chars: ${template.length}, ~${approxTokens(template)} tokens`);
console.log('template lines:', template.split('\n').length);
console.log('');
console.log('=== TOOLS ===');
console.log(`tool count: ${tools.length}`);
for (const t of tools) {
  const desc = t.config.description;
  const params = JSON.stringify(t.config.parameters ?? {});
  console.log(
    `- ${t.config.name}: desc=${desc.length}ch, params=${params.length}ch (~${approxTokens(desc + params)} tok)`,
  );
}
console.log(
  `ALL schemas combined: ${schemaText.length}ch (~${approxTokens(schemaText)} tok)`,
);
console.log('');
console.log('=== PER-COMPLETION FIXED COST (system + tools) ===');
console.log(
  `~${approxTokens(template)} (template) + ~${approxTokens(toolsText)} (tools) = ~${approxTokens(template + toolsText)} tokens fixed per completion`,
);
console.log('(history/tool-results are added on top of this each turn)');