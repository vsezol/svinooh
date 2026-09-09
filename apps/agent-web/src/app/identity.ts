/**
 * Who this browser is, before it is anybody.
 *
 * The service can only keep a conversation for somebody if it can key it on
 * somebody, and that has to work before there is an account — the whole
 * premise of the front door is that you get an answer without signing up. So
 * the browser makes an id, keeps it, and sends it with every request.
 *
 * It is a soft identity by construction. Clearing site data or opening a
 * private window is a new person, and that is understood rather than worked
 * around: this is what history hangs on, never what a limit is enforced by.
 * A limit wants an account behind it, which is why the service charges every
 * anonymous caller to one shared budget rather than to this.
 *
 * --- Coordination note ---------------------------------------------------
 * This is step 3 part 1 of ROADMAP.md, which belongs to a separate branch.
 * Parts 2 and 3 cannot store or address a conversation without it, so the
 * smallest version lives here, in one file, deliberately easy to replace: the
 * header name and the id's shape are the entire contract, and the service
 * validates the shape rather than the format (app/owner.py).
 * -------------------------------------------------------------------------
 */

const KEY = 'svinooh_agent_id_v1';

/** The header the id rides on. The service names the same string. */
export const ANON_HEADER = 'X-Svinooh-Anon-Id';

/**
 * A 32-character hex id.
 *
 * `crypto.randomUUID` needs a secure context and this widget is embedded in
 * hosts we do not control, so the fallback is not decoration — but it is only
 * ever used for a name to file conversations under, never for anything a
 * weaker random would matter to.
 */
function mint(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32);
}

/** Only what the service will accept — see the same rule in app/owner.py. */
function usable(value: string | null): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

let cached: string | null = null;

/**
 * This browser's id, made on first use and kept.
 *
 * Held in a module variable as well as in storage: localStorage throws in some
 * in-app browsers and is empty in private mode, and a visitor whose id changed
 * between two questions in one sitting would watch their conversation split in
 * half. Storage failing costs them the id when the tab closes; it must not
 * cost them the tab they are in.
 */
export function anonId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (usable(stored)) return (cached = stored);
  } catch {
    // Blocked storage — the id lives for this page instead.
  }
  cached = mint();
  try {
    localStorage.setItem(KEY, cached);
  } catch {
    // As above: it works for this visit and is minted again on the next.
  }
  return cached;
}

/** The identity header, ready to spread into a fetch. */
export function identityHeaders(): Record<string, string> {
  return { [ANON_HEADER]: anonId() };
}
