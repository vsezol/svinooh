'use client';

import { useState } from 'react';
import type { WalletDto } from '@svinooh/shared';
import { blockMatches, buildBlocks } from '../lib/blocks';
import { armedCount, parseThreshold, useAlerts, type WalletAlerts } from '../lib/alerts';
import { walletName } from '../lib/format';
import { Card, Chevron, Display, Eyebrow, Note, NumberField, Switch, Tag } from '../ui';

/** A setting and the control that changes it, on one line */
function Setting({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 11 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body)' }}>{title}</div>
        <Note style={{ marginTop: 'var(--sp-1)' }}>{note}</Note>
      </div>
      {children}
    </div>
  );
}

/**
 * A threshold, typed.
 *
 * All of the behaviour — held as text while it is being edited, committed on
 * blur and on Enter, discarded on Escape, and never sent twice for one Enter —
 * is NumberField's. What is left here is what makes it a threshold: the digit
 * filter, the parse, and the unit sitting inside the box.
 */
function Threshold({
  value,
  suffix,
  label,
  onCommit,
}: {
  value: number | null;
  suffix?: string;
  label: string;
  onCommit: (value: number | null) => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <NumberField
        mono
        size="md"
        shape="box"
        aria-label={label}
        inputMode="decimal"
        spellCheck={false}
        value={value}
        parse={parseThreshold}
        // Digits and ONE point: "8.0.5" is not a number, and Number() turns it
        // into NaN, which cleared the field on somebody who was only mistyping
        clean={(raw) => raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')}
        onCommit={onCommit}
        style={{ width: 86, paddingRight: suffix ? 26 : undefined }}
      />
      {suffix ? (
        <span
          className="mono"
          style={{
            position: 'absolute',
            right: 11,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 'var(--fs-note)',
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

/** One group of settings, under the heading that says what they are about */
function Group({ title, first, children }: { title: string; first: boolean; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderTop: first ? 'none' : '1px solid var(--line)' }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
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
  const name = walletName(wallet.label, wallet.chain);

  return (
    <Card style={{ overflow: 'hidden' }}>
      <button
        className="row-hover"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-5)',
          padding: '14px 16px',
          width: '100%',
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          textAlign: 'left',
          font: 'inherit',
          userSelect: 'none',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-lead)' }}>{name}</span>
            <Tag variant="outline" size="sm" style={{ height: 20, padding: '0 var(--sp-4)' }}>
              {wallet.chain}
            </Tag>
          </div>
          <div className="mono" style={{ fontSize: 'var(--fs-note)', color: 'var(--mut)', marginTop: 'var(--sp-2)' }}>
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
          {armed ? `${armed} ${armed === 1 ? 'ALERT' : 'ALERTS'}` : ''}
        </span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          {hasPools ? (
            <Group title="POOLS" first>
              <Setting title="Range alerts" note="When an LP position exits or re-enters its liquidity range">
                <Switch
                  on={alerts.rangeAlerts}
                  onChange={(rangeAlerts) => onChange({ rangeAlerts })}
                  label={`Range alerts for ${name}`}
                />
              </Setting>
            </Group>
          ) : null}

          {hasLending ? (
            <Group title="LENDING" first={!hasPools}>
              <Setting title="Health factor below" note="Alert when liquidation risk grows past this threshold">
                <Threshold
                  label={`Health factor threshold for ${name}`}
                  value={alerts.healthFactorBelow}
                  onCommit={(healthFactorBelow) => onChange({ healthFactorBelow })}
                />
              </Setting>
              <Setting title="Borrow APY above" note="Alert when your loan rate climbs past this threshold">
                <Threshold
                  label={`Borrow APY threshold for ${name}`}
                  value={alerts.borrowApyAbove}
                  suffix="%"
                  onCommit={(borrowApyAbove) => onChange({ borrowApyAbove })}
                />
              </Setting>
            </Group>
          ) : null}

          {isTron ? (
            <Group title="RESOURCES" first={!hasPools && !hasLending}>
              <Setting title="Delegation unlocked" note="When resources you delegated can be taken back">
                <Switch
                  on={alerts.tronReclaimAlerts}
                  onChange={(tronReclaimAlerts) => onChange({ tronReclaimAlerts })}
                  label={`Delegation alerts for ${name}`}
                />
              </Setting>
              <Setting title="Resources idle" note="When energy and bandwidth are free and nothing is delegated">
                <Switch
                  on={alerts.tronDelegateAlerts}
                  onChange={(tronDelegateAlerts) => onChange({ tronDelegateAlerts })}
                  label={`Idle resource alerts for ${name}`}
                />
              </Setting>
            </Group>
          ) : null}

          {!hasPools && !hasLending && !isTron ? (
            <Note style={{ padding: '14px 16px' }}>No DeFi positions to monitor in this wallet yet.</Note>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The notifications tab: one card per wallet, each one holding what that wallet
 * is watched for. A wallet still on its first sync is left out — what it holds
 * decides which settings it even has, and until it has told us, nothing here
 * would be right.
 */
export function AlertSettings({
  slug,
  wallets,
  syncMinutes,
}: {
  slug: string;
  wallets: WalletDto[];
  syncMinutes: number;
}) {
  const { settingsFor, save } = useAlerts(slug, true);
  const ready = wallets.filter((w) => w.status !== 'pending');

  return (
    <div>
      <Eyebrow>NOTIFICATIONS</Eyebrow>
      <Display style={{ marginTop: 'var(--sp-3)' }}>Alert settings</Display>
      <div
        style={{
          fontSize: 'var(--fs-body)',
          color: 'var(--mut)',
          marginTop: 'var(--sp-3)',
          lineHeight: 1.6,
          maxWidth: 480,
        }}
      >
        Per-wallet alerts, delivered to your Telegram. Checked on every {syncMinutes}-minute sync.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', marginTop: 'var(--sp-6)' }}>
        {ready.length === 0 ? (
          <Card
            style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mut)', fontSize: 'var(--fs-body)' }}
          >
            {wallets.length === 0
              ? 'No wallets yet. Add one on the portfolio tab and its alerts appear here.'
              : 'Still reading these wallets — their alerts appear once the first sync lands.'}
          </Card>
        ) : (
          ready.map((w) => (
            <WalletCard key={w.id} wallet={w} alerts={settingsFor(w.id)} onChange={(patch) => save(w.id, patch)} />
          ))
        )}
      </div>
    </div>
  );
}
