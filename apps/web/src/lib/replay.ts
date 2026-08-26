import { useEffect, useState } from 'react';

/** How many of the most recent points the landing card plays back, and how fast */
const STEPS = 20;
const INTERVAL_MS = 3000;

/**
 * Plays the tail of a series back, one point every few seconds, and stops on
 * the last one.
 *
 * The landing card shows a real portfolio, and a still number does it no
 * favours — this walks through its most recent moves so the card has a pulse.
 * It plays once rather than looping: looping would keep winding the balance
 * backwards, while playing through leaves the card resting on the value that is
 * actually current.
 */
export function useReplay(values: number[]): { index: number; live: boolean } {
  const [step, setStep] = useState(0);
  const total = Math.min(STEPS, values.length);

  useEffect(() => {
    setStep(0);
    if (total < 2) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= total - 1) {
          window.clearInterval(id);
          return s;
        }
        return s + 1;
      });
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [total, values[values.length - 1]]);

  if (total < 2) return { index: values.length - 1, live: true };
  const index = values.length - total + step;
  return { index, live: step >= total - 1 };
}
