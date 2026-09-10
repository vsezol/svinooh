/**
 * The conversation the landing has with itself.
 *
 * The hero's field is a real input — whatever is typed into it is the first
 * question of a real chat. While nobody is typing, it demonstrates instead: a
 * question types itself in, the tool trace runs underneath, the answer lands
 * and holds, and then the next question starts typing over the last answer.
 *
 * Three scenes, and they are deliberately not three phrasings of the same
 * question. One reads what you hold, one is a judgement call about a position,
 * one asks the agent to do something with idle money — which is the whole
 * product in three sentences, in the order it grows into.
 *
 * Everything below is a pure function of elapsed milliseconds. Nothing here
 * counts frames, holds a timer or keeps state: a throttled tab, a re-render
 * and a fresh mount all read the same frame for the same instant, and the
 * panel never ends up half a scene behind the caret.
 */

export interface DemoCard {
  label: string;
  value: string;
  delta: string;
  /** The kit's own tones — these are drawn by Stat, not by a copy of it. */
  tone: 'up' | 'down' | 'flat';
}

/** A pool's bounds and where the price is, as the portfolio's own scale reads them. */
export interface DemoRange {
  /** How the position is named on screen: "Meteora · SOL/USDC" */
  name: string;
  lower: number;
  upper: number;
  current: number;
  /** Which verdict the card carries, and which colour the whole scale takes. */
  inRange: boolean;
}

export interface DemoScene {
  /** The question, typed in one character at a time. */
  q: string;
  /** One line per tool call, in the order they run. */
  steps: string[];
  /** The answer. Backticks mark what should read as a figure, in mono. */
  answer: string;
  /** The block that comes with the answer — at most one, per scene. */
  cards?: DemoCard[];
  range?: DemoRange;
  action?: boolean;
}

export const SCENES: readonly DemoScene[] = [
  {
    q: 'what changed this week?',
    steps: ['Reading 4 wallets', 'Pricing 11 positions', 'Comparing to last week'],
    answer: 'Up `$7,522` this week — almost all of it ETH price. Your positions barely moved.',
    cards: [
      { label: 'TOTAL', value: '$131,902', delta: '+6.05% · 7D', tone: 'up' },
      { label: 'CLAIMABLE', value: '$612', delta: '+$88', tone: 'up' },
      { label: 'DEBT', value: '−$7,800', delta: '5.8% APY', tone: 'flat' },
    ],
  },
  {
    q: 'any of my LPs out of range?',
    steps: ['Scanning 3 pools', 'Checking tick ranges'],
    answer:
      'None — all three are in range. `Meteora SOL/USDC` is the closest to its edge, `$188.40` against an upper bound of `$196.00`.',
    range: { name: 'Meteora · SOL/USDC', lower: 142, upper: 196, current: 188.4, inRange: true },
  },
  {
    q: 'put my idle 4,200 USDC to work, low risk',
    steps: ['Finding idle stables', 'Comparing lending rates', 'Checking audits and caps'],
    answer:
      '`Aave V3` on Arbitrum pays `6.8%` on USDC, withdrawable any time. Nothing moves until you sign.',
    action: true,
  },
];

/** How fast the question types itself, per character. */
const TYPE_MS = 55;
/** How long a finished answer stays up before the next question starts. */
const HOLD_MS = 4200;
/** What the trace costs: a fixed round trip, plus a step's worth per step. */
const WORK_MS = 900;
const WORK_PER_STEP_MS = 220;

const typeMs = (scene: DemoScene): number => scene.q.length * TYPE_MS;
const workMs = (scene: DemoScene): number => WORK_MS + scene.steps.length * WORK_PER_STEP_MS;

/** How long one scene runs, start to start. */
export const sceneMs = (scene: DemoScene): number => typeMs(scene) + workMs(scene) + HOLD_MS;

const CYCLE_MS = SCENES.reduce((sum, scene) => sum + sceneMs(scene), 0);

