import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { QueueService } from '@svinooh/common';
import type { PrismaService } from '@svinooh/db';
import { idempotencyKeyOf } from '../src/billing/billing.controller';
import { BillingService } from '../src/billing/billing.service';
import type { NowPaymentsClient } from '../src/billing/nowpayments.client';
import type { PremiumService } from '../src/billing/premium.service';

const KEY = '0f6c2b1e-5d3a-4c8e-9b7a-2e4f6a8c0d1b';

interface Row {
  id: string;
  userId: string;
  orderId: string;
  idempotencyKey: string | null;
  status: string;
  invoiceUrl: string | null;
  createdAt: Date;
}

/**
 * Payments over a database that lets one row per (userId, idempotencyKey) in,
 * the way the unique index does, and a gateway that numbers its invoices.
 * Every call yields first, so two requests started together interleave.
 */
function standing(gateway: { fails?: number; holds?: Promise<void> } = {}) {
  const rows: Row[] = [];
  let invoices = 0;
  let failures = gateway.fails ?? 0;
  const yieldFirst = () => new Promise((resolve) => setImmediate(resolve));

  const prisma = {
    payment: {
      count: async () => 0,
      findUnique: async ({
        where,
      }: {
        where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
      }) => {
        await yieldFirst();
        const { userId, idempotencyKey } = where.userId_idempotencyKey;
        return rows.find((row) => row.userId === userId && row.idempotencyKey === idempotencyKey) ?? null;
      },
      create: async ({ data }: { data: { userId: string; orderId: string; idempotencyKey: string | null } }) => {
        await yieldFirst();
        const taken = rows.some(
          (row) =>
            data.idempotencyKey !== null &&
            row.userId === data.userId &&
            row.idempotencyKey === data.idempotencyKey,
        );
        if (taken) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: (`userId`,`idempotencyKey`)',
            { code: 'P2002', clientVersion: 'test' },
          );
        }
        const row: Row = {
          id: `pay-${rows.length + 1}`,
          userId: data.userId,
          orderId: data.orderId,
          idempotencyKey: data.idempotencyKey,
          status: 'created',
          invoiceUrl: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        await yieldFirst();
        const row = rows.find((one) => one.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  } as unknown as PrismaService;

  const nowpayments = {
    enabled: true,
    minAmountUsd: async () => 1,
    createInvoice: async () => {
      await yieldFirst();
      await gateway.holds;
      if (failures > 0) {
        failures -= 1;
        throw new Error('gateway unreachable');
      }
      invoices += 1;
      return { invoiceId: `inv-${invoices}`, url: `https://nowpayments.io/payment/?iid=inv-${invoices}` };
    },
  } as unknown as NowPaymentsClient;

  const billing = new BillingService(
    prisma,
    {} as PremiumService,
    nowpayments,
    {} as QueueService,
  );
  return { rows, billing, invoices: () => invoices };
}

describe('ACheckoutUnderOneKeyIsOneCheckout', () => {
  test('the same key twice is the same invoice, opened once', async () => {
    const { rows, billing, invoices } = standing();
    const first = await billing.checkout('user-1', KEY);
    const again = await billing.checkout('user-1', KEY);
    assert.equal(again.url, first.url);
    assert.equal(invoices(), 1);
    assert.equal(rows.length, 1);
  });

  test('without a key every press is a new invoice, as before', async () => {
    const { rows, billing, invoices } = standing();
    const first = await billing.checkout('user-1');
    const second = await billing.checkout('user-1');
    assert.notEqual(second.url, first.url);
    assert.equal(invoices(), 2);
    assert.equal(rows.length, 2);
  });

  test('a key belongs to the account that sent it', async () => {
    const { billing, invoices } = standing();
    const mine = await billing.checkout('user-1', KEY);
    const theirs = await billing.checkout('user-2', KEY);
    assert.notEqual(theirs.url, mine.url, "nobody gets another person's invoice by sending their key");
    assert.equal(invoices(), 2);
  });

  test('once its payment is over, the key opens a new invoice', async () => {
    const { rows, billing } = standing();
    const first = await billing.checkout('user-1', KEY);
    rows[0].status = 'paid';
    const next = await billing.checkout('user-1', KEY);
    assert.notEqual(next.url, first.url);
    assert.equal(rows[0].idempotencyKey, null, 'the finished payment let go of the key');
    assert.equal(rows[1].idempotencyKey, KEY);
  });

  test('an invoice being paid right now is answered again, never doubled', async () => {
    const { rows, billing, invoices } = standing();
    const first = await billing.checkout('user-1', KEY);
    rows[0].status = 'confirming';
    const again = await billing.checkout('user-1', KEY);
    assert.equal(again.url, first.url);
    assert.equal(invoices(), 1);
  });

  test('a failure at the gateway is not remembered: the retry opens the invoice', async () => {
    const { rows, billing, invoices } = standing({ fails: 1 });
    await assert.rejects(billing.checkout('user-1', KEY), ServiceUnavailableException);
    assert.equal(rows[0].status, 'failed');
    const retried = await billing.checkout('user-1', KEY);
    assert.match(retried.url, /iid=inv-1$/);
    assert.equal(invoices(), 1);
    assert.equal(rows[0].idempotencyKey, null);
  });

  test('an attempt left without an invoice for over a minute lets go of its key', async () => {
    const { rows, billing, invoices } = standing();
    rows.push({
      id: 'pay-0',
      userId: 'user-1',
      orderId: 'pro_crashed',
      idempotencyKey: KEY,
      status: 'created',
      invoiceUrl: null,
      createdAt: new Date(Date.now() - 2 * 60_000),
    });
    const retried = await billing.checkout('user-1', KEY);
    assert.match(retried.url, /iid=inv-1$/);
    assert.equal(invoices(), 1);
  });

  test('two at once under one key: one invoice, and the other is told to try again', async () => {
    let open = (): void => undefined;
    const holds = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { rows, billing, invoices } = standing({ holds });
    const both = Promise.allSettled([billing.checkout('user-1', KEY), billing.checkout('user-1', KEY)]);
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    open();
    const [one, other] = await both;
    const outcomes = [one, other].map((settled) =>
      settled.status === 'fulfilled' ? 'invoice' : (settled.reason as ConflictException).getStatus(),
    );
    assert.deepEqual(outcomes.sort(), [409, 'invoice']);
    assert.equal(invoices(), 1);
    assert.equal(rows.length, 1);
  });
});

describe('TheIdempotencyKeyHeader', () => {
  test('none is no key, and a UUID is itself', () => {
    assert.equal(idempotencyKeyOf(undefined), null);
    assert.equal(idempotencyKeyOf(''), null);
    assert.equal(idempotencyKeyOf(KEY), KEY);
  });

  test('anything not shaped like a key is refused', () => {
    assert.throws(() => idempotencyKeyOf('short'), BadRequestException);
    assert.throws(() => idempotencyKeyOf('has spaces in it'), BadRequestException);
    assert.throws(() => idempotencyKeyOf('x'.repeat(129)), BadRequestException);
  });
});
