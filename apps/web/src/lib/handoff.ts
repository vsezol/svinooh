/**
 * The first question, carried from the landing into the chat.
 *
 * The landing's composer is the app's front door: whatever is typed there is
 * the first message of a real conversation, and by the time the chat appears
 * the question is already in the log with an answer on its way. The two are
 * separate routes, so the question has to survive one navigation.
 *
 * Not in the URL. The first thing a lot of people will type here is a wallet
 * address, and a `?q=` would write it into their history, hand it to whatever
 * they navigate to next as a referrer, and put it in every log line that
 * records a path. sessionStorage never leaves the tab.
 *
 * Read and cleared in two steps, not one. A question is asked once — a reload
 * of /ai is a fresh chat rather than the same question again — but the read
 * happens while a component is rendering, and a render may run twice for the
 * same commit. A read that also removed would then answer the question on the
 * first run and undefined on the second, and which of those React kept would
 * decide whether the hand-off worked. So the read is pure and the clearing is
 * an effect.
 */
const KEY = 'svinooh_first_question';

/** More than a question and less than a paste-bomb. */
const MAX = 2000;

export function parkQuestion(text: string): void {
  try {
    sessionStorage.setItem(KEY, text.slice(0, MAX));
  } catch {
    // Private mode, or storage switched off. The chat opens empty and the
    // visitor types the question again, which is the old behaviour.
  }
}

/** What is parked, if anything. Safe to call as many times as it takes. */
export function peekQuestion(): string | undefined {
  try {
    return sessionStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** Spent. Called once the chat has it. */
export function clearQuestion(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was parked in the first place.
  }
}
