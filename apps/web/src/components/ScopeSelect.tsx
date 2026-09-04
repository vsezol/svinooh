import { Select } from '../ui';
import { fmtUsd } from '../lib/format';

export interface ScopeOption {
  id: string;
  label: string;
  valueUsd: number | null;
}

/**
 * Which wallet the headline and the chart are showing. A chip per wallet used
 * up two or three rows above the chart on a real portfolio; a dropdown says the
 * same thing in one line and has room to show each wallet's value next to it.
 */
export function ScopeSelect({
  options,
  value,
  onChange,
}: {
  options: ScopeOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select
      label="Which wallet to show"
      value={value}
      onChange={onChange}
      options={options.map((o) => ({
        value: o.id,
        label: o.label,
        hint: (
          <span className="mono" style={{ fontSize: 'var(--fs-tag)', color: 'var(--mut)', whiteSpace: 'nowrap' }}>
            {o.valueUsd === null ? '\u2014' : fmtUsd(o.valueUsd, 0)}
          </span>
        ),
      }))}
      placeholder="ALL WALLETS"
      minMenuWidth={250}
      triggerStyle={{
        height: 'var(--h-sm)',
        borderRadius: 'var(--r-full)',
        background: 'transparent',
        fontSize: 'var(--fs-note)',
        fontWeight: 'var(--fw-bold)',
        maxWidth: '100%',
      }}
    />
  );
}
