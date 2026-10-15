// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Request bodies of the admin API.
import { z } from "zod";
import { MESSAGE_KEYS } from "../services/flow";
import { splitKeywords } from "../services/matching";

const MAX_TEXT = 900;

/** Free text: trimmed, capped, and an empty string means "use the default". */
const message = z
  .string()
  .trim()
  .max(MAX_TEXT)
  .transform((v) => v || undefined)
  .optional();

/** Extra wordings per message, cycled on every send. */
const variants = z
  .object(
    Object.fromEntries(MESSAGE_KEYS.map((key) => [key, z.array(z.string().trim().max(MAX_TEXT)).max(10).optional()])),
  )
  .partial();

/** The per-rule conversation settings a user may override. */
export const flowOverridesSchema = z.object({
  opener: z.boolean().optional(),
  openerText: message,
  requireFollow: z.boolean().optional(),
  followText: message,
  followRetryText: message,
  followMaxTries: z.number().int().min(1).max(5).optional(),
  followGiveUp: z.enum(["send", "stop"]).optional(),
  followStopText: message,
  followTimeoutMin: z.number().int().min(2).max(600).optional(),
  followTimeoutText: message,
  askEmail: z.enum(["off", "optional", "required"]).optional(),
  emailText: message,
  emailRetryText: message,
  emailThanks: message,
  emailStopText: message,
  deliverText: message,
  rotation: z.enum(["round_robin", "random"]).optional(),
  variants: variants.optional(),
});

const keywords = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => splitKeywords(v))
  .pipe(z.array(z.string()).min(1, "Add at least one keyword"));

const publicReplies = z
  .union([z.string(), z.array(z.string())])
  .default([])
  .transform((v) =>
    (Array.isArray(v) ? v : v.split("\n"))
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10),
  );

export const ruleSchema = z
  .object({
    name: z.string().trim().max(80).optional(),
    keywords,
    media_id: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null),
    enabled: z.boolean().default(true),
    link: z
      .string()
      .trim()
      .default("")
      .refine((v) => v === "" || /^https?:\/\//i.test(v), "Link must start with http:// or https://"),
    public_replies: publicReplies,
    fuzzy: z.boolean().default(true),
    channel: z.enum(["instagram", "facebook", "both"]).default("instagram"),
    dm_trigger: z.boolean().default(false),
    flow: flowOverridesSchema.default({}),
  })
  .transform((rule) => ({ ...rule, name: rule.name || rule.keywords[0].toUpperCase() }));

export const loginSchema = z.object({ password: z.string() });
export const connectSchema = z.object({ token: z.string().trim().min(20, "Paste the Instagram access token") });
export const enabledSchema = z.object({ enabled: z.boolean() });
export const settingsSchema = z.object({
  hourlyLimit: z
    .number()
    .int("Hourly limit must be 1 to 5000")
    .min(1, "Hourly limit must be 1 to 5000")
    .max(5000, "Hourly limit must be 1 to 5000"),
});

const lines = z.union([z.string(), z.array(z.string())]).default([]);

export const platformSchema = z.enum(["instagram", "facebook"]);

export const dryRunSchema = z.object({
  comment: z.string().default(""),
  platform: platformSchema.default("instagram"),
  /** Preview a specific wording of every message (1 = the first). */
  variant: z.number().int().min(1).max(10).optional(),
  mediaId: z.string().optional(),
  name: z.string().trim().optional(),
  replies: lines.transform((v) => (Array.isArray(v) ? v : v.split("\n")).map((line) => line.trim()).filter(Boolean)),
  following: z.enum(["yes", "no", "unknown"]).default("unknown"),
  waitMinutes: z.number().min(0).max(100_000).default(0),
});

export const disconnectSchema = z.object({ platform: platformSchema.default("instagram") });
export const subscribeSchema = z.object({ platform: platformSchema.default("instagram") });

export const credentialsSchema = z.object({
  platform: platformSchema,
  appId: z.string().trim().min(5, "App ID is required"),
  appSecret: z.string().trim().min(10, "App secret looks too short").optional(),
});

export const exchangeSchema = z.object({
  platform: platformSchema.default("instagram"),
  token: z.string().trim().min(20, "Paste the access token"),
});

export const facebookConnectSchema = z.object({
  token: z.string().trim().min(20, "Paste the Page or user access token"),
  pageId: z.string().trim().optional(),
});

export const facebookSelectSchema = z.object({ pageId: z.string().trim().min(1, "Choose a Page") });
