# OfferHaikya browser push setup

## Website changes included
- The signed-in user can click **Enable push alerts** in the Notifications panel.
- The browser requests notification permission, registers `/firebase-messaging-sw.js`, obtains an FCM web token using the Firebase Web Push public VAPID key, and writes the token to `pushSubscriptions/{uid}`.
- The Cloudflare notifications worker can send Firebase Cloud Messaging messages to those tokens when an offer matches the user's profile categories and local-offer distance rules.

## Required deployment configuration
1. Confirm the Firebase Cloud Messaging API is enabled for the Firebase project.
2. Deploy the website build containing `public/firebase-messaging-sw.js`.
3. In Cloudflare Worker settings, set `WEB_PUSH_ENABLED=true`.
4. The worker's `FIREBASE_SERVICE_ACCOUNT_JSON` service account must have Firestore access and permission to send Firebase Cloud Messaging messages. The worker requests both the Datastore and Firebase Messaging OAuth scopes.
5. Deploy `cloudflare_notifications_worker.js` to the Cloudflare Worker that runs the scheduled notification cycle.
6. Check Firestore security rules permit an authenticated user to create/update only their own `pushSubscriptions/{uid}` document. Do not make this collection publicly readable or writable.
7. Open the live website, sign in, open Notifications, and click **Enable push alerts**. Verify a `pushSubscriptions/{your-auth-uid}` document appears with `enabled: true` and a token.
8. The worker's first run only seeds its baseline. Publish a new Blogger offer after the baseline, matching the profile categories (and location rules for local offers), to test background delivery.

## Notes
- The VAPID public key is public configuration; never put Firebase service-account JSON or private keys in the website.
- This code change alone does not deploy the website or Cloudflare Worker, and delivery still depends on valid Firebase configuration, Firestore rules, and the worker schedule.
- Browser push support requires a secure origin (HTTPS, or localhost for development).
