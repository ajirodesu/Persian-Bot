// Fixture for the command loader test — single-command module shape.
export const meta = {
  name: 'Solo',
  aliases: ['s'],
  version: '1.0.0',
  role: 0,
  author: 'Test',
  description: 'Single-command fixture.',
  usage: '',
  cooldown: 1,
  hasPrefix: true,
  options: [{ type: 'string', name: 'Query', required: false }],
};

export const onCommand = async () => {};
