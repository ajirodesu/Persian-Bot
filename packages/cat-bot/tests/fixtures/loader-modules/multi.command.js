// Fixture for the command loader test — legacy multi-command module shape.
const first = {
  meta: {
    name: 'First',
    aliases: ['f'],
    version: '1.0.0',
    role: 0,
    author: 'Test',
    description: 'First family command.',
    usage: '',
    cooldown: 1,
    hasPrefix: true,
  },
  onCommand: async () => {},
};

const second = {
  meta: {
    name: 'Second',
    aliases: [],
    version: '1.0.0',
    role: 0,
    author: 'Test',
    description: 'Second family command.',
    usage: '',
    cooldown: 1,
    hasPrefix: true,
  },
  onChat: async () => {},
};

export const commands = [
  first,
  second,
  // Missing onCommand/onChat — the loader must skip it.
  { meta: { name: 'Broken' } },
];
