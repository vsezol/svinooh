export type Network = 'sol';
export type Protocol = 'kamino';
export type PoolKind = 'vault' | 'reserve';

const NETWORKS = ['sol'];
const PROTOCOLS = ['kamino'];
const KINDS = ['vault', 'reserve'];

export interface PoolId {
  network: Network;
  protocol: Protocol;
  kind: PoolKind;
  address: string;
}

export const idOf = (id: PoolId): string =>
  `${id.network}:${id.protocol}:${id.kind}:${id.address}`;

export function parseId(raw: string): PoolId | null {
  const parts = raw.split(':');
  if (parts.length !== 4) return null;
  const [network, protocol, kind, address] = parts;
  if (!address) return null;
  if (!NETWORKS.includes(network) || !PROTOCOLS.includes(protocol) || !KINDS.includes(kind)) {
    return null;
  }
  return {
    network: network as Network,
    protocol: protocol as Protocol,
    kind: kind as PoolKind,
    address,
  };
}

export const isNetwork = (raw: string): raw is Network => NETWORKS.includes(raw);
export const isProtocol = (raw: string): raw is Protocol => PROTOCOLS.includes(raw);
export const isPoolKind = (raw: string): raw is PoolKind => KINDS.includes(raw);
