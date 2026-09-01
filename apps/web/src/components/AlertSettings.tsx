'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { WalletDto } from '@svinooh/shared';
import { blockMatches, buildBlocks } from '../lib/blocks';
import { armedCount, parseThreshold, useAlerts, type WalletAlerts } from '../lib/alerts';
import { walletName } from '../lib/format';

const EYEBROW: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  color: 'var(--mut)',
};

const SETTING_TITLE: CSSProperties = { fontWeight: 700, fontSize: 13.5 };
const SETTING_NOTE: CSSProperties = { fontSize: 12, color: 'var(--mut)', marginTop: 2, lineHeight: 1.5 };

const FIELD: CSSProperties = {
  width: 86,
  height: 36,
  textAlign: 'right',
  background: 'var(--surf2)',
  border: '1px solid var(--line2)',
  borderRadius: 10,
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
};

/** A setting and the control that changes it, on one line */
function Row({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 11 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={SETTING_TITLE}>{title}</div>
        <div style={SETTING_NOTE}>{note}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        background: on ? 'var(--acc)' : 'var(--line2)',
        padding: 3,
        cursor: 'pointer',
        transition: 'background 0.18s ease',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: on ? 'var(--acc-ink)' : 'var(--surf)',
          transform: on ? 'translateX(18px)' : 'none',
          transition: 'transform 0.18s ease',
        }}
      />
    </div>
  );
}

/**
 * A threshold, typed. It is held as text while it is being typed — "1." is not a
 * number and neither is an empty box, and rewriting either into one under the
 * cursor is how a field stops letting you clear it. What is typed is committed
 * when the field is left, and an empty box means nobody is watching.
 */
