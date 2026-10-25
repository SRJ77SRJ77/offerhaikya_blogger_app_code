/**
 * OfferHaikya NEW notification worker (v2).
 *
 * Separate from cloudflare_worker_code.js so the old worker stays untouched
 * until this one is configured and tested.
 *
 * Required Cloudflare Worker secrets/variables:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_SERVICE_ACCOUNT_JSON  (service account JSON with Firestore access)
 *   RESEND_API_KEY
 *   RESEND_FROM                    (verified sender, e.g. offers@your-verified-domain)
 *   ADMIN_SECRET                   (long random secret for manual POST /run)
 *
 * Optional:
 *   EXPO_PUSH_ENABLED=true          (only if profiles actually contain expoPushToken)
 *   ROUTING_USER_AGENT              (identify requests to public Nominatim service)
 *
 * Free-service note: Nominatim and OSRM public endpoints are community services
 * with usage limits and no uptime guarantee. Do not use for high-volume traffic.
 * This worker does NOT implement browser Web Push subscription registration.
 */

const VERSION = "OFFERHAIKYA_CLOUDFLARE_NOTIFICATIONS_V2";
const FEED_URL = "https://www.offerhaikya.com/feeds/posts/default";
const FIRESTORE_ROOT = "https://firestore.googleapis.com/v1/projects/";
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const RESEND_URL = "https://api.resend.com/emails";
const EXPO_URL = "https://exp.host/--/api/v2/push/send";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving/";
const MAX_ROAD_DISTANCE_KM = 300;
const PROFILE_COLLECTION = "userProfiles";
const STATE_DOC = "notificationState/cloudflareV2";
const CACHE_COLLECTION = "notificationGeoCache";
const DELIVERY_COLLECTION = "notificationDeliveries";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, worker: VERSION, mode: "health-only" });
    }

    if (request.method === "POST" && (url.pathname === "/run" || url.pathname === "/test")) {
      if (!env.ADMIN_SECRET || request.headers.get("Authorization") !== "Bearer " + env.ADMIN_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      try {
        const result = url.pathname === "/test"
          ? await runSafeTest(env)
          : await runNotificationCycle(env);
        return json(result);
      } catch (error) {
        return json({ ok: false, worker: VERSION, error: safeError(error) }, 500);
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runNotificationCycle(env));
  },
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeError(error) {
  return String(error && error.message ? error.message : error).slice(0, 500);
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "https://www.offerhaikya.com";
  } catch {
    return "https://www.offerhaikya.com";
  }
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function parseCoordinates(value) {
  const parts = String(value || "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 2 || !validCoordinates(parts[0], parts[1])) return null;
  return { latitude: parts[0], longitude: parts[1] };
}

function extractCoordinatesFromHtml(html) {
  const text = String(html || "");
  let match = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  if (match) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (validCoordinates(latitude, longitude)) return { latitude, longitude };
  }
  match = text.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i);
  if (match) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (validCoordinates(latitude, longitude)) return { latitude, longitude };
  }
  return null;
}

function parseBloggerFeed(data) {
  const entries = Array.isArray(data && data.feed && data.feed.entry) ? data.feed.entry : [];
  return entries.map((entry, index) => {
    const links = Array.isArray(entry.link) ? entry.link : [];
    const contentHtml = entry.content && entry.content.$t || entry.summary && entry.summary.$t || "";
    const labels = (Array.isArray(entry.category) ? entry.category : [])
      .map((item) => String(item.term || "").trim())
      .filter(Boolean);
    const locationName = String(
      entry["georss$featurename"] && entry["georss$featurename"].$t ||
      entry.location && entry.location.name && (entry.location.name.$t || entry.location.name) ||
      entry["gd$where"] && (entry["gd$where"].name && (entry["gd$where"].name.$t || entry["gd$where"].name) || entry["gd$where"].valueString) ||
      ""
    ).trim();
    const coordinates = parseCoordinates(entry["georss$point"] && entry["georss$point"].$t) ||
      extractCoordinatesFromHtml(contentHtml);
    const title = String(entry.title && entry.title.$t || "New Offerhaikya offer").trim();
    const url = safeHttpUrl((links.find((item) => item.rel === "alternate") || {}).href);
    const publishedAt = String(entry.published && entry.published.$t || entry.updated && entry.updated.$t || "");
    const updatedAt = String(entry.updated && entry.updated.$t || publishedAt);
    const description = stripHtml(entry.summary && entry.summary.$t || contentHtml).slice(0, 300);
    return {
      id: String(entry.id && entry.id.$t || url || index),
      title,
      url,
      publishedAt,
      updatedAt,
      labels,
      locationName,
      coordinates,
      description,
      content: stripHtml(contentHtml).slice(0, 5000),
    };
  }).filter((post) => post.id && post.url);
}