/**
 * Where the cycle starts, which is not where it begins.
 *
 * At its own zero the first question has not been typed yet, so the panel
 * under the field would be showing the LAST scene's answer — the proposed
 * transaction, the tallest card here — for the first second and a half of
 * everybody's first visit, and then swapping it. So the clock is offset to
 * land on the first scene answered and holding: the page opens on a finished
 * question with its answer under it, and the second question is the first
 * thing that moves.
 */
const ORIGIN_MS = typeMs(SCENES[0]) + workMs(SCENES[0]);

export type StepState = 'waiting' | 'running' | 'done';

export interface DemoFrame {
  /** Which scene the caret is typing, and which chip is lit. */
  index: number;
  /** How much of that scene's question is in the field. */
  typed: string;
  /** The trace, while it is running. Empty otherwise. */
  steps: { label: string; state: StepState }[];
  /**
   * The answer on screen. While the next question types, this is still the
   * PREVIOUS scene's — which is what keeps the panel from ever being empty,
   * or from changing height between scenes.
   */
  shown: DemoScene;
  /** Whether that answer is the outgoing one, on its way out at 30%. */
  fading: boolean;
  /** Whether the trace is what the panel is showing rather than an answer. */
  working: boolean;
}

/**
 * Where in the cycle a given instant falls.
 *
 * A chip that was clicked wins for exactly as long as its own scene runs, and
 * then the loop picks up again from wherever the clock has got to. Which means
 * a click never has to stop or restart anything — the cycle keeps running
 * underneath, and the pick is a window laid over it.
 */
function at(t: number, pick?: { index: number; at: number }): { index: number; local: number } {
  if (pick) {
    const local = Math.max(0, t - pick.at);
    if (local < sceneMs(SCENES[pick.index])) return { index: pick.index, local };
  }
  let rest = t % CYCLE_MS;
  let index = 0;
  while (rest >= sceneMs(SCENES[index])) {
    rest -= sceneMs(SCENES[index]);
    index += 1;
  }
  return { index, local: rest };
}

/**
 * The whole panel for one instant.
 *
 * `t` is milliseconds since the page started moving; `pick` is the chip
 * somebody pressed and when they pressed it.
 */
export function demoFrame(t: number, pick?: { index: number; at: number }): DemoFrame {
  // Both are moved into cycle time together, so a pick's own window stays the
  // length of its scene rather than being shifted by the offset.
  const { index, local } = at(t + ORIGIN_MS, pick && { ...pick, at: pick.at + ORIGIN_MS });
  const scene = SCENES[index];
  const typing = local < typeMs(scene);
  const working = !typing && local < typeMs(scene) + workMs(scene);

  const per = workMs(scene) / scene.steps.length;
  const elapsed = local - typeMs(scene);

  return {
    index,
    typed: scene.q.slice(0, Math.min(scene.q.length, Math.floor(local / TYPE_MS))),
    steps: !working
      ? []
      : scene.steps.map((label, i) => ({
          label,
          state: elapsed >= (i + 1) * per ? 'done' : elapsed >= i * per ? 'running' : 'waiting',
        })),
    // The scene before this one — the answer that is still on screen while
    // this one's question is being typed.
    shown: typing ? SCENES[(index + SCENES.length - 1) % SCENES.length] : scene,
    fading: typing,
    working,
  };
}

/**
 * Where the cycle sits still: zero, now that zero is the first answer.
 *
 * For a reader who has asked their system for less movement. A frozen frame of
 * a half-typed question with a spinner in it would look broken rather than
 * calm, which is what the offset above already fixed for everybody else.
 */
export const DEMO_AT_REST = 0;

/**
 * An answer split into what reads as prose and what reads as a figure.
 *
 * Backticks in the copy above, mono in the result. Money, percentages and
 * protocol names are set in the mono face everywhere else in the product, and
 * an answer is the one place they arrive inside a sentence.
 */
export function parts(answer: string): { text: string; mono: boolean }[] {
  const out: { text: string; mono: boolean }[] = [];
  const push = (text: string, mono: boolean) => {
    if (text) out.push({ text, mono });
  };
  let last = 0;
  const re = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    push(answer.slice(last, match.index), false);
    push(match[1], true);
    last = re.lastIndex;
  }
  push(answer.slice(last), false);
  return out;
}
