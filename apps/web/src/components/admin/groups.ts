import type { SettingDto } from '@svinooh/shared';

export interface SettingGroup {
  key: string;
  label: string;
  specs: SettingDto[];
}

/**
 * The groups worth naming, in the order they are worth reading. Anything the
 * registry declares outside these is machinery — real, occasionally necessary,
 * and not what anybody opens this tab for — so it goes in one card at the end
 * rather than earning a heading of its own.
 */
const NAMED = [
  { key: 'source', label: 'Where balances come from' },
  { key: 'sync', label: 'How often wallet data is refreshed' },
  { key: 'flows', label: 'Deposits and withdrawals (experimental)' },
  { key: 'billing', label: 'Svinooh.Pro: prices and the free plan' },
];

export function groupSettings(specs: SettingDto[]): SettingGroup[] {
  const named = new Set(NAMED.map((g) => g.key));
  return [
    ...NAMED.map((g) => ({ ...g, specs: specs.filter((s) => s.group === g.key) })),
    { key: 'rest', label: 'Machinery', specs: specs.filter((s) => !named.has(s.group)) },
  ].filter((group) => group.specs.length > 0);
}
