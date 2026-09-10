/**
 * Where to go once the sign-in completes — when it is not the portfolio.
 *
 * Signing in used to happen in one place, the landing, where landing on your
 * own portfolio afterwards is exactly right. The chat asks for an account
 * underneath your first answer, which is a different question: there you want
 * to stay in the conversation you just decided was worth keeping, and being
 * thrown onto a portfolio page loses it.
 *
 * A path rather than a callback, because one of the flows is a full-page
 * departure: X takes the browser to its own consent page and brings it back to
 * /auth/x/callback, so nothing held in a closure survives. sessionStorage
 * does, and it is the same trip the pending-claim intent already makes.
 *
 * Only ever a path on this origin — it is read back into router.replace, and a
 * value that could name another site would make this an open redirect.
 */
const KEY = 'svinooh_after_signin';

/** A path on this site: a leading slash, and no second one that could be a host. */
const ours = (path: string): boolean => /^\/(?!\/)/.test(path);

export function parkReturn(path: string): void {
  if (!ours(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // Storage refused: the sign-in still completes and lands on the default.
  }
}

/** Where to land, if somewhere was asked for. Spent on reading. */
export function takeReturn(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && ours(path) ? path : null;
  } catch {
    return null;
  }
}
