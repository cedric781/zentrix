import "server-only";
import { z } from "zod";
import { CursorQuery, OffsetQuery } from "./pagination";

export const SortByEnum = z
  .enum(["createdAt", "expiresAt"])
  .optional()
  .default("createdAt");

type ZodEnumLike = z.ZodEnum<[string, ...string[]]>;

export function parseListQuery(req: Request, statusEnum: ZodEnumLike) {
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const schema = z
    .object({
      status: statusEnum.optional(),
      sortBy: SortByEnum,
    })
    .merge(CursorQuery);
  return schema.safeParse(raw);
}

export function parseAdminListQuery(req: Request, statusEnum: ZodEnumLike) {
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const schema = z
    .object({
      status: statusEnum.optional(),
      sortBy: SortByEnum,
      searchQ: z.string().max(200).optional(),
    })
    .merge(OffsetQuery);
  return schema.safeParse(raw);
}
