import { useCallback, useEffect, useState } from 'react';
import type { AlertSettingsDto, UpdateWalletAlertsDto, WalletAlertsDto } from '@svinooh/shared';
import { api } from './api';

export type WalletAlerts = Omit<WalletAlertsDto, 'walletId'>;

/**
 * What a wallet is watched for until somebody says otherwise. These are the
 * server's defaults too — it answers for an unconfigured wallet rather than
 * leaving it out — and they live here only for the window before the first
 * answer arrives, and for the case where the endpoint is not there yet.
 */
export const ALERT_DEFAULTS: WalletAlerts = {
  rangeAlerts: true,
  healthFactorBelow: 1.1,
  borrowApyAbove: 12,
  tronReclaimAlerts: true,
  tronDelegateAlerts: true,
};

/**
 * Alert settings for the whole portfolio, keyed by wallet.
 *
 * Owner-only, so it is fetched apart from the portfolio itself rather than
 * riding along inside it — a shared link hands over the portfolio and must not
 * hand over this.
 *
 * A change is shown before it is saved and kept whether or not the save lands.
 * The alternative is a toggle that springs back under the finger, and a
 * threshold you have to type twice; and the write is a patch of one field, so
 * losing one is losing one, not losing the settings.
 */
export function useAlerts(slug: string, enabled: boolean) {
  const [byWallet, setByWallet] = useState<Record<string, WalletAlerts>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void api<AlertSettingsDto>(`/portfolios/${slug}/alerts`)
      .then((res) => {
        if (cancelled) return;
        const next: Record<string, WalletAlerts> = {};
        for (const { walletId, ...rest } of res.wallets) next[walletId] = rest;
        setByWallet(next);
      })
      // Nothing configured, or nothing serving this yet: every wallet falls back
      // to the defaults, which is what the server would have said anyway
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, enabled]);

  const settingsFor = useCallback(
    (walletId: string): WalletAlerts => byWallet[walletId] ?? ALERT_DEFAULTS,
    [byWallet],
  );

  const save = useCallback(
    (walletId: string, patch: UpdateWalletAlertsDto) => {
      setByWallet((prev) => ({
        ...prev,
        [walletId]: { ...(prev[walletId] ?? ALERT_DEFAULTS), ...patch },
      }));
      void api(`/portfolios/${slug}/wallets/${walletId}/alerts`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }).catch(() => {
        // Kept on screen regardless — see above
      });
    },
    [slug],
  );

  return { settingsFor, save, loaded };
}

/**
 * How many alerts a wallet is actually armed with — what the header counts.
 * A threshold nobody filled in is not an alert, however much room the setting
 * takes up on screen.
 */
export function armedCount(
  alerts: WalletAlerts,
  hasPools: boolean,
  hasLending: boolean,
  isTron = false,
): number {
  let n = 0;
  if (hasPools && alerts.rangeAlerts) n += 1;
  if (hasLending && alerts.healthFactorBelow !== null) n += 1;
  if (hasLending && alerts.borrowApyAbove !== null) n += 1;
  if (isTron && alerts.tronReclaimAlerts) n += 1;
  if (isTron && alerts.tronDelegateAlerts) n += 1;
  return n;
}

/** What the box holds → what the contract carries. Blank means nobody is watching. */
export function parseThreshold(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() === '' || !Number.isFinite(value) || value <= 0 ? null : value;
}
