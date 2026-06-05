// FASE 2.0 — evidence storage library (private Vercel Blob).
//
// Pure storage primitives only — NO routes, NO UI. The upload/serve/webhook
// routes (steps D/E) compose these. The store is PRIVATE: blobs are never
// publicly guessable; reads always go through the SDK (OIDC-authenticated) or
// the authenticated serve-route, never a bare public URL.
//
// Auth: on Vercel the SDK authenticates via OIDC by default — it pairs the
// auto-injected, short-lived VERCEL_OIDC_TOKEN with BLOB_STORE_ID, so no static
// secret is needed (and none is passed to get/put below). BLOB_READ_WRITE_TOKEN
// stays an accepted fallback for code running outside Vercel. env.ts keeps both
// optional so the app boots without them; assertBlobConfigured() enforces that
// at least one credential path is wired, so a misconfigured deploy fails
// cleanly at the feature edge rather than deep in the SDK.

import crypto from "node:crypto";
import { get, type GetBlobResult } from "@vercel/blob";
import { getEnv } from "@/lib/env";

/** Thrown when an evidence storage operation is attempted without configuration. */
export class BlobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobConfigError";
  }
}

/** Thrown when a caller-supplied pathname escapes the evidence namespace. */
export class BlobPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobPathError";
  }
}

/**
 * Asserts the store is reachable, or throws cleanly. The Vercel-runtime default
 * is OIDC, which needs BLOB_STORE_ID (VERCEL_OIDC_TOKEN is injected at runtime
 * and can't be validated at config time); BLOB_READ_WRITE_TOKEN is an accepted
 * off-Vercel fallback. We require at least one to be configured. Called by every
 * operation that touches the store (get in E, verifyAndHash in the webhook).
 */
export function assertBlobConfigured(): void {
  const e = getEnv();
  if (!e.BLOB_STORE_ID && !e.BLOB_READ_WRITE_TOKEN) {
    throw new BlobConfigError(
      "Blob storage is not configured — set BLOB_STORE_ID (OIDC, the Vercel default) or BLOB_READ_WRITE_TOKEN (off-Vercel fallback)",
    );
  }
}

// ---------------------------------------------------------------------------
// Upload policy — shared by client-token issuance (onBeforeGenerateToken, D)
// and any server-side validation. Single source of truth for what the arbiter
// is allowed to receive.
// ---------------------------------------------------------------------------

export const EVIDENCE_UPLOAD_POLICY = {
  image: {
    contentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    maxBytes: 10 * 1024 * 1024, // 10 MB
  },
  video: {
    // mp4 only — the one container we can reliably serve back to arbiters.
    contentTypes: ["video/mp4"],
    maxBytes: 50 * 1024 * 1024, // 50 MB
  },
} as const;

/** Flat allow-list of every accepted content-type. */
export const ALLOWED_CONTENT_TYPES: readonly string[] = [
  ...EVIDENCE_UPLOAD_POLICY.image.contentTypes,
  ...EVIDENCE_UPLOAD_POLICY.video.contentTypes,
];

/**
 * Max allowed byte size for a given content-type, or null if the type is not
 * on the allow-list (caller should reject).
 */
export function maxBytesForContentType(contentType: string): number | null {
  for (const group of Object.values(EVIDENCE_UPLOAD_POLICY)) {
    if ((group.contentTypes as readonly string[]).includes(contentType)) {
      return group.maxBytes;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pathname namespace — every evidence blob lives under evidence/{betId}/...
// Validation guards the serve-route (E) against path traversal and against
// serving anything outside the evidence namespace.
// ---------------------------------------------------------------------------

export const EVIDENCE_PREFIX = "evidence/";

/** Build the canonical evidence pathname for a bet's file. */
export function evidencePathname(betId: string, filename: string): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(betId)) {
    throw new BlobPathError(`betId is not a uuid: ${betId}`);
  }
  if (!filename || filename.includes("/")) {
    throw new BlobPathError(`filename must be a single non-empty segment`);
  }
  return `${EVIDENCE_PREFIX}${betId}/${filename}`;
}

/**
 * Asserts a pathname is a legal evidence pathname: under evidence/, exactly
 * three segments (evidence / {betId-uuid} / {filename}), no empty or relative
 * segments. Throws BlobPathError otherwise. Use on every caller-supplied path.
 */
export function assertEvidencePathname(pathname: string): void {
  if (typeof pathname !== "string" || !pathname.startsWith(EVIDENCE_PREFIX)) {
    throw new BlobPathError(`pathname must start with "${EVIDENCE_PREFIX}"`);
  }
  const segments = pathname.split("/");
  if (segments.length !== 3) {
    throw new BlobPathError(
      `evidence pathname must be evidence/{betId}/{filename}, got ${segments.length} segments`,
    );
  }
  const [, betId, filename] = segments;
  if (!/^[0-9a-fA-F-]{36}$/.test(betId)) {
    throw new BlobPathError(`evidence pathname betId segment is not a uuid`);
  }
  if (!filename || filename === "." || filename === "..") {
    throw new BlobPathError(`evidence pathname filename segment is invalid`);
  }
}

// ---------------------------------------------------------------------------
// Hashing + retrieval
// ---------------------------------------------------------------------------

/**
 * Pure: stream a blob body through SHA-256, returning the hex digest and the
 * byte count measured off the wire. No network, no token — unit-testable with
 * a synthetic stream. This is the server-attest primitive: we trust bytes we
 * counted ourselves, not client-claimed metadata.
 */
export async function hashStream(
  stream: ReadableStream<Uint8Array>,
): Promise<{ hash: string; sizeBytes: number }> {
  const hasher = crypto.createHash("sha256");
  let sizeBytes = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sizeBytes += value.byteLength;
    hasher.update(value);
  }
  return { hash: hasher.digest("hex"), sizeBytes };
}

export interface VerifiedBlob {
  hash: string;
  sizeBytes: number;
  contentType: string | null;
}

/**
 * Server-attest a stored blob: fetch it from the PRIVATE store with the token,
 * stream it through SHA-256, and report the measured hash + size + content-type.
 * Called by onUploadCompleted (D) to record hashVerified bytes the server
 * actually saw — the upload itself never passes through our function.
 */
export async function verifyAndHash(
  blobUrlOrPathname: string,
): Promise<VerifiedBlob> {
  assertBlobConfigured();
  const res = await get(blobUrlOrPathname, { access: "private" });
  if (!res || !res.stream) {
    throw new BlobConfigError(
      `blob not found or empty: ${blobUrlOrPathname}`,
    );
  }
  const { hash, sizeBytes } = await hashStream(res.stream);
  return { hash, sizeBytes, contentType: res.blob.contentType ?? null };
}

/**
 * Fetch a private evidence blob for streaming back through the authenticated
 * serve-route (E). Validates the pathname namespace before touching the store.
 * Returns null if the blob does not exist.
 */
export async function proxyGet(pathname: string): Promise<GetBlobResult | null> {
  assertEvidencePathname(pathname);
  assertBlobConfigured();
  return get(pathname, { access: "private" });
}
