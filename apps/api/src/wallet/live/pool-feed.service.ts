import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { config } from '../../config';
import { solanaRpc } from '../scanners/defi/solana-rpc';

/** What arrives, and from which account */
export type AccountListener = (account: string, data: Buffer) => void;

const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 60_000;

/**
 * A connection that has heard nothing for this long is treated as gone.
 *
 * A socket the other end dropped without a close frame looks exactly like a
 * quiet pool, and this feature's whole failure mode is silence: nothing throws,
 * nothing logs, and the alerts simply stop being fast. Ten minutes is longer
 * than any pool worth watching stays still — they are pools somebody has money
 * in — and a needless reconnect costs one resubscribe.
 */
const SILENCE_MS = 10 * 60_000;

/** How many accounts one getMultipleAccounts may name */
const READ_BATCH = 100;

interface Reply {
  id?: number;
  result?: unknown;
  error?: unknown;
  method?: string;
  params?: {
    subscription?: number;
    result?: { context?: { slot?: number }; value?: { data?: [string, string] } };
  };
}

interface Accounts {
  context: { slot: number };
  value: Array<{ data: [string, string] } | null>;
}

/**
 * Solana accounts, pushed as they change.
 *
 * One socket, `accountSubscribe` per account, and a callback with the bytes.
 * It knows nothing about pools, positions or wallets — it is the transport,
 * and what the bytes mean is the watch's business.
 *
 * Subscription ids belong to the CONNECTION: a reconnect invalidates every one
 * of them, which is why they are dropped on close and asked for again on open,
 * rather than being remembered across a gap and quietly pointing at nothing.
 *
 * Nothing here throws. The feed going down means alerts fall back to the pace
 * the scan pipeline sets, which is what they ran at before any of this existed.
 */
@Injectable()
export class PoolFeed implements OnApplicationShutdown {
  private readonly logger = new Logger(PoolFeed.name);
  private socket: WebSocket | null = null;
  private wanted = new Set<string>();
  /** account → live subscription id */
  private subscribed = new Map<string, number>();
  private byId = new Map<number, string>();
  /** request id → the account we asked about, until the reply comes back */
  private asked = new Map<number, string>();
  private nextRequest = 1;
  private retryMs = FIRST_RETRY_MS;
  private retry: NodeJS.Timeout | null = null;
  private heardAt = 0;
  /** account → the slot of the newest state handed on, so nothing older follows it */
  private slots = new Map<string, number>();
  /** accounts subscribed since the last read of their current state */
  private unread = new Set<string>();
  private reading = false;
  private stopped = false;
  private listener: AccountListener = () => {};

  onAccount(listener: AccountListener): void {
    this.listener = listener;
  }

  /**
   * Listen to exactly these accounts, and to nothing else.
   *
   * Called with the whole set every time rather than as add/remove, so the
   * socket cannot drift away from what the watch believes it is hearing.
   */
  watch(accounts: string[]): void {
    this.wanted = new Set(accounts);
    for (const account of [...this.slots.keys()]) if (!this.wanted.has(account)) this.slots.delete(account);
    if (!this.wanted.size) {
      this.drop();
      return;
    }
    this.connect();
    this.reconcile();
  }

