export class EarnError extends Error {}

export class CatalogNotReady extends EarnError {}

export class PoolNotFound extends EarnError {
  constructor(readonly poolId: string) {
    super(`no pool with id ${poolId}`);
  }
}

export class CatalogVersionGone extends EarnError {}

export class SelectionMismatch extends EarnError {}

export class MalformedCursor extends EarnError {}

export class DepositNotSupported extends EarnError {}

export class AmountBelowMinimum extends EarnError {}

export class NotEnoughHeld extends EarnError {}

export class DepositWouldFail extends EarnError {}

export class NothingThere extends EarnError {}

export class MoveNotSupported extends EarnError {}

export class CoinNotFound extends EarnError {}
