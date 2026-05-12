import "server-only";

export function bigToStr(b: bigint | null | undefined): string | null {
  if (b === null || b === undefined) return null;
  return b.toString();
}
