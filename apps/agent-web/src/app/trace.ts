/**
 * The receipt for a wait, as data.
 *
 * Nothing here draws anything and nothing here knows about React: it turns the
 * events a turn reported about itself into the block the renderer takes. Its
 * own module because the arithmetic in it — what counts as a duration worth
 * reading, and what a step that has not finished says — is the part that goes
 * quietly wrong, and this way it can be tested without a browser.
 */
import type { TraceBlock } from './types';
import type { StepEvent } from './wire';

/**
 * How long something took, with enough precision to have taken any time.
 *
 * Under a second it is read to the hundredth: a step that finished in forty
 * milliseconds said "0.0s", which reads as took no time at all rather than as
 * was fast, and a whole trace of those reads as a trace of nothing happening.
 */
export function secs(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)}s`;
}

/**
 * The steps a turn reported, as a block.
 *
 * Every row here is an operation that ran: the id is the one the service used,
 * the label is what that operation said about itself, and the time is what it
 * actually took. Nothing is added to make the list look busier.
 *
 * A running step counts up from when its line appeared. That number is this
 * side's rather than the service's on purpose — what somebody watching wants
 * to know is how long they have been waiting, and a line that sits there with
 * a spinner and no number is the thing that reads as frozen.
 *
 * A call that failed stays failed. Folding it into "done" drew a tick over a
 * tool that never answered, and the model's retry underneath it read as the
 * same work done twice.
 */
export function traceOf(steps: StepEvent[], collapsed: boolean, now: number): TraceBlock {
  const ms = steps.reduce((sum, step) => sum + (step.ms ?? 0), 0);
  const running = (step: StepEvent) =>
    step.startedAt === undefined || now === 0 ? undefined : secs(Math.max(0, now - step.startedAt));
  return {
    kind: 'trace',
    collapsed,
    summary: `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} · ${secs(ms)}`,
    failed: steps.some((step) => step.state === 'failed'),
    steps: steps.map((step) => ({
      label: step.label ?? step.id,
      state: step.state,
      detail: step.detail,
      time: step.ms === undefined ? running(step) : secs(step.ms),
    })),
  };
}
