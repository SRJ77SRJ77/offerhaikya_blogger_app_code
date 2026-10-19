# Offerhaikya Website — Unused JavaScript Audit

**Purpose:** Keep a review list only. Nothing in this file has been deleted from the app.

## 1. Source declarations previously reported as unused

A previous `npm run lint` report for the website's React source reported these declarations as unused:

- `FEED_URL`
- `ACCENT`
- `PAGE`
- `WHITE`
- `TEXT`
- `MUTED`
- `onOpenDistance`
- `bloggerMenus`
- `specialDealsOpen` and its setter
- Registration/auth/login state declarations
- `handleTagPointerDown`
- `handleTagPointerMove`
- `handleTagPointerUp`

**Important:** This list comes from an earlier lint run, not a fresh audit of the current GitHub revision. Some auth-related declarations or state may be connected to hidden UI or other behavior. Re-check each item against the current `website-conversion/App.jsx` before removing it.

## 2. Lighthouse's “Reduce unused JavaScript” warning

A previous mobile Lighthouse run estimated approximately **453 KB of unused JavaScript** in the built page (another earlier audit reported about **625 KiB**). This is not a list of unused source files or imports. Lighthouse estimates code downloaded but not used during that particular page-load/test flow. Some of it may be needed on other routes or after user interactions.

The report also showed the main built JS bundle at about **580 KiB** and a Firebase Auth iframe request. These findings need a fresh production build and route/interaction checks before deciding what can be removed or split.

## 3. Safe next steps

1. Run `npm run lint` in the current website project and refresh this list from the actual output.
2. Run `npm run build` and inspect the bundle with a bundle analyzer to identify large dependencies.
3. Check Firebase Auth imports/usages before removing them; do not remove them solely because the website is intended not to show login.
4. Test home, search, categories, nearby offers, offer detail pages, Blogger sync, maps, and light/dark mode after any change.
5. Do not delete anything based only on Lighthouse's unused-JavaScript estimate.

**Status:** Review notes only; no app code changed by this file.
