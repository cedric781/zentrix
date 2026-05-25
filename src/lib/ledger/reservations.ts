import "server-only";
import type { TxClient } from "./accounts";

export class ReservationError extends Error {
  constructor(
    public readonly code:
      | "INSUFFICIENT_AVAILABLE"
      | "RESERVATION_NOT_FOUND"
      | "INVALID_AMOUNT",
    message: string,
  ) {
    super(message);
    this.name = "ReservationError";
  }
}

export async function reserveBalance(
  tx: TxClient,
  accountId: string,
  units: bigint,
): Promise<void> {
  if (units <= 0n) {
    throw new ReservationError(
      "INVALID_AMOUNT",
      `units must be > 0, got ${units}`,
    );
  }

  const rowsAffected = await tx.$executeRaw`
    UPDATE financial_accounts
    SET reserved_units = reserved_units + ${units},
        updated_at = NOW()
    WHERE id = ${accountId}
      AND (balance_units - reserved_units) >= ${units}
  `;

  if (rowsAffected === 0) {
    throw new ReservationError(
      "INSUFFICIENT_AVAILABLE",
      `Account ${accountId}: insufficient available balance to reserve ${units}`,
    );
  }
}

export async function releaseBalance(
  tx: TxClient,
  accountId: string,
  units: bigint,
): Promise<void> {
  if (units <= 0n) {
    throw new ReservationError(
      "INVALID_AMOUNT",
      `units must be > 0, got ${units}`,
    );
  }

  const rowsAffected = await tx.$executeRaw`
    UPDATE financial_accounts
    SET reserved_units = reserved_units - ${units},
        updated_at = NOW()
    WHERE id = ${accountId}
      AND reserved_units >= ${units}
  `;

  if (rowsAffected === 0) {
    throw new ReservationError(
      "RESERVATION_NOT_FOUND",
      `Account ${accountId}: cannot release ${units}, insufficient reserved`,
    );
  }
}
