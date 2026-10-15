// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The Meta app id and secret per platform. Entered in the setup wizard (stored encrypted in D1) or set as Worker secrets.
import { seal, unseal } from "../lib/crypto";
import type { Platform } from "../types/api";
import type { Env } from "../types/env";
import { getSetting, setSetting } from "./settings";

export interface AppCredentials {
  id: string | null;
  secret: string | null;
}

const keys = (platform: Platform) => ({ id: `app_id_${platform}`, secret: `app_secret_${platform}` });

/** D1 values win over Worker secrets, so the wizard can change them without a redeploy. */
export async function getAppCredentials(env: Env, platform: Platform): Promise<AppCredentials> {
  const k = keys(platform);
  const fromEnv =
    platform === "instagram"
      ? { id: env.INSTAGRAM_APP_ID, secret: env.INSTAGRAM_APP_SECRET }
      : { id: env.FACEBOOK_APP_ID, secret: env.FACEBOOK_APP_SECRET };
  return {
    id: (await getSetting(env, k.id)) || fromEnv.id || null,
    secret: (await unseal(env.SESSION_SECRET, await getSetting(env, k.secret))) || fromEnv.secret || null,
  };
}

export async function saveAppCredentials(
  env: Env,
  platform: Platform,
  creds: { id: string; secret?: string },
): Promise<void> {
  const k = keys(platform);
  await setSetting(env, k.id, creds.id);
  if (creds.secret) await setSetting(env, k.secret, await seal(env.SESSION_SECRET, creds.secret));
}

/** Every app secret a webhook might be signed with (the Instagram app and the Facebook app can differ). */
export async function signatureSecrets(env: Env): Promise<string[]> {
  const secrets = [
    (await getAppCredentials(env, "instagram")).secret,
    (await getAppCredentials(env, "facebook")).secret,
  ];
  return [...new Set(secrets.filter((s): s is string => !!s))];
}
