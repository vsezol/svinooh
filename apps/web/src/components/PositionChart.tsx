import { useEffect, useMemo, useState } from 'react';
import type { HistoryRange, PositionHistoryDto } from '@svinooh/shared';
import { api } from '../lib/api';
import { isPaywall } from '../lib/billing';
import { asChange, fmtChange, fmtUnits, positionLines } from '../lib/position-lines';
import { PERIODS } from '../lib/ranges';
import { Note, Segmented, Spinner } from '../ui';
import { AreaChart } from './AreaChart';
import { usePaywall } from './Paywall';

const ALL_TOKENS = 'ALL TOKENS';
const HEIGHT = 'clamp(160px,26vw,220px)';

interface Props {
  slug: string;
  walletId: string;
  positionKey: string;
  pair: string | null;
  title: string;
}

export function PositionChart({ slug, walletId, positionKey, pair, title }: Props) {
  const [period, setPeriod] = useState<HistoryRange>('7d');
  const [history, setHistory] = useState<PositionHistoryDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState(ALL_TOKENS);
  const { showPaywall } = usePaywall();

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const query = `key=${encodeURIComponent(positionKey)}&range=${period}`;
    api<PositionHistoryDto>(`/portfolios/${slug}/wallets/${walletId}/positions/history?${query}`)
      .then((loaded) => {
        if (!cancelled) setHistory(loaded);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isPaywall(err)) {
          showPaywall(err);
          setPeriod(history?.range ?? '24h');
        } else {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, walletId, positionKey, period]);

  const drawn = useMemo(() => (history ? positionLines(history, { pair, title }) : null), [history, pair, title]);
  const lines = drawn?.lines ?? [];
  const chosen = lines.length === 1 ? lines[0] : lines.find((line) => line.label === picked) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', padding: 'var(--sp-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        {lines.length > 1 ? (
          <Segmented
            label="Token"
            items={[ALL_TOKENS, ...lines.map((line) => line.label)].map((key) => ({ key, label: key.toUpperCase() }))}
            value={chosen ? chosen.label : ALL_TOKENS}
            onChange={setPicked}
          />
        ) : (
          <span />
        )}
        <Segmented label="Chart period" items={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {failed ? (
        <Note>Could not load the history of this position.</Note>
      ) : !drawn ? (
        <div style={{ height: HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </div>
      ) : drawn.times.length < 2 ? (
        <Note>Not enough history yet. Every scan from now on adds a point.</Note>
      ) : chosen ? (
        <AreaChart
          values={chosen.values}
          times={drawn.times}
          period={history?.range ?? period}
          height={HEIGHT}
          framed={false}
          tone={chosen.owed ? 'muted' : 'accent'}
          format={fmtUnits(chosen.unit)}
        />
      ) : (
        <AreaChart
          values={[]}
          lines={lines.map((line) => ({ label: line.label, values: asChange(line.values) }))}
          times={drawn.times}
          period={history?.range ?? period}
          height={HEIGHT}
          framed={false}
          format={fmtChange}
        />
      )}
    </div>
  );
}
