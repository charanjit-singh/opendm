// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Context } from "hono";
import type { z } from "zod";

/** An error with an HTTP status, rendered as { error } by the app's error handler. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 415 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

/** Reads the JSON body and validates it. Throws ApiError(400) with the first problem. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const raw = await c.req.json().catch(() => ({}));
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(400, result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}
