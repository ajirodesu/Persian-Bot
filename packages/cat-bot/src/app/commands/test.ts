/**
 * /test — Sanity-check command with an interactive button
 *
 * Sends a status message with a single "Run test" button. Clicking it
 * edits the message in place, flips a pass/fail state, and tracks how
 * many times the check has been re-run in this session — useful as a
 * quick smoke test for the command + button pipeline on any platform.
 *
 *   User: /test
 *   Bot:  🧪 Test ready. Tap the button to run it.
 *         [ ▶️ Run test ]
 *   User: [clicks ▶️ Run test]
 *   Bot:  ✅ Test passed (run #1) — button system is working.
 *         [ 🔁 Run again ]
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

export const meta: CommandMeta = {
  name: 'test',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sanity-check command with a button that runs a quick test on click',
  category: 'info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

const BUTTON_ID = { run: 'run' } as const;

// Re-running increments a per-session counter and re-renders the button
// label with the new run count so repeated clicks are visibly tracked.
export const button = {
  [BUTTON_ID.run]: {
    label: '▶️ Run test',
    style: ButtonStyle.PRIMARY,
    onClick: async ({ chat, event, native, session, button }: AppCtx) => {
      const scopedRun = session.id; // Reuse active instance ID
      const previousCount = (session.context.count as number) || 0;
      const count = previousCount + 1;

      button.update({
        id: scopedRun,
        label: `🔁 Run again (${count})`,
      });

      button.createContext({
        id: scopedRun,
        context: {
          count,
        },
      });

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event.messageID as string,
        message: `✅ **Test passed** (run #${count}) — button system is working.`,
        ...(hasNativeButtons(native.platform) ? { button: [scopedRun] } : {}),
      });
    },
  },
};

export const onCommand = async ({ chat, native, button }: AppCtx) => {
  // Scope the button to the sender so only the user who issued /test can click it.
  const scopedRun = button.generateID({ id: BUTTON_ID.run });

  button.createContext({
    id: scopedRun,
    context: {
      count: 0,
    },
  });

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🧪 Test ready. Tap the button to run it.',
    ...(hasNativeButtons(native.platform) ? { button: [scopedRun] } : {}),
  });
};
