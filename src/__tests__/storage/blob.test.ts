import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate requireBlobToken: getEnv() validates the whole env (FEE_WALLET etc.),
// so mock it to control only what this unit cares about.
vi.mock("@/lib/env", () => ({ getEnv: vi.fn() }));

import { getEnv } from "@/lib/env";
import {
  hashStream,
  assertBlobConfigured,
  BlobConfigError,
  BlobPathError,
  EVIDENCE_UPLOAD_POLICY,
  ALLOWED_CONTENT_TYPES,
  maxBytesForContentType,
  evidencePathname,
  assertEvidencePathname,
} from "@/lib/storage/blob";

const getEnvMock = getEnv as ReturnType<typeof vi.fn>;

/** Build a byte stream from string chunks (each chunk enqueued separately). */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

const VALID_BET_ID = "11111111-1111-4111-8111-111111111111";

describe("hashStream — pure SHA-256 over the wire", () => {
  // Known NIST vectors: sha256("abc") and sha256("").
  it("hashes 'abc' to the canonical digest with size 3", async () => {
    const { hash, sizeBytes } = await hashStream(streamOf("abc"));
    expect(hash).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sizeBytes).toBe(3);
  });

  it("hashes the empty stream to the canonical digest with size 0", async () => {
    const { hash, sizeBytes } = await hashStream(streamOf());
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sizeBytes).toBe(0);
  });

  it("accumulates across chunks — 'a','b','c' equals 'abc'", async () => {
    const multi = await hashStream(streamOf("a", "b", "c"));
    expect(multi.hash).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(multi.sizeBytes).toBe(3);
  });
});

describe("assertBlobConfigured — clean failure at the feature edge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws BlobConfigError when neither STORE_ID nor RW token is set", () => {
    getEnvMock.mockReturnValue({
      BLOB_STORE_ID: undefined,
      BLOB_READ_WRITE_TOKEN: undefined,
    });
    expect(() => assertBlobConfigured()).toThrow(BlobConfigError);
  });

  it("passes with BLOB_STORE_ID set (OIDC, the Vercel default)", () => {
    getEnvMock.mockReturnValue({ BLOB_STORE_ID: "store_FHWR0NWxzzGlOpGu" });
    expect(() => assertBlobConfigured()).not.toThrow();
  });

  it("passes with the read-write token set (off-Vercel fallback)", () => {
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_FHWR0NWxzzGlOpGu_deadbeefcafebabe",
    });
    expect(() => assertBlobConfigured()).not.toThrow();
  });
});

describe("evidence upload policy", () => {
  it("caps images at 10 MB and mp4 at 50 MB", () => {
    expect(EVIDENCE_UPLOAD_POLICY.image.maxBytes).toBe(10 * 1024 * 1024);
    expect(EVIDENCE_UPLOAD_POLICY.video.maxBytes).toBe(50 * 1024 * 1024);
  });

  it("maxBytesForContentType resolves allowed types and rejects others", () => {
    expect(maxBytesForContentType("image/png")).toBe(10 * 1024 * 1024);
    expect(maxBytesForContentType("video/mp4")).toBe(50 * 1024 * 1024);
    expect(maxBytesForContentType("application/pdf")).toBeNull();
    expect(maxBytesForContentType("video/quicktime")).toBeNull();
  });

  it("allow-list contains the expected types and nothing dangerous", () => {
    expect(ALLOWED_CONTENT_TYPES).toContain("image/png");
    expect(ALLOWED_CONTENT_TYPES).toContain("video/mp4");
    expect(ALLOWED_CONTENT_TYPES).not.toContain("text/html");
    expect(ALLOWED_CONTENT_TYPES).not.toContain("application/octet-stream");
  });
});

describe("evidencePathname — canonical builder", () => {
  it("builds evidence/{betId}/{filename}", () => {
    expect(evidencePathname(VALID_BET_ID, "proof.png")).toBe(
      `evidence/${VALID_BET_ID}/proof.png`,
    );
  });

  it("rejects a non-uuid betId", () => {
    expect(() => evidencePathname("not-a-uuid", "x.png")).toThrow(BlobPathError);
  });

  it("rejects a filename containing a slash", () => {
    expect(() => evidencePathname(VALID_BET_ID, "a/b.png")).toThrow(
      BlobPathError,
    );
  });
});

describe("assertEvidencePathname — serve-route guard", () => {
  it("accepts a well-formed evidence pathname", () => {
    expect(() =>
      assertEvidencePathname(`evidence/${VALID_BET_ID}/proof.png`),
    ).not.toThrow();
  });

  it("rejects paths outside the evidence namespace", () => {
    expect(() => assertEvidencePathname("secrets/key.txt")).toThrow(
      BlobPathError,
    );
    expect(() => assertEvidencePathname("/etc/passwd")).toThrow(BlobPathError);
  });

  it("rejects path traversal", () => {
    expect(() =>
      assertEvidencePathname(`evidence/${VALID_BET_ID}/..`),
    ).toThrow(BlobPathError);
    // extra segment / nested traversal is also rejected by segment count
    expect(() =>
      assertEvidencePathname(`evidence/${VALID_BET_ID}/../../secret`),
    ).toThrow(BlobPathError);
  });

  it("rejects a non-uuid betId segment", () => {
    expect(() => assertEvidencePathname("evidence/abc/proof.png")).toThrow(
      BlobPathError,
    );
  });

  it("rejects wrong segment count", () => {
    expect(() => assertEvidencePathname(`evidence/${VALID_BET_ID}`)).toThrow(
      BlobPathError,
    );
  });
});