function Threshold({
  value,
  suffix,
  onCommit,
}: {
  value: number | null;
  suffix?: string;
  onCommit: (value: number | null) => void;
}) {
  const asText = value === null ? '' : String(value);
  const [draft, setDraft] = useState(asText);

  // Somebody else's change to the same setting — another tab, a reload — wins
  // over a draft nobody is holding
  useEffect(() => setDraft(asText), [asText]);

  /**
   * The last value actually sent. Enter commits and then blurs, and the blur
   * commits again before the parent's state has come back round — without this
   * every value confirmed with Enter was saved twice.
   */
  const sent = useRef(value);
  useEffect(() => {
    sent.current = value;
  }, [value]);

  const commit = (raw: string = draft) => {
    const parsed = parseThreshold(raw);
    setDraft(parsed === null ? '' : String(parsed));
    if (parsed === sent.current) return;
    sent.current = parsed;
    onCommit(parsed);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="mono field-flat"
        value={draft}
        // Digits and ONE point: "8.0.5" is not a number, and Number() turns it
        // into NaN, which cleared the field on somebody who was only mistyping
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          // Enter saves, and does so ITSELF. It used to only call blur() and
          // leave the saving to the blur handler — which meant a value typed and
          // confirmed with Enter could sit on screen, looking committed, having
          // never been sent anywhere.
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          }
          // Escape puts back what was there, rather than committing a half-typed
          // number nobody meant
          if (e.key === 'Escape') {
            setDraft(asText);
            e.currentTarget.blur();
          }
        }}
        inputMode="decimal"
        spellCheck={false}
        style={{ ...FIELD, paddingRight: suffix ? 26 : 12 }}
      />
      {suffix ? (
        <span
          className="mono"
          style={{
            position: 'absolute',
            right: 11,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 12,
            color: 'var(--mut)',
            pointerEvents: 'none',
          }}
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

function WalletCard({
  wallet,
  alerts,
  onChange,
}: {
  wallet: WalletDto;
  alerts: WalletAlerts;
  onChange: (patch: Partial<WalletAlerts>) => void;
}) {
  const [open, setOpen] = useState(true);

  const blocks = buildBlocks(wallet.positions);
  const hasPools = blocks.some((b) => blockMatches(b, 'pools'));
  const hasLending = blocks.some((b) => blockMatches(b, 'lending'));
  // Tron's two are about the wallet's resources, not about anything it holds, so
  // the chain is what decides whether they apply — a Tron wallet with no
  // positions at all still has energy, bandwidth and delegations to watch
  const isTron = wallet.chain === 'TRON';
  const armed = armedCount(alerts, hasPools, hasLending, isTron);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surf)', overflow: 'hidden' }}>
      <div
        className="row-hover"
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{walletName(wallet.label, wallet.chain)}</span>
            <span
              className="mono"
              style={{
                fontSize: 9.5,
                letterSpacing: '0.08em',
                color: 'var(--mut)',
                border: '1px solid var(--line2)',
                borderRadius: 6,
                padding: '2px 7px',
              }}
            >
              {wallet.chain}
            </span>
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 4 }}>
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--mut)' }}>
          {armed ? `${armed} ${armed === 1 ? 'ALERT' : 'ALERTS'}` : ''}
        </span>
        <div
          style={{
            width: 8,
            height: 8,
            borderRight: '1.5px solid var(--mut)',
            borderBottom: '1.5px solid var(--mut)',
            transform: open ? 'rotate(225deg) translate(-2px,-2px)' : 'rotate(45deg)',
            transition: 'transform 0.18s ease',
            flexShrink: 0,
            marginLeft: 2,
          }}
        />
      </div>

      {open ? (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          {hasPools ? (
            <div style={{ padding: '14px 16px' }}>
              <div className="mono" style={EYEBROW}>
                POOLS
              </div>
              <Row title="Range alerts" note="When an LP position exits or re-enters its liquidity range">
                <Toggle on={alerts.rangeAlerts} onChange={(rangeAlerts) => onChange({ rangeAlerts })} />
              </Row>
            </div>
          ) : null}

          {hasLending ? (
            <div style={{ padding: '14px 16px', borderTop: hasPools ? '1px solid var(--line)' : 'none' }}>
              <div className="mono" style={EYEBROW}>
                LENDING
              </div>
              <Row title="Health factor below" note="Alert when liquidation risk grows past this threshold">
                <Threshold
                  value={alerts.healthFactorBelow}
                  onCommit={(healthFactorBelow) => onChange({ healthFactorBelow })}
                />
              </Row>
              <Row title="Borrow APY above" note="Alert when your loan rate climbs past this threshold">
                <Threshold
                  value={alerts.borrowApyAbove}
                  suffix="%"
                  onCommit={(borrowApyAbove) => onChange({ borrowApyAbove })}
                />
              </Row>
            </div>
          ) : null}

          {isTron ? (
            <div
              style={{
                padding: '14px 16px',
                borderTop: hasPools || hasLending ? '1px solid var(--line)' : 'none',
              }}
            >
              <div className="mono" style={EYEBROW}>
                RESOURCES
              </div>
              <Row
                title="Delegation unlocked"
                note="When resources you delegated can be taken back"
              >
                <Toggle
                  on={alerts.tronReclaimAlerts}
                  onChange={(tronReclaimAlerts) => onChange({ tronReclaimAlerts })}
                />
              </Row>
              <Row
                title="Resources idle"
                note="When energy and bandwidth are free and nothing is delegated"
              >
                <Toggle
                  on={alerts.tronDelegateAlerts}
                  onChange={(tronDelegateAlerts) => onChange({ tronDelegateAlerts })}
                />
              </Row>
            </div>
          ) : null}

          {!hasPools && !hasLending && !isTron ? (
            <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--mut)' }}>
              No DeFi positions to monitor in this wallet yet.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The notifications tab: one card per wallet, each one holding what that wallet
 * is watched for. A wallet still on its first sync is left out — what it holds
 * decides which settings it even has, and until it has told us, nothing here
 * would be right.
 */
export function AlertSettings({ slug, wallets, syncMinutes }: { slug: string; wallets: WalletDto[]; syncMinutes: number }) {
  const { settingsFor, save } = useAlerts(slug, true);
  const ready = wallets.filter((w) => w.status !== 'pending');

  return (
    <div>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--mut)' }}>
        NOTIFICATIONS
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', marginTop: 6 }}>Alert settings</div>
      <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 6, lineHeight: 1.6, maxWidth: 480 }}>
        Per-wallet alerts, delivered to your Telegram. Checked on every {syncMinutes}-minute sync.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
        {ready.length === 0 ? (
          <div
            className="card"
            style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}
          >
            {wallets.length === 0
              ? 'No wallets yet. Add one on the portfolio tab and its alerts appear here.'
              : 'Still reading these wallets — their alerts appear once the first sync lands.'}
          </div>
        ) : (
          ready.map((w) => (
            <WalletCard
              key={w.id}
              wallet={w}
              alerts={settingsFor(w.id)}
              onChange={(patch) => save(w.id, patch)}
            />
          ))
        )}
      </div>
    </div>
  );
}