function isTypeLabel(label) {
  return [
    "online offer", "online offers", "online",
    "offline offer", "offline offers", "offline",
    "local offer", "local offers", "local",
    "nearby offer", "nearby offers",
  ].includes(normalize(label));
}

function offerType(post) {
  const labels = post.labels.map(normalize);
  if (labels.some((label) => ["offline offer", "offline offers", "offline", "local offer", "local offers", "local", "nearby offer", "nearby offers"].includes(label))) return "local";
  if (labels.some((label) => ["online offer", "online offers", "online"].includes(label))) return "online";
  return "unknown";
}

function postCategories(post) {
  return post.labels.map(normalize).filter((label) => label && !isTypeLabel(label) &&
    !/^(expired|verified|lock|coupons)$/.test(label) &&
    !/^e(?:_|y?\d)/i.test(label));
}

function userCategories(profile) {
  return (Array.isArray(profile.categories) ? profile.categories : [])
    .map(normalize).filter(Boolean);
}

function categoriesMatch(post, profile) {
  const selected = userCategories(profile);
  const offered = postCategories(post);
  const match = offered.find((category) => selected.includes(category));
  return match || "";
}

function wantsType(profile, type) {
  const selected = userCategories(profile);
  if (type === "local") return selected.includes("local offers") || selected.includes("local offer") || selected.includes("offline offers") || selected.includes("offline offer");
  if (type === "online") return selected.includes("online offers") || selected.includes("online offer");
  return false;
}

function isExpired(post, now = Date.now()) {
  if (post.labels.some((label) => normalize(label) === "expired")) return true;
  const expiryTag = post.labels.find((label) => /^E_\d{2}_\d{2}_\d{4}_\d{2}_\d{2}_(AM|PM)$/i.test(String(label).trim()));
  if (expiryTag) {
    const match = expiryTag.match(/^E_(\d{2})_(\d{2})_(\d{4})_(\d{2})_(\d{2})_(AM|PM)$/i);
    if (match) {
      const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
      let hour = Number(match[4]);
      const minute = Number(match[5]);
      if (hour < 1 || hour > 12 || minute > 59 || day < 1 || day > 31 || month < 1 || month > 12) return false;
      hour = match[6].toUpperCase() === "AM" ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
      const expiry = Date.UTC(year, month - 1, day, hour, minute) - 330 * 60000;
      return Number.isFinite(expiry) && now >= expiry;
    }
  }
  return false;
}

function base64UrlEncode(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const base64 = String(pem || "").replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getFirebaseAccessToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON || !env.FIREBASE_PROJECT_ID) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID secret/variable.");
  }
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: OAUTH_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = base64UrlEncode(JSON.stringify(header)) + "." + base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + "." + base64UrlEncode(signature);
  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt),
  });
  if (!response.ok) throw new Error("Firebase OAuth failed: HTTP " + response.status);
  const result = await response.json();
  if (!result.access_token) throw new Error("Firebase OAuth returned no access token.");
  return result.access_token;
}

function documentUrl(env, path) {
  return FIRESTORE_ROOT + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/" + path;
}

function decodeFirestoreValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields) {
  const result = {};
  for (const key of Object.keys(fields || {})) result[key] = decodeFirestoreValue(fields[key]);
  return result;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFirestoreFields(value) } };
  return { stringValue: String(value) };
}

function encodeFirestoreFields(fields) {
  const result = {};
  for (const key of Object.keys(fields || {})) result[key] = encodeFirestoreValue(fields[key]);
  return result;
}

