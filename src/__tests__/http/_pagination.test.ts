import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  parseCursor,
  InvalidCursorError,
  CursorQuery,
  OffsetQuery,
} from "@/lib/http/pagination";

describe("pagination helpers", () => {
  describe("encodeCursor / decodeCursor", () => {
    it("roundtrips a payload", () => {
      const payload = { id: "bet-123", createdAt: "2026-05-12T10:00:00.000Z" };
      const encoded = encodeCursor(payload);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(payload);
    });

    it("throws InvalidCursorError on malformed base64", () => {
      expect(() => decodeCursor("@@@not-base64@@@")).toThrow(InvalidCursorError);
    });

    it("throws InvalidCursorError on valid base64 but wrong shape", () => {
      const bad = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString(
        "base64url",
      );
      expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
    });
  });

  describe("parseCursor", () => {
    it("returns null for undefined input", () => {
      expect(parseCursor(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseCursor("")).toBeNull();
    });

    it("returns decoded payload for valid cursor", () => {
      const encoded = encodeCursor({ id: "x", createdAt: "2026-01-01T00:00:00Z" });
      expect(parseCursor(encoded)).toEqual({
        id: "x",
        createdAt: "2026-01-01T00:00:00Z",
      });
    });
  });

  describe("CursorQuery zod schema", () => {
    it("applies default take=20 when omitted", () => {
      const parsed = CursorQuery.parse({});
      expect(parsed.take).toBe(20);
      expect(parsed.cursor).toBeUndefined();
    });

    it("coerces string take from query string", () => {
      const parsed = CursorQuery.parse({ take: "30" });
      expect(parsed.take).toBe(30);
    });

    it("rejects take > 50", () => {
      expect(() => CursorQuery.parse({ take: 51 })).toThrow();
    });

    it("rejects empty cursor string", () => {
      expect(() => CursorQuery.parse({ cursor: "" })).toThrow();
    });
  });

  describe("OffsetQuery zod schema", () => {
    it("applies defaults offset=0, take=25", () => {
      const parsed = OffsetQuery.parse({});
      expect(parsed.offset).toBe(0);
      expect(parsed.take).toBe(25);
    });

    it("rejects take > 100", () => {
      expect(() => OffsetQuery.parse({ take: 101 })).toThrow();
    });

    it("rejects negative offset", () => {
      expect(() => OffsetQuery.parse({ offset: -1 })).toThrow();
    });
  });
});
