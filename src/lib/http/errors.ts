import "server-only";
import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth";
import { BetError } from "@/lib/bets/errors";
import { DisputeError } from "@/lib/disputes/errors";
import { BracketError } from "@/lib/brackets/errors";
import { InviteError } from "@/lib/invites/errors";
import { MatchError } from "@/lib/matches/errors";
import { PoolError } from "@/lib/pools/errors";
import { InvalidIdempotencyKeyError } from "./idempotency";
import { InvalidCursorError } from "./pagination";

export function mapDomainError(err: unknown): NextResponse | null {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (err instanceof InvalidIdempotencyKeyError) {
    return NextResponse.json(
      { error: "INVALID_IDEMPOTENCY_KEY", message: err.message },
      { status: 400 },
    );
  }
  if (err instanceof InvalidCursorError) {
    return NextResponse.json(
      { error: "INVALID_CURSOR", message: err.message },
      { status: 400 },
    );
  }
  if (
    err instanceof BetError ||
    err instanceof BracketError ||
    err instanceof DisputeError ||
    err instanceof InviteError ||
    err instanceof MatchError ||
    err instanceof PoolError
  ) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.statusCode },
    );
  }
  return null;
}
