import { randomInt } from 'node:crypto';

/**
 * The words a fresh portfolio's slug is drawn from. Every combination has to be
 * fine printed on a public link next to somebody's money, so the lists are
 * flavour words only — nothing about wealth, skill, or who the owner might be
 * (see AGENTS.md: auto-generated names must not embed identity).
 */
const ADJECTIVES = [
  'amber', 'ancient', 'bold', 'brave', 'breezy', 'bright', 'calm', 'cheerful',
  'clever', 'cosmic', 'cozy', 'crisp', 'curious', 'daring', 'dreamy', 'eager',
  'early', 'fancy', 'fearless', 'fluffy', 'frosty', 'gentle', 'glad', 'golden',
  'graceful', 'happy', 'hidden', 'humble', 'jolly', 'keen', 'kind', 'lively',
  'lucky', 'mellow', 'merry', 'mighty', 'misty', 'nimble', 'noble', 'patient',
  'peaceful', 'playful', 'polite', 'proud', 'quick', 'quiet', 'rapid', 'rustic',
  'shiny', 'silent', 'sleepy', 'smooth', 'snowy', 'solar', 'steady', 'sturdy',
  'sunny', 'swift', 'tidy', 'velvet', 'vivid', 'wandering', 'warm', 'wild',
];

const NOUNS = [
  'badger', 'bear', 'beaver', 'bison', 'crane', 'deer', 'dolphin', 'eagle',
  'falcon', 'ferret', 'finch', 'fox', 'gecko', 'hare', 'hawk', 'hedgehog',
  'heron', 'ibis', 'koala', 'lark', 'lemur', 'llama', 'lynx', 'marmot',
  'marten', 'mole', 'moose', 'narwhal', 'newt', 'otter', 'owl', 'panda',
  'parrot', 'pelican', 'penguin', 'pig', 'piglet', 'pony', 'puffin', 'quail',
  'rabbit', 'raccoon', 'raven', 'robin', 'salmon', 'seal', 'sparrow', 'squid',
  'stork', 'swallow', 'swan', 'swift', 'tapir', 'tiger', 'toucan', 'trout',
  'turtle', 'walrus', 'weasel', 'whale', 'wolf', 'wombat', 'wren', 'yak',
];

const pick = (words: string[]): string => words[randomInt(words.length)];

/**
 * A slug someone can read over the phone: "brave-copper-otter" beats
 * "k3j9x0q2mm". Two adjectives and a noun give ~260k combinations — plenty
 * until it isn't, so callers retry on a unique-constraint hit and pass the
 * attempt number: from the third try on, two digits join the party and the
 * space grows a hundredfold.
 */
export function wordSlug(attempt = 0): string {
  const base = `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
  return attempt < 2 ? base : `${base}-${randomInt(10, 100)}`;
}

/**
 * Slugs that are route literals — a portfolio living at /p/public would shadow
 * the public listing. wordSlug never produces a single word, so only a rename
 * has to check.
 */
export const RESERVED_SLUGS = new Set(['public', 'anonymous']);

/**
 * "DeFi Long Game" → "defi-long-game". The slug follows the name, so the link
 * says what the portfolio is called. English letters and digits survive;
 * everything else becomes a hyphen and collapses. Empty out means the name has
 * nothing a URL can carry — the caller decides what to tell the user.
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}
