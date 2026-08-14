/**
 * Greeting Messages Lib — random welcome / goodbye responses
 *
 * Ported verbatim from mrepol742/project-canis (src/data/group.ts) so
 * Cat-Bot's welcome and goodbye events greet members with the same varied,
 * human-feeling responses instead of one fixed sentence. Each entry is a
 * template that receives the member's display name.
 *
 * `getMessage(type, user)` picks one uniformly at random per event.
 */

type MessageFn = (user: string) => string;

interface MessageSets {
  welcome: MessageFn[];
  leaving: MessageFn[];
}

const messages: MessageSets = {
  welcome: [
    (user) => `Welcome ${user}! 🎉`,
    (user) => `Hello ${user}, glad you joined us 👋`,
    (user) => `Hey ${user}, welcome aboard 🚀`,
    (user) => `Nice to see you, ${user}! 🌟`,
    (user) => `A warm welcome to you, ${user}! 🫶`,
    (user) => `${user} just arrived! Everyone say hi 👋`,
    (user) => `Happy to have you here, ${user}! 🌈`,
    (user) => `${user}, you’ve entered the chat. Let’s go! 🔥`,
    (user) => `Cheers to ${user} for joining us 🥂`,
    (user) => `Big welcome to ${user}! 💫`,
    (user) => `${user} has landed 🛬`,
    (user) => `Good to see you, ${user}. Make yourself at home 🏡`,
  ],
  leaving: [
    (user) => `Goodbye ${user}, we’ll miss you 😢`,
    (user) => `See you later ${user}, take care 👋`,
    (user) => `Sad to see you go, ${user} 💔`,
    (user) => `Farewell ${user}, until next time 🌈`,
    (user) => `Bye ${user}, wishing you all the best 🍀`,
    (user) => `${user} has left the building 🏃‍♂️💨`,
    (user) => `Take care ${user}, hope to see you again 🙏`,
    (user) => `Adios ${user}! Safe travels 🌍`,
    (user) => `${user} has signed off. Catch you later 💻`,
    (user) => `We’ll keep your seat warm, ${user} 🔥`,
    (user) => `Goodbye ${user}, it won’t be the same without you 🥺`,
    (user) => `${user} just disappeared like a ninja 🥷✨`,
  ],
};

/**
 * Returns a random welcome/farewell for the given type with the member's
 * display name interpolated. `user` may be a comma-joined list of names for
 * bulk join/leave events.
 */
export function getMessage(type: keyof MessageSets, user: string): string {
  const arr = messages[type];
  // Arrays are non-empty by construction, so the random index is always valid.
  const template = arr[Math.floor(Math.random() * arr.length)] ?? arr[0]!;
  return template(user);
}
