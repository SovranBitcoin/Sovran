export type EmojiEntry = {
  emoji: string;
  keywords: string[];
};

export type EmojiCategory = {
  id: string;
  label: string;
  icon: string;
  emojis: EmojiEntry[];
};

export const CATEGORIES: EmojiCategory[] = [
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    icon: '₿',
    emojis: [
      { emoji: '😂', keywords: ['laugh', 'funny', 'joy'] },
      { emoji: '🥜', keywords: ['nut', 'peanut', 'cashu'] },
      { emoji: '⚡', keywords: ['lightning', 'zap', 'bolt', 'ln'] },
      { emoji: '🧡', keywords: ['heart', 'orange', 'bitcoin', 'love'] },
      { emoji: '🏆', keywords: ['trophy', 'win', 'champion'] },
      { emoji: '🌋', keywords: ['volcano', 'eruption', 'lava'] },
      { emoji: '🚀', keywords: ['rocket', 'launch', 'moon'] },
      { emoji: '💰', keywords: ['money', 'bag', 'rich', 'sats'] },
      { emoji: '🔑', keywords: ['key', 'lock', 'private', 'secret'] },
      { emoji: '🦡', keywords: ['badger', 'honey'] },
      { emoji: '🦍', keywords: ['gorilla', 'ape', 'strong'] },
      { emoji: '🪙', keywords: ['coin', 'token', 'gold'] },
      { emoji: '🔒', keywords: ['lock', 'secure', 'private'] },
      { emoji: '🛡️', keywords: ['shield', 'protect', 'defense'] },
      { emoji: '⛏️', keywords: ['pick', 'mine', 'mining'] },
      { emoji: '💎', keywords: ['diamond', 'gem', 'hodl'] },
    ],
  },
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis: [
      { emoji: '😀', keywords: ['smile', 'happy', 'grin'] },
      { emoji: '😃', keywords: ['smile', 'happy', 'mouth'] },
      { emoji: '😄', keywords: ['smile', 'happy', 'eyes'] },
      { emoji: '😁', keywords: ['grin', 'beam', 'teeth'] },
      { emoji: '😆', keywords: ['laugh', 'squint'] },
      { emoji: '😅', keywords: ['sweat', 'nervous', 'laugh'] },
      { emoji: '🤣', keywords: ['rofl', 'laugh', 'rolling'] },
      { emoji: '😊', keywords: ['blush', 'happy', 'warm'] },
      { emoji: '😇', keywords: ['angel', 'halo', 'innocent'] },
      { emoji: '🙂', keywords: ['smile', 'slight'] },
      { emoji: '😉', keywords: ['wink'] },
      { emoji: '😍', keywords: ['love', 'heart', 'eyes'] },
      { emoji: '🥰', keywords: ['love', 'hearts', 'adore'] },
      { emoji: '😘', keywords: ['kiss', 'love', 'blow'] },
      { emoji: '😎', keywords: ['cool', 'sunglasses'] },
      { emoji: '🤩', keywords: ['star', 'eyes', 'excited'] },
      { emoji: '🥳', keywords: ['party', 'celebrate', 'birthday'] },
      { emoji: '😏', keywords: ['smirk', 'sly'] },
      { emoji: '🤔', keywords: ['think', 'hmm', 'wonder'] },
      { emoji: '🤯', keywords: ['mind', 'blown', 'explode'] },
      { emoji: '😱', keywords: ['scream', 'shock', 'fear'] },
      { emoji: '🥺', keywords: ['please', 'puppy', 'eyes'] },
      { emoji: '😤', keywords: ['angry', 'huff', 'steam'] },
      { emoji: '🤑', keywords: ['money', 'rich', 'dollar'] },
      { emoji: '🫡', keywords: ['salute', 'respect'] },
    ],
  },
  {
    id: 'animals',
    label: 'Animals',
    icon: '🐾',
    emojis: [
      { emoji: '🐶', keywords: ['dog', 'puppy', 'pet'] },
      { emoji: '🐱', keywords: ['cat', 'kitten', 'pet'] },
      { emoji: '🐻', keywords: ['bear', 'brown'] },
      { emoji: '🦊', keywords: ['fox', 'orange'] },
      { emoji: '🐸', keywords: ['frog', 'pepe'] },
      { emoji: '🐵', keywords: ['monkey', 'face'] },
      { emoji: '🦁', keywords: ['lion', 'king'] },
      { emoji: '🐯', keywords: ['tiger', 'stripe'] },
      { emoji: '🐮', keywords: ['cow', 'moo'] },
      { emoji: '🐷', keywords: ['pig', 'oink'] },
      { emoji: '🐔', keywords: ['chicken', 'hen'] },
      { emoji: '🦅', keywords: ['eagle', 'bird', 'freedom'] },
      { emoji: '🐝', keywords: ['bee', 'honey', 'buzz'] },
      { emoji: '🦋', keywords: ['butterfly', 'pretty'] },
      { emoji: '🐙', keywords: ['octopus', 'tentacle'] },
      { emoji: '🦈', keywords: ['shark', 'ocean'] },
      { emoji: '🐊', keywords: ['croc', 'alligator'] },
      { emoji: '🦎', keywords: ['lizard', 'reptile'] },
      { emoji: '🐉', keywords: ['dragon'] },
      { emoji: '🌸', keywords: ['blossom', 'cherry', 'flower'] },
      { emoji: '🌻', keywords: ['sunflower', 'flower'] },
      { emoji: '🌲', keywords: ['tree', 'evergreen', 'pine'] },
    ],
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍕',
    emojis: [
      { emoji: '🍕', keywords: ['pizza', 'slice'] },
      { emoji: '🍔', keywords: ['burger', 'hamburger'] },
      { emoji: '🌮', keywords: ['taco', 'mexican'] },
      { emoji: '🍟', keywords: ['fries', 'french'] },
      { emoji: '🍩', keywords: ['donut', 'doughnut'] },
      { emoji: '🍪', keywords: ['cookie', 'biscuit'] },
      { emoji: '🎂', keywords: ['cake', 'birthday'] },
      { emoji: '🍰', keywords: ['cake', 'slice', 'shortcake'] },
      { emoji: '🍫', keywords: ['chocolate', 'bar'] },
      { emoji: '🍿', keywords: ['popcorn', 'movie'] },
      { emoji: '☕', keywords: ['coffee', 'hot', 'drink'] },
      { emoji: '🍺', keywords: ['beer', 'drink', 'cheers'] },
      { emoji: '🥂', keywords: ['champagne', 'cheers', 'toast'] },
      { emoji: '🧃', keywords: ['juice', 'box', 'drink'] },
      { emoji: '🍎', keywords: ['apple', 'red', 'fruit'] },
      { emoji: '🍋', keywords: ['lemon', 'citrus'] },
      { emoji: '🍉', keywords: ['watermelon', 'summer'] },
      { emoji: '🥑', keywords: ['avocado', 'guac'] },
      { emoji: '🌶️', keywords: ['pepper', 'hot', 'spicy'] },
      { emoji: '🍣', keywords: ['sushi', 'fish', 'japanese'] },
    ],
  },
  {
    id: 'activities',
    label: 'Activities',
    icon: '⚽',
    emojis: [
      { emoji: '⚽', keywords: ['soccer', 'football', 'ball'] },
      { emoji: '🏀', keywords: ['basketball', 'ball', 'sport'] },
      { emoji: '🏈', keywords: ['football', 'american'] },
      { emoji: '🎾', keywords: ['tennis', 'ball'] },
      { emoji: '🎮', keywords: ['game', 'controller', 'play'] },
      { emoji: '🎲', keywords: ['dice', 'game', 'gamble'] },
      { emoji: '🎯', keywords: ['target', 'bullseye', 'dart'] },
      { emoji: '🎪', keywords: ['circus', 'tent'] },
      { emoji: '🎨', keywords: ['art', 'paint', 'palette'] },
      { emoji: '🎬', keywords: ['movie', 'film', 'clapper'] },
      { emoji: '🎤', keywords: ['mic', 'sing', 'karaoke'] },
      { emoji: '🎸', keywords: ['guitar', 'rock', 'music'] },
      { emoji: '🎹', keywords: ['piano', 'keys', 'music'] },
      { emoji: '🏆', keywords: ['trophy', 'win', 'champion'] },
      { emoji: '🥇', keywords: ['gold', 'medal', 'first'] },
      { emoji: '🏅', keywords: ['medal', 'sport'] },
      { emoji: '🎉', keywords: ['party', 'celebrate', 'confetti'] },
      { emoji: '🎊', keywords: ['confetti', 'ball', 'celebrate'] },
      { emoji: '🎈', keywords: ['balloon', 'party'] },
      { emoji: '🎁', keywords: ['gift', 'present', 'wrap'] },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💡',
    emojis: [
      { emoji: '💡', keywords: ['light', 'bulb', 'idea'] },
      { emoji: '🔥', keywords: ['fire', 'hot', 'lit'] },
      { emoji: '💣', keywords: ['bomb', 'explode'] },
      { emoji: '🧲', keywords: ['magnet', 'attract'] },
      { emoji: '🔮', keywords: ['crystal', 'ball', 'magic'] },
      { emoji: '🧪', keywords: ['test', 'tube', 'science'] },
      { emoji: '💊', keywords: ['pill', 'medicine'] },
      { emoji: '🔔', keywords: ['bell', 'notification'] },
      { emoji: '📱', keywords: ['phone', 'mobile', 'cell'] },
      { emoji: '💻', keywords: ['laptop', 'computer'] },
      { emoji: '⌨️', keywords: ['keyboard', 'type'] },
      { emoji: '📡', keywords: ['satellite', 'dish', 'signal'] },
      { emoji: '🔋', keywords: ['battery', 'power', 'charge'] },
      { emoji: '💾', keywords: ['floppy', 'disk', 'save'] },
      { emoji: '📦', keywords: ['package', 'box', 'ship'] },
      { emoji: '🏷️', keywords: ['tag', 'label', 'price'] },
      { emoji: '✉️', keywords: ['envelope', 'mail', 'letter'] },
      { emoji: '📜', keywords: ['scroll', 'paper', 'ancient'] },
      { emoji: '🗝️', keywords: ['key', 'old', 'vintage'] },
      { emoji: '⚙️', keywords: ['gear', 'settings', 'cog'] },
      { emoji: '🧰', keywords: ['toolbox', 'tools', 'fix'] },
      { emoji: '⏰', keywords: ['alarm', 'clock', 'time'] },
      { emoji: '🌡️', keywords: ['thermometer', 'temperature'] },
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '❤️',
    emojis: [
      { emoji: '❤️', keywords: ['heart', 'red', 'love'] },
      { emoji: '💛', keywords: ['heart', 'yellow'] },
      { emoji: '💚', keywords: ['heart', 'green'] },
      { emoji: '💙', keywords: ['heart', 'blue'] },
      { emoji: '💜', keywords: ['heart', 'purple'] },
      { emoji: '🖤', keywords: ['heart', 'black'] },
      { emoji: '🤍', keywords: ['heart', 'white'] },
      { emoji: '💯', keywords: ['hundred', 'perfect', 'score'] },
      { emoji: '✅', keywords: ['check', 'done', 'yes'] },
      { emoji: '❌', keywords: ['cross', 'no', 'wrong'] },
      { emoji: '⭐', keywords: ['star', 'gold', 'favorite'] },
      { emoji: '🌟', keywords: ['star', 'glow', 'sparkle'] },
      { emoji: '✨', keywords: ['sparkle', 'shine', 'magic'] },
      { emoji: '💫', keywords: ['dizzy', 'star', 'shooting'] },
      { emoji: '🔴', keywords: ['red', 'circle', 'dot'] },
      { emoji: '🟢', keywords: ['green', 'circle', 'dot'] },
      { emoji: '🔵', keywords: ['blue', 'circle', 'dot'] },
      { emoji: '🟡', keywords: ['yellow', 'circle', 'dot'] },
      { emoji: '♾️', keywords: ['infinity', 'forever', 'loop'] },
      { emoji: '🏴‍☠️', keywords: ['pirate', 'flag', 'skull'] },
    ],
  },
];

export const ALL_EMOJIS: EmojiEntry[] = CATEGORIES.flatMap((c) => c.emojis);

export function searchEmojis(query: string): EmojiEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  // Deduplicate by emoji character (same emoji may appear in multiple categories)
  const seen = new Set<string>();
  const results: EmojiEntry[] = [];
  for (const entry of ALL_EMOJIS) {
    if (seen.has(entry.emoji)) continue;
    if (entry.keywords.some((kw) => kw.startsWith(q)) || entry.emoji === q) {
      seen.add(entry.emoji);
      results.push(entry);
    }
  }
  return results;
}
