// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The Meta-side instructions shown in the setup wizard. Permission names: https://developers.facebook.com/docs/permissions

export const META_APPS_URL = "https://developers.facebook.com/apps";

export const INSTAGRAM_PERMISSIONS = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
];

export const FACEBOOK_PERMISSIONS = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "pages_read_engagement",
  "pages_manage_engagement",
];

/** Extra permissions when Instagram runs through the Facebook Page (Facebook Login). */
export const INSTAGRAM_VIA_FACEBOOK_PERMISSIONS = [
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
];

export const createAppSteps = (redirectUri: string) => [
  `Open developers.facebook.com/apps and click Create app. Choose the use case "Other" and the app type "Business".`,
  'Add the product "Instagram", then open "API setup with Instagram login". Copy the Instagram app ID and secret from there.',
  `Under "Business login settings" add this OAuth redirect URI: ${redirectUri}`,
  'Click "Add account" and add your Instagram Professional account (Business or Creator). Accept the tester invite in the Instagram app: Settings, Website permissions, Apps and websites, Tester invites.',
  'For Facebook Pages: add the products "Messenger" and "Facebook Login", copy the App ID and secret from Settings > Basic, and add the same redirect URI under Facebook Login > Settings.',
];

export const webhookSteps = (callbackUrl: string) => [
  `In the app open Webhooks. For the "Instagram" object set Callback URL ${callbackUrl} and the verify token below, then subscribe to comments and messages.`,
  'For the "Page" object (Facebook) use the same callback URL and token and subscribe to feed, messages and messaging_postbacks.',
  "Back here, press Subscribe for each connected account.",
];

export const reviewNotes = [
  "In development mode only people with a role on the app (administrators, developers, testers) trigger the automation. Add a second account of yours as a tester to try it.",
  "To serve the public, switch the app to Live and request Advanced Access for the permissions above through App Review. Meta usually also asks for Business Verification and a privacy policy URL (this Worker serves one at /privacy).",
];
