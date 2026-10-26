import { StatusLine } from './StatusLine';

/** The idle wait state before the first status arrives. */
export function ThinkingPulse() {
  return <StatusLine text="Thinking" />;
}
