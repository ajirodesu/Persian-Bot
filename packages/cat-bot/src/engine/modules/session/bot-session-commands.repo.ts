// WHY: Abstracted safely through database workspace so the caller stays agnostic to
// which configured adapter (mongodb | neondb) is actually active.
export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from 'database';
