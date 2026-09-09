/**
 * How long ago, in as few words as say it.
 *
 * One implementation, because there are two rails drawing the same list of
 * conversations — the site's own sidebar and the standalone chat's — and they
 * had drifted: the same chat read "Just now" in one and "1m ago" in the other,
 * and a week-old one read "Sep 1" in one and "8d ago" in the other.
 *
 * Calendar-day arithmetic past the first hour, not 24-hour buckets: a chat
 * from last evening reads "Yesterday" even when it is only ten hours old,
 * because that is what a reader means by yesterday.
 */
export function relativeDay(at: number, now: number = Date.now()): string {
  const mins = Math.floor((now - at) / 60_000);
  const startOfDay = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) {
    if (mins < 60) return 'Just now';
    return `${Math.floor(mins / 60)}h ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