async function firestoreRequest(env, token, path, options = {}) {
  const response = await fetch(documentUrl(env, path), {
    method: options.method || "GET",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Firestore request failed: HTTP " + response.status + " (" + path.split("/")[0] + ")");
  if (response.status === 204) return {};
  return response.json();
}

async function readDocument(env, token, path) {
  const doc = await firestoreRequest(env, token, path);
  return doc ? { name: doc.name, data: decodeFirestoreFields(doc.fields || {}) } : null;
}

async function writeDocument(env, token, path, data) {
  const result = await firestoreRequest(env, token, path, {
    method: "PATCH",
    body: { fields: encodeFirestoreFields(data) },
  });
  return result ? decodeFirestoreFields(result.fields || {}) : data;
}

async function listCollection(env, token, collection) {
  const documents = [];
  let pageToken = "";
  do {
    const url = documentUrl(env, collection) + "?pageSize=100" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const response = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!response.ok) throw new Error("Firestore list failed for " + collection + ": HTTP " + response.status);
    const result = await response.json();
    for (const doc of result.documents || []) {
      documents.push({ id: String(doc.name || "").split("/").pop(), data: decodeFirestoreFields(doc.fields || {}) });
    }
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return documents;
}

async function sha256Id(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cachedGeocode(env, token, place, inMemory) {
  const keyText = normalize(place);
  if (!keyText) return null;
  if (inMemory.has(keyText)) return inMemory.get(keyText);
  const cacheId = await sha256Id(keyText);
  const cacheDoc = await readDocument(env, token, CACHE_COLLECTION + "/" + cacheId);
  if (cacheDoc && cacheDoc.data && Number.isFinite(Number(cacheDoc.data.latitude)) && Number.isFinite(Number(cacheDoc.data.longitude))) {
    const cached = { latitude: Number(cacheDoc.data.latitude), longitude: Number(cacheDoc.data.longitude) };
    inMemory.set(keyText, cached);
    return cached;
  }

  const endpoint = new URL(NOMINATIM_URL);
  endpoint.searchParams.set("q", String(place).slice(0, 160));
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("limit", "1");
  endpoint.searchParams.set("countrycodes", "in");
  const response = await fetch(endpoint.toString(), {
    headers: { "User-Agent": env.ROUTING_USER_AGENT || "OfferHaikyaNotifications/2.0 (contact: support@offerhaikya.com)" },
  });
  if (!response.ok) throw new Error("Free geocoding service unavailable: HTTP " + response.status);
  const result = await response.json();
  if (!Array.isArray(result) || !result.length) {
    inMemory.set(keyText, null);
    return null;
  }
  const latitude = Number(result[0].lat);
  const longitude = Number(result[0].lon);
  if (!validCoordinates(latitude, longitude)) return null;
  const point = { latitude, longitude };
  inMemory.set(keyText, point);
  await writeDocument(env, token, CACHE_COLLECTION + "/" + cacheId, {
    latitude, longitude, query: String(place).slice(0, 160), cachedAt: new Date().toISOString(),
  });
  return point;
}

async function roadDistanceKm(origin, destination) {
  const coordinates = String(origin.longitude) + "," + String(origin.latitude) + ";" +
    String(destination.longitude) + "," + String(destination.latitude);
  const response = await fetch(OSRM_URL + coordinates + "?overview=false&alternatives=false&steps=false", {
    headers: { "User-Agent": "OfferHaikyaNotifications/2.0" },
  });
  if (!response.ok) throw new Error("Free road-routing service unavailable: HTTP " + response.status);
  const data = await response.json();
  const meters = data && data.routes && data.routes[0] && Number(data.routes[0].distance);
  if (data.code !== "Ok" || !Number.isFinite(meters) || meters < 0) return null;
  return meters / 1000;
}

async function cachedRoadDistanceKm(env, token, origin, destination, routeCache) {
  const rounded = (point) => ({
    latitude: Number(Number(point.latitude).toFixed(4)),
    longitude: Number(Number(point.longitude).toFixed(4)),
  });
  const a = rounded(origin);
  const b = rounded(destination);
  const pair = [a, b].sort((left, right) =>
    (left.latitude - right.latitude) || (left.longitude - right.longitude)
  );
  const keyText = pair.map((point) => point.latitude + "," + point.longitude).join("|");
  if (routeCache.has(keyText)) return routeCache.get(keyText);
  const cacheId = "route_" + await sha256Id(keyText);
  const saved = await readDocument(env, token, CACHE_COLLECTION + "/" + cacheId);
  if (saved && saved.data && Number.isFinite(Number(saved.data.roadDistanceKm))) {
    const km = Number(saved.data.roadDistanceKm);
    routeCache.set(keyText, km);
    return km;
  }
  const km = await roadDistanceKm(origin, destination);
  routeCache.set(keyText, km);
  if (Number.isFinite(km)) {
    await writeDocument(env, token, CACHE_COLLECTION + "/" + cacheId, {
      roadDistanceKm: Number(km.toFixed(2)),
      cachedAt: new Date().toISOString(),
      cacheType: "road-distance",
    });
  }
  return km;
}

function getUserPlace(profile) {
  return String(profile.location || profile.locationLabel || profile.areaCity || "").trim();
}

function localOfferPlace(post) {
  if (post.locationName) return post.locationName;
  const labels = post.labels.filter((label) => !isTypeLabel(label) && !/^(expired|verified|lock)$/i.test(label));
  // Tags may contain an explicit location such as "Kolhapur, Maharashtra".
  const tagged = labels.find((label) => /,/.test(label) || /\b(maharashtra|karnataka|goa|gujarat|mumbai|pune|kolhapur|belagavi|sangli|satara)\b/i.test(label));
  return tagged || "";
}

async function getLocalMatch(env, token, post, profile, geocodes, routeCache) {
  const userPlace = getUserPlace(profile);
  const offerPlace = localOfferPlace(post);
  if (!userPlace || !offerPlace) return { matched: false, reason: "LOCATION_MISSING" };

  let userPoint = post.coordinates ? null : null;
  if (profile.locationCoordinates && validCoordinates(Number(profile.locationCoordinates.latitude), Number(profile.locationCoordinates.longitude))) {
    userPoint = { latitude: Number(profile.locationCoordinates.latitude), longitude: Number(profile.locationCoordinates.longitude) };
  } else {
    userPoint = await cachedGeocode(env, token, userPlace, geocodes);
  }

  let offerPoint = post.coordinates;
  if (!offerPoint) offerPoint = await cachedGeocode(env, token, offerPlace, geocodes);
  if (!userPoint || !offerPoint) return { matched: false, reason: "GEOCODING_FAILED" };

  const km = await cachedRoadDistanceKm(env, token, userPoint, offerPoint, routeCache);
  if (!Number.isFinite(km)) return { matched: false, reason: "ROAD_ROUTE_UNAVAILABLE" };
  return {
    matched: km <= MAX_ROAD_DISTANCE_KM,
    reason: km <= MAX_ROAD_DISTANCE_KM ? "ROAD_DISTANCE_MATCH" : "ROAD_DISTANCE_OVER_LIMIT",
    roadDistanceKm: Number(km.toFixed(1)),
    userPlace,
    offerPlace,
  };
}

function findProfileMatch(post, profile) {
  if (profile.profileComplete !== true) return { matched: false, reason: "PROFILE_INCOMPLETE" };
  const type = offerType(post);
  if (type === "unknown") return { matched: false, reason: "OFFER_TYPE_NOT_TAGGED" };
  if (!wantsType(profile, type)) return { matched: false, reason: "OFFER_TYPE_NOT_SELECTED" };
  const category = categoriesMatch(post, profile);
  if (!category) return { matched: false, reason: "NO_CATEGORY_MATCH" };
  return { matched: true, type, category };
}

async function sendEmail(env, profile, post) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) throw new Error("Missing RESEND_API_KEY or RESEND_FROM.");
  const email = String(profile.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { sent: false, reason: "NO_VALID_EMAIL" };
  const title = String(post.title || "New Offerhaikya offer").slice(0, 200);
  const description = String(post.description || "A new offer is available on OfferHaikya.").slice(0, 1000);
  const link = safeHttpUrl(post.url);
  const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escapedDescription = description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [email],
      subject: "New OfferHaikya offer: " + title.slice(0, 140),
      html: "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto\"><h2>" + escapedTitle +
        "</h2><p>" + escapedDescription + "</p><p><a href=\"" + link +
        "\">View offer on OfferHaikya</a></p><p style=\"font-size:12px;color:#666\">You received this because your OfferHaikya profile matches this offer.</p></div>",
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Email provider rejected message: HTTP " + response.status);
  return { sent: true, providerId: result.id || "" };
}

async function sendExpoPush(env, profile, post) {
  const token = String(profile.expoPushToken || "").trim();
  if (!token || !/^ExponentPushToken\[.+\]$/.test(token)) return { sent: false, reason: "NO_EXPO_TOKEN" };
  const response = await fetch(EXPO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: token,
      sound: "default",
      title: String(post.title || "New OfferHaikya offer").slice(0, 100),
      body: String(post.description || "A new offer is available.").slice(0, 180),
      data: { postId: post.id, url: safeHttpUrl(post.url), offerType: offerType(post) },
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.data && result.data.status === "error") throw new Error("Expo push provider rejected message.");
  return { sent: true };
}

async function deliverOnce(env, token, post, profileDoc, channel, sendFn) {
  const deliveryId = await sha256Id(post.id + "::" + profileDoc.id + "::" + channel);
  const path = DELIVERY_COLLECTION + "/" + deliveryId;
  const existing = await readDocument(env, token, path);
  if (existing && existing.data && existing.data.status === "sent") return { status: "already-sent" };
  try {
    const result = await sendFn();
    if (!result.sent) return { status: "skipped", reason: result.reason || "not-sent" };
    await writeDocument(env, token, path, {
      postId: post.id,
      userId: profileDoc.id,
      channel,
      status: "sent",
      sentAt: new Date().toISOString(),
      providerId: result.providerId || "",
    });
    return { status: "sent" };
  } catch (error) {
    await writeDocument(env, token, path, {
      postId: post.id,
      userId: profileDoc.id,
      channel,
      status: "failed",
      lastError: safeError(error),
      attemptedAt: new Date().toISOString(),
    });
    return { status: "failed", reason: safeError(error) };
  }
}

async function fetchBloggerPosts() {
  const url = FEED_URL + "?alt=json&max-results=500&notification_v2=" + Date.now();
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  if (!response.ok) throw new Error("Blogger feed request failed: HTTP " + response.status);
  const posts = parseBloggerFeed(await response.json());
  return posts.sort((a, b) => (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0));
}

async function runSafeTest(env) {
  const token = await getFirebaseAccessToken(env);
  const posts = (await fetchBloggerPosts()).filter((post) => !isExpired(post)).slice(-10).reverse();
  const profiles = await listCollection(env, token, PROFILE_COLLECTION);
  const geocodes = new Map();
  const routeCache = new Map();
  const results = [];

  for (const post of posts) {
    const type = offerType(post);
    const matched = [];
    let skippedRoutes = 0;
    for (const profileDoc of profiles) {
      const profile = profileDoc.data || {};
      const basic = findProfileMatch(post, profile);
      if (!basic.matched) continue;
      let locationMatch = { matched: true, reason: "ONLINE_CATEGORY_MATCH" };
      if (type === "local") {
        try {
          locationMatch = await getLocalMatch(env, token, post, profile, geocodes, routeCache);
        } catch (error) {
          locationMatch = { matched: false, reason: "ROUTING_SERVICE_ERROR" };
        }
        if (!locationMatch.matched) {
          if (["ROAD_ROUTE_UNAVAILABLE", "GEOCODING_FAILED", "LOCATION_MISSING", "ROUTING_SERVICE_ERROR"].includes(locationMatch.reason)) skippedRoutes++;
          continue;
        }
      }
      matched.push({
        userId: profileDoc.id,
        category: basic.category,
        type,
        roadDistanceKm: locationMatch.roadDistanceKm || null,
        matchReason: locationMatch.reason,
      });
    }
    results.push({
      postId: post.id,
      title: post.title,
      type,
      categories: postCategories(post),
      matchingProfiles: matched.length,
      skippedBecauseLocationOrRouteUnavailable: skippedRoutes,
      matches: matched,
    });
  }
  return {
    ok: true,
    worker: VERSION,
    mode: "SAFE_TEST_NO_DELIVERY",
    profilesChecked: profiles.length,
    postsChecked: results.length,
    results,
    notificationsSent: 0,
    stateChanged: false,
    message: "Dry run only. No emails or push notifications were sent. Geocoding cache entries may be saved.",
  };
}

async function runNotificationCycle(env) {
  const token = await getFirebaseAccessToken(env);
  const posts = await fetchBloggerPosts();
  if (!posts.length) throw new Error("Blogger feed returned no posts.");
  const stateDoc = await readDocument(env, token, STATE_DOC);
  const latestTimestamp = Math.max(...posts.map((post) => Date.parse(post.publishedAt) || 0), 0);

  // First run seeds the current feed timestamp and deliberately sends nothing,
  // preventing a mass notification blast when the new Worker is first enabled.
  if (!stateDoc || !stateDoc.data || !stateDoc.data.lastScanAt) {
    await writeDocument(env, token, STATE_DOC, {
      lastScanAt: new Date(latestTimestamp || Date.now()).toISOString(),
      initializedAt: new Date().toISOString(),
      workerVersion: VERSION,
    });
    return {
      ok: true,
      worker: VERSION,
      initialized: true,
      notificationsSent: 0,
      message: "Initial baseline saved. No notifications sent. Publish a new post to test live delivery.",
    };
  }

  const lastScanMs = Date.parse(stateDoc.data.lastScanAt) || 0;
  const newPosts = posts.filter((post) => {
    const published = Date.parse(post.publishedAt) || 0;
    return published > lastScanMs && !isExpired(post);
  });
  if (!newPosts.length) {
    return { ok: true, worker: VERSION, initialized: true, newPosts: 0, notificationsSent: 0, message: "No new offers." };
  }

  const profiles = await listCollection(env, token, PROFILE_COLLECTION);
  const geocodes = new Map();
  const routeCache = new Map();
  const summary = [];
  let hadDeliveryFailure = false;
  let notificationCount = 0;

  for (const post of newPosts) {
    const type = offerType(post);
    const category = postCategories(post);
    let matchedProfiles = 0;
    let emailSent = 0;
    let pushSent = 0;
    let routeSkipped = 0;

    for (const profileDoc of profiles) {
      const profile = profileDoc.data || {};
      const basic = findProfileMatch(post, profile);
      if (!basic.matched) continue;

      let locationMatch = { matched: true, reason: "ONLINE_CATEGORY_MATCH" };
      if (type === "local") {
        try {
          locationMatch = await getLocalMatch(env, token, post, profile, geocodes, routeCache);
        } catch (error) {
          locationMatch = { matched: false, reason: "ROUTING_SERVICE_ERROR" };
        }
        if (!locationMatch.matched) {
          if (locationMatch.reason === "ROAD_ROUTE_UNAVAILABLE" || locationMatch.reason === "GEOCODING_FAILED" || locationMatch.reason === "LOCATION_MISSING") routeSkipped++;
          continue;
        }
      }

      matchedProfiles++;
      const emailResult = await deliverOnce(env, token, post, profileDoc, "email", () => sendEmail(env, profile, post));
      if (emailResult.status === "sent") { emailSent++; notificationCount++; }
      if (emailResult.status === "failed") hadDeliveryFailure = true;

      if (env.EXPO_PUSH_ENABLED === "true") {
        const pushResult = await deliverOnce(env, token, post, profileDoc, "expo", () => sendExpoPush(env, profile, post));
        if (pushResult.status === "sent") { pushSent++; notificationCount++; }
        if (pushResult.status === "failed") hadDeliveryFailure = true;
      }
    }

    summary.push({
      postId: post.id,
      title: post.title,
      offerType: type,
      categories: category,
      matchedProfiles,
      emailSent,
      expoPushSent: pushSent,
      localRoutesSkipped: routeSkipped,
    });
  }

  // Do not advance the scan cursor if any provider failed: failed deliveries
  // can be retried next run. Successful channel deliveries are idempotent.
  if (!hadDeliveryFailure) {
    const newestMs = Math.max(...newPosts.map((post) => Date.parse(post.publishedAt) || 0));
    await writeDocument(env, token, STATE_DOC, {
      lastScanAt: new Date(newestMs).toISOString(),
      updatedAt: new Date().toISOString(),
      workerVersion: VERSION,
    });
  }

  return {
    ok: !hadDeliveryFailure,
    worker: VERSION,
    newPosts: newPosts.length,
    notificationsSent: notificationCount,
    retryNeeded: hadDeliveryFailure,
    summary,
    message: hadDeliveryFailure
      ? "Some deliveries failed. Scan cursor was not advanced; failed channels can retry without duplicating successful sends."
      : "Notification cycle completed.",
  };
}