  /**
   * A socket nobody has heard from in a while is replaced. On its own clock,
   * once a minute, rather than riding on the watch's reconcile: that runs every
   * few minutes, and a dead socket would have been dead for all of them.
   */
  @Interval('live-feed-silence', 60_000)
  checkSilence(): void {
    if (!this.socket || !this.heardAt || Date.now() - this.heardAt <= SILENCE_MS) return;
    this.logger.warn(`nothing heard for ${Math.round((Date.now() - this.heardAt) / 60_000)}m — reconnecting`);
    this.drop();
    this.connect();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    this.drop();
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    this.logger.log(`connecting to ${config.solanaWsUrl}`);
    const socket = new WebSocket(config.solanaWsUrl);
    this.socket = socket;
    this.heardAt = Date.now();
    socket.onopen = () => {
      this.retryMs = FIRST_RETRY_MS;
      this.heardAt = Date.now();
      this.reconcile();
    };
    socket.onmessage = (event: MessageEvent) => this.take(event.data);
    // A failure arrives as an error and then a close; the close is what acts
    socket.onerror = () => this.logger.warn('socket error');
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.forget();
      if (this.stopped || !this.wanted.size) return;
      this.retry = setTimeout(() => {
        this.retry = null;
        this.connect();
        this.reconcile();
      }, this.retryMs);
      this.logger.warn(`socket closed — retrying in ${Math.round(this.retryMs / 1000)}s`);
      this.retryMs = Math.min(this.retryMs * 2, LAST_RETRY_MS);
    };
  }

  /** Ask for what is missing, let go of what nobody wants any more */
  private reconcile(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const pending = new Set(this.asked.values());

    for (const account of this.wanted) {
      if (this.subscribed.has(account) || pending.has(account)) continue;
      const id = this.nextRequest++;
      this.asked.set(id, account);
      this.send({
        jsonrpc: '2.0',
        id,
        method: 'accountSubscribe',
        // `confirmed` rather than `processed`: a bin the network has not agreed
        // on yet is a crossing that can be taken back, and the second or two it
        // costs is nothing against the minutes this exists to save
        params: [account, { encoding: 'base64', commitment: 'confirmed' }],
      });
    }

    for (const [account, subscription] of [...this.subscribed]) {
      if (this.wanted.has(account)) continue;
      this.subscribed.delete(account);
      this.byId.delete(subscription);
      this.send({
        jsonrpc: '2.0',
        id: this.nextRequest++,
        method: 'accountUnsubscribe',
        params: [subscription],
      });
    }
  }

  private send(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch (error) {
      this.logger.warn(`could not send: ${(error as Error).message}`);
    }
  }

  private take(raw: unknown): void {
    this.heardAt = Date.now();
    let message: Reply;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as Reply;
    } catch {
      return;
    }

    if (message.method === 'accountNotification') {
      const account = this.byId.get(message.params?.subscription ?? -1);
      const encoded = message.params?.result?.value?.data?.[0];
      if (account && typeof encoded === 'string') {
        this.hand(account, message.params?.result?.context?.slot ?? 0, encoded);
      }
      return;
    }

    const account = message.id === undefined ? undefined : this.asked.get(message.id);
    if (account === undefined || message.id === undefined) return;
    this.asked.delete(message.id);
    if (typeof message.result === 'number') {
      this.subscribed.set(account, message.result);
      this.byId.set(message.result, account);
      // It may have stopped being wanted while we were asking
      if (!this.wanted.has(account)) this.reconcile();
      this.unread.add(account);
      void this.readCurrent();
      return;
    }
    // Left unsubscribed: the next pass asks again
    this.logger.warn(`${account} refused: ${JSON.stringify(message.error ?? message.result)}`);
  }

  /**
   * The state as of now, for every account just subscribed to.
   *
   * A subscription only ever reports the NEXT change. Whatever happened while
   * there was none — a dropped socket, a restart, the seconds before the first
   * subscribe — would otherwise wait for the pool's next trade to surface, and
   * a quiet pool may not trade for an hour. So each new subscription is
   * followed by one read of where the account stands.
   *
   * After, not before: a change landing between a read and a subscribe would
   * be seen by neither. Read after, it is seen by at least one, and the slot
   * decides which of the two is newer when both arrive.
   */
  private async readCurrent(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      while (this.unread.size) {
        const batch = [...this.unread].slice(0, READ_BATCH);
        for (const account of batch) this.unread.delete(account);
        try {
          const read = await solanaRpc<Accounts>('getMultipleAccounts', [
            batch,
            { encoding: 'base64', commitment: 'confirmed' },
          ]);
          read.value.forEach((value, i) => {
            const encoded = value?.data?.[0];
            if (typeof encoded === 'string') this.hand(batch[i], read.context.slot, encoded);
          });
        } catch (error) {
          // The push is still coming; this was the shortcut to it
          this.logger.warn(`could not read ${batch.length} account(s): ${(error as Error).message}`);
        }
      }
    } finally {
      this.reading = false;
    }
  }

  /** On to the listener, unless something newer already went */
  private hand(account: string, slot: number, encoded: string): void {
    if (!this.wanted.has(account) || slot < (this.slots.get(account) ?? 0)) return;
    this.slots.set(account, slot);
    this.listener(account, Buffer.from(encoded, 'base64'));
  }

  /** Everything the connection owned, which is every subscription it held */
  private forget(): void {
    this.socket = null;
    this.subscribed.clear();
    this.byId.clear();
    this.asked.clear();
  }

  private drop(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const socket = this.socket;
    this.forget();
    try {
      socket?.close();
    } catch {
      // already gone
    }
  }
}
