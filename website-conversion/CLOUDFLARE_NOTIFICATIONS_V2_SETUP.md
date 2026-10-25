# OfferHaikya Cloudflare Notifications V2

This is a new worker, separate from the old `cloudflare_worker_code.js`. Do not switch production traffic to it until the configuration and dry run pass.

## What it currently does

- Reads Blogger posts from the public OfferHaikya feed.
- Reads profiles from Firestore `userProfiles`, matching the current website profile schema (`categories`, `location`, `email`, `profileComplete`).
- Requires a selected offer type and at least one matching post category.
- For local/offline offers, resolves locations and checks **road driving distance** through OSRM. It only matches at 300 km or less. If a location or route cannot be verified, it does not notify.
- Sends email using Resend.
- Optionally sends Expo push if `EXPO_PUSH_ENABLED=true` and a profile actually has an `expoPushToken`.
- Saves delivery markers to avoid repeating successful channel deliveries.
- First scheduled run saves a baseline and sends nothing, avoiding a blast of old offers.
- Has protected `POST /test` (dry run) and `POST /run` (live run) endpoints. Both require `Authorization: Bearer <ADMIN_SECRET>`.

**Important push limitation:** the current website profile shown in the repository does not include browser push subscriptions. This worker does not yet send browser Web Push notifications. Expo push is optional and only works for profiles with valid Expo tokens. Email can work once configured. Browser push needs a website permission/subscription flow and service worker.

## Cloudflare configuration

Create a **new Worker** named something like `offerhaikya-notifications-v2` and paste the contents of `cloudflare_notifications_worker.js`. Keep the existing Worker untouched while testing.

Add these Worker secrets/variables:

| Name | Type | Purpose |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | variable | Firebase project ID used by the current site |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | secret | Service-account JSON with Firestore access |
| `RESEND_API_KEY` | secret | Resend API key |
| `RESEND_FROM` | variable | Sender address verified in Resend |
| `ADMIN_SECRET` | secret | Long random secret for manual endpoints |
| `EXPO_PUSH_ENABLED` | variable, optional | Set to `true` only if Expo tokens are actually stored on profiles |
| `ROUTING_USER_AGENT` | variable, optional | A descriptive contact string for public geocoding requests |

Never commit service-account JSON, provider API keys, or the admin secret to GitHub.

The Firebase service account needs permission to read/write the worker's Firestore documents. The REST API uses the service account's `client_email` and `private_key` from `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Free-service notes

- Resend has a free allowance, account/domain verification requirements, and provider limits.
- Nominatim and the public OSRM demo endpoint are community-run services with fair-use limits and no production uptime guarantee. This worker caches geocodes and routes in Firestore, but a high-volume service may need a different provider.
- Free tiers and terms can change. This implementation is not unlimited and should be tested with the expected number of profiles/offers.

## Test before live delivery

1. Deploy the new Worker without configuring a Cron Trigger yet.
2. Add the required secrets and variables.
3. Open `GET /health`; it should report the worker version.
4. Call `POST /test` with `Authorization: Bearer <ADMIN_SECRET>`. This must report `mode: SAFE_TEST_NO_DELIVERY` and `notificationsSent: 0`.
5. Review the matched profiles, categories, and local road distances carefully.
6. Only after the dry run is correct, call `POST /run` once to initialize the baseline. It sends nothing on the first run.
7. Publish a new test offer and use `POST /test` first. Then use `POST /run` only when ready to send real emails.
8. Add a Cron Trigger (for example, every 15 minutes) after manual tests pass.

Use the Worker URL's `/test` and `/run` paths, not a URL containing the secret. Send the secret in the Authorization header.

## Current match rules

- Online: user selected `Online Offers`, profile is complete, and a post category exactly matches one of the user's selected categories.
- Local/offline: user selected `Local Offers` or `Offline Offers`, profile is complete, a post category exactly matches one of the user's selected categories, and the verified road distance is at most 300 km.
- Unknown offer type, category mismatch, missing location, failed geocoding, or unavailable route means no local notification.
- A public Worker URL is not sufficient protection for live delivery; keep `ADMIN_SECRET` strong and private.
