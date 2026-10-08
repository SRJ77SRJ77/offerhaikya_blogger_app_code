const FEED_URL = "https://www.offerhaikya.com/feeds/posts/default";
const WORKER_VERSION = "PRODUCTION_DEDUP_V1";

// PRODUCTION NOTIFICATION WORKER.
// Sends Expo push notifications only for a Blogger post that has not already been processed.
// Firestore notification state is written only after Expo accepts the push request.

const GPS_FRESH_MS = 5 * 60 * 1000;

const stripHtml = (value = "") =>
  String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const firstImage = (html = "") => {
  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || "";
};

const highResImage = (url = "") =>
  String(url)
    .replace(/\/s\d+(-c)?\//i, "/s800/")
    .replace(/=w\d+(-h\d+)?(-p)?/i, "=s800")
    .replace(/\/w\d+(-h\d+)?\//i, "/s800/");

const normalizeText = (value = "") =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractMapCoordinates = (html = "") => {
  const text = String(html);
  const coordinateMatch = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (coordinateMatch) {
    return {
      latitude: Number(coordinateMatch[1]),
      longitude: Number(coordinateMatch[2]),
    };
  }

  const queryMatch = text.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i);
  if (queryMatch) {
    return {
      latitude: Number(queryMatch[1]),
      longitude: Number(queryMatch[2]),
    };
  }

  return null;
};

const extractBloggerLocation = (entry, content = "") => {
  const rawLocation = entry?.location || entry?.["gd$where"] || entry?.["georss$where"];
  const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;

  const name =
    location?.name?.$t ||
    location?.name ||
    location?.["gd$name"]?.$t ||
    location?.["gd$name"] ||
    location?.valueString ||
    location?.["valueString"] ||
    entry?.["gd$where"]?.name?.$t ||
    entry?.["gd$where"]?.name ||
    entry?.["gd$where"]?.valueString ||
    "";

  const pointText =
    location?.["georss$point"]?.$t ||
    location?.["georss$point"] ||
    entry?.["georss$point"]?.$t ||
    entry?.["georss$point"] ||
    "";

  const pointParts = String(pointText).trim().split(/[ ,]+/).filter(Boolean);
  const pointLatitude = Number(pointParts[0]);
  const pointLongitude = Number(pointParts[1]);

  const latitude = Number(
    location?.lat ??
    location?.latitude ??
    pointLatitude ??
    NaN
  );

  const longitude = Number(
    location?.lng ??
    location?.longitude ??
    pointLongitude ??
    NaN
  );

  const coordinates =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : extractMapCoordinates(content);

  return {
    name: String(name || "").trim(),
    coordinates,
  };
};

const parseFeed = (data) => {
  const entries = data?.feed?.entry || [];

  return entries.map((entry, index) => {
    const links = entry.link || [];
    const alternate = links.find((item) => item.rel === "alternate");

    const content =
      entry.content?.$t ||
      entry.summary?.$t ||
      "";

    const labels = (entry.category || [])
      .map((item) => item.term)
      .filter(Boolean);

    const location = extractBloggerLocation(entry, content);

    return {
      id: entry.id?.$t || String(index),
      title: entry.title?.$t || "New Offerhaikya offer",
      url: alternate?.href || "https://www.offerhaikya.com",
      publishedAt: entry.published?.$t || entry.updated?.$t || "",
      date: entry.published?.$t || entry.updated?.$t || "",
      label: labels[0] || "Offers",
      labels,
      image: highResImage(firstImage(content) || entry.media$thumbnail?.url || ""),
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
      content: stripHtml(content),
      rawContent: content,
      locationName: location.name,
      locationCoordinates: location.coordinates || undefined,
    };
  });
};

// --------------------------------------------------
// FIREBASE AUTH
// --------------------------------------------------

const base64UrlEncode = (input) => {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const pemToArrayBuffer = (pem) => {
  const base64 = String(pem)
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
};

const getFirebaseMessagingAccessToken = async (env) => {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsignedToken =
    base64UrlEncode(JSON.stringify(header)) +
    "." +
    base64UrlEncode(JSON.stringify(payload));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt = unsignedToken + "." + base64UrlEncode(signature);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=" +
      encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") +
      "&assertion=" +
      encodeURIComponent(jwt),
  });

  if (!response.ok) {
    throw new Error(
      "Firebase Messaging OAuth failed: HTTP " +
        response.status +
        " " +
        (await response.text())
    );
  }

  return (await response.json()).access_token;
};

const getFirebaseAccessToken = async (env) => {
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsignedToken =
    base64UrlEncode(JSON.stringify(header)) +
    "." +
    base64UrlEncode(JSON.stringify(payload));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const jwt = unsignedToken + "." + base64UrlEncode(signature);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=" +
      encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") +
      "&assertion=" +
      encodeURIComponent(jwt),
  });

  if (!response.ok) {
    throw new Error(
      "Firebase OAuth failed: HTTP " +
      response.status +
      " " +
      (await response.text())
    );
  }

  return (await response.json()).access_token;
};

// --------------------------------------------------
// FIRESTORE HELPERS
// --------------------------------------------------

const firestoreDocumentUrl = (env, path) =>
  "https://firestore.googleapis.com/v1/projects/" +
  env.FIREBASE_PROJECT_ID +
  "/databases/(default)/documents/" +
  path;

const readFirestoreValue = (value) => {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;

  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(readFirestoreValue);
  }

  if ("mapValue" in value) {
    const result = {};
    for (const [key, item] of Object.entries(value.mapValue.fields || {})) {
      result[key] = readFirestoreValue(item);
    }
    return result;
  }

  return null;
};

const firestoreDocumentToObject = (document) => {
  const result = {};
  for (const [key, value] of Object.entries(document?.fields || {})) {
    result[key] = readFirestoreValue(value);
  }
  return result;
};

const getNotificationState = async (env, accessToken) => {
  const response = await fetch(
    firestoreDocumentUrl(env, "notificationState/bloggerFeed"),
    { headers: { Authorization: "Bearer " + accessToken } }
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(
      "Firestore state read failed: HTTP " +
      response.status +
      " " +
      (await response.text())
    );
  }

  return firestoreDocumentToObject(await response.json());
};

const writeNotificationState = async (env, accessToken, state) => {
  const url = firestoreDocumentUrl(env, "notificationState/bloggerFeed");
  const fields = {};

  for (const [key, value] of Object.entries(state || {})) {
    if (typeof value === "string") {
      fields[key] = { stringValue: value };
    } else if (typeof value === "boolean") {
      fields[key] = { booleanValue: value };
    } else if (typeof value === "number" && Number.isInteger(value)) {
      fields[key] = { integerValue: String(value) };
    }
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    throw new Error(
      "Firestore state write failed: HTTP " +
      response.status +
      " " +
      (await response.text())
    );
  }

  return firestoreDocumentToObject(await response.json());
};

const getEligibleUsers = async (env, accessToken) => {
  const url =
    "https://firestore.googleapis.com/v1/projects/" +
    env.FIREBASE_PROJECT_ID +
    "/databases/(default)/documents/users?pageSize=100";

  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken },
  });

  if (!response.ok) {
    throw new Error(
      "Firestore users read failed: HTTP " +
      response.status +
      " " +
      (await response.text())
    );
  }

  const result = await response.json();
  const documents = result.documents || [];
  const users = [];

  for (const document of documents) {
    const data = firestoreDocumentToObject(document);

    if (
      data?.registrationCompleted === true &&
      data?.notificationsEnabled === true &&
      typeof data?.expoPushToken === "string" &&
      data.expoPushToken.startsWith("ExponentPushToken[")
    ) {
      users.push({
        userId: String(document.name || "").split("/").pop(),
        data,
        token: data.expoPushToken,
      });
    }
  }

  return users;
};

// --------------------------------------------------
// LOCATION + OFFER MATCHING
// --------------------------------------------------

const isFiniteCoordinate = (value) =>
  value &&
  Number.isFinite(Number(value.latitude)) &&
  Number.isFinite(Number(value.longitude));

const getUserLocationInfo = (user) => {
  const data = user?.data || {};
  const now = Date.now();

  const storedLocation = isFiniteCoordinate(data.location)
    ? {
        latitude: Number(data.location.latitude),
        longitude: Number(data.location.longitude),
      }
    : null;

  const manualLocation = isFiniteCoordinate(data.manualLocationCoordinates)
    ? {
        latitude: Number(data.manualLocationCoordinates.latitude),
        longitude: Number(data.manualLocationCoordinates.longitude),
      }
    : null;

  const updatedAtMs = data.locationUpdatedAt
    ? Date.parse(String(data.locationUpdatedAt))
    : NaN;

  const recentGps =
    data.locationSource === "gps" &&
    Number.isFinite(updatedAtMs) &&
    now - updatedAtMs >= 0 &&
    now - updatedAtMs <= GPS_FRESH_MS &&
    storedLocation;

  if (recentGps) {
    return {
      mode: "CURRENT_GPS",
      coordinates: storedLocation,
      label:
        data.locationLabel ||
        data.areaCity ||
        "",
      updatedAt: data.locationUpdatedAt || "",
    };
  }

  const fallbackCoordinates = manualLocation || storedLocation;

  return {
    mode: "SAVED_LOCATION",
    coordinates: fallbackCoordinates,
    label:
      data.locationLabel ||
      data.areaCity ||
      data.manualLocationLabel ||
      "",
    updatedAt: data.locationUpdatedAt || "",
  };
};

const isOfflineOffer = (post) => {
  const labels = (post.labels || []).map(normalizeText);

  return labels.some((label) =>
    [
      "offline offer",
      "offline",
      "local offer",
      "local",
    ].includes(label)
  );
};

const locationTermsFromUser = (userLocation, userData) => {
  const values = [
    userLocation?.label,
    userData?.locationLabel,
    userData?.areaCity,
    userData?.manualLocationLabel,
  ];

  return [...new Set(
    values
      .map(normalizeText)
      .filter(Boolean)
  )];
};

const getOfflineMatch = (post, user) => {
  const userData = user.data || {};
  const locationInfo = getUserLocationInfo(user);

  // Coordinates are the primary nearby check. This is important when the
  // saved/current user label is a small area name such as "Camp" while the
  // Blogger offer uses a city name or only has a map location.
  if (isFiniteCoordinate(locationInfo.coordinates) && isFiniteCoordinate(post.locationCoordinates)) {
    const km = distanceKm(locationInfo.coordinates, post.locationCoordinates);

    if (km <= 300) {
      return {
        matched: true,
        reason: "COORDINATE_MATCH",
        distanceKm: Number(km.toFixed(1)),
        locationMode: locationInfo.mode,
        userLocation: locationInfo.label || "",
      };
    }
  }

  // Text matching remains as a fallback for offers without usable map
  // coordinates.
  const userTerms = locationTermsFromUser(locationInfo, userData);

  if (!userTerms.length) {
    return {
      matched: false,
      reason: "NO_USER_LOCATION_TEXT_OR_COORDINATES",
      locationMode: locationInfo.mode,
      userLocation: locationInfo.label || "",
    };
  }

  const fields = [
    ["TITLE", post.title],
    ["TAGS", (post.labels || []).join(" ")],
    ["LOCATION", post.locationName],
    ["DESCRIPTION", post.content],
  ];

  for (const [field, value] of fields) {
    const normalizedField = normalizeText(value);

    for (const term of userTerms) {
      if (term && normalizedField.includes(term)) {
        return {
          matched: true,
          reason: "LOCATION_MATCH_" + field,
          matchedTerm: term,
          locationMode: locationInfo.mode,
          userLocation: locationInfo.label || "",
        };
      }
    }
  }

  return {
    matched: false,
    reason: "NO_LOCATION_MATCH",
    locationMode: locationInfo.mode,
    userLocation: locationInfo.label || "",
  };
};

const getOnlineMatch = (post, user) => {
  const interestedCategories = Array.isArray(user.data?.interestedCategories)
    ? user.data.interestedCategories.map(normalizeText).filter(Boolean)
    : [];

  const postLabels = (post.labels || []).map(normalizeText).filter(Boolean);

  for (const category of interestedCategories) {
    if (postLabels.includes(category)) {
      return {
        matched: true,
        reason: "CATEGORY_MATCH",
        matchedCategory: category,
      };
    }
  }

  return {
    matched: false,
    reason: interestedCategories.length
      ? "NO_CATEGORY_MATCH"
      : "NO_INTERESTED_CATEGORIES",
  };
};

const findNotificationMatches = (post, eligibleUsers) => {
  const offline = isOfflineOffer(post);

  return eligibleUsers.map((user) => {
    const interestedCategories = Array.isArray(user.data?.interestedCategories)
      ? user.data.interestedCategories.map(normalizeText).filter(Boolean)
      : [];

    const wantsOfflineOffers = interestedCategories.some((category) =>
      category === "offline offer" ||
      category === "offline offers"
    );

    // Offline/local notifications require BOTH the user's Offline Offer
    // category preference and a nearby/location match.
    const match = offline
      ? wantsOfflineOffers
        ? getOfflineMatch(post, user)
        : {
            matched: false,
            reason: "NO_OFFLINE_CATEGORY_SUBSCRIPTION",
          }
      : getOnlineMatch(post, user);

    return {
      userId: user.userId,
      tokenEnding: user.token.slice(-8),
      offerType: offline ? "OFFLINE" : "ONLINE",
      matched: match.matched,
      reason: match.reason,
      matchedTerm: match.matchedTerm || null,
      matchedCategory: match.matchedCategory || null,
      locationMode: match.locationMode || null,
      userLocation: match.userLocation || null,
    };
  });
};

// --------------------------------------------------
// LIVE PUSH TEST
// --------------------------------------------------

const sendExpoPushNotifications = async (messages) => {
  if (!messages.length) {
    return { ok: true, sent: 0, responses: [] };
  }

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error("Expo push failed: HTTP " + response.status + " " + text);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    ok: true,
    sent: messages.length,
    responses: data?.data || data,
  };
};

const getLatestBloggerPost = async () => {
  const feedResponse = await fetch(
    FEED_URL + "?alt=json&max-results=500&ohk_cloudflare_notification=" + Date.now(),
    {
      headers: {
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
    }
  );

  if (!feedResponse.ok) {
    throw new Error(
      "Unable to read Offerhaikya Blogger feed: HTTP " +
      feedResponse.status
    );
  }

  const posts = parseFeed(await feedResponse.json());

  if (!posts.length) {
    throw new Error("Blogger feed is empty.");
  }

  return {
    posts,
    post: posts[0],
  };
};

const buildPushMessages = (post, eligibleUsers, matches) => {
  const matchedIds = new Set(
    matches
      .filter((item) => item.matched)
      .map((item) => item.userId)
  );

  return eligibleUsers
    .filter((user) => matchedIds.has(user.userId))
    .map((user) => ({
      to: user.token,
      sound: "default",
      title: post.title,
      body: post.excerpt || "A new Offerhaikya offer is available.",
      data: {
        postId: post.id,
        title: post.title,
        url: post.url,
        date: post.date,
        publishedAt: post.publishedAt,
        label: post.label,
        labels: post.labels,
        image: post.image,
        excerpt: post.excerpt,
        content: post.content,
        rawContent: post.rawContent,
        locationName: post.locationName,
        locationCoordinates: post.locationCoordinates || null,
        offerType: isOfflineOffer(post) ? "OFFLINE" : "ONLINE",
      },
    }));
};

const runProductionNotification = async (env) => {
  const { posts, post } = await getLatestBloggerPost();
  const accessToken = await getFirebaseAccessToken(env);
  const state = await getNotificationState(env, accessToken);

  if (!state) {
    return {
      ok: true,
      mode: "PRODUCTION_NOTIFICATION",
      workerVersion: WORKER_VERSION,
      bloggerPosts: posts.length,
      latestPostId: post.id,
      latestPostTitle: post.title,
      processed: false,
      pushSent: 0,
      firestoreStateChanged: false,
      message:
        "Notification state is not initialized. Seed the current latest Blogger post before enabling automatic notifications.",
    };
  }

  if (state.lastProcessedPostId === post.id) {
    return {
      ok: true,
      mode: "PRODUCTION_NOTIFICATION",
      workerVersion: WORKER_VERSION,
      bloggerPosts: posts.length,
      latestPostId: post.id,
      latestPostTitle: post.title,
      processed: false,
      duplicate: true,
      pushSent: 0,
      firestoreStateChanged: false,
      message:
        "This Blogger post was already processed. No push notification was sent.",
    };
  }

  const eligibleUsers = await getEligibleUsers(env, accessToken);
  const matches = findNotificationMatches(post, eligibleUsers);
  const matchedUsers = matches.filter((item) => item.matched);
  const messages = buildPushMessages(post, eligibleUsers, matches);

  const expo = await sendExpoPushNotifications(messages);

  await writeNotificationState(env, accessToken, {
    lastProcessedPostId: post.id,
    lastProcessedPublishedAt: post.publishedAt || "",
    lastProcessedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    mode: "PRODUCTION_NOTIFICATION",
    workerVersion: WORKER_VERSION,
    bloggerPosts: posts.length,
    processed: true,
    post: {
      postId: post.id,
      title: post.title,
      offerType: isOfflineOffer(post) ? "OFFLINE" : "ONLINE",
      labels: post.labels,
      locationName: post.locationName || "",
    },
    eligibleUsers: eligibleUsers.length,
    matchedUsers: matchedUsers.length,
    matches,
    pushSent: expo.sent,
    expoResponse: expo.responses,
    firestoreStateChanged: true,
    message:
      "New Blogger post processed. Push notifications were sent to matched users and the post was recorded in Firestore.",
  };
};

const seedCurrentPost = async (env) => {
  const { posts, post } = await getLatestBloggerPost();
  const accessToken = await getFirebaseAccessToken(env);

  const state = await writeNotificationState(env, accessToken, {
    lastProcessedPostId: post.id,
    lastProcessedPublishedAt: post.publishedAt || "",
    lastProcessedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    mode: "SEED_CURRENT_POST",
    workerVersion: WORKER_VERSION,
    bloggerPosts: posts.length,
    seededPost: {
      postId: post.id,
      title: post.title,
      publishedAt: post.publishedAt,
    },
    firestoreStateChanged: true,
    pushSent: 0,
    message:
      "Current latest Blogger post was recorded as already processed. No push notification was sent.",
    state,
  };
};


// --------------------------------------------------
// SAFE TEST
// --------------------------------------------------

const runSafeTest = async (env) => {
  const feedResponse = await fetch(
    FEED_URL +
      "?alt=json&max-results=500&ohk_cloudflare_test=" +
      Date.now(),
    {
      headers: {
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
    }
  );

  if (!feedResponse.ok) {
    throw new Error(
      "Unable to read Offerhaikya Blogger feed: HTTP " +
      feedResponse.status
    );
  }

  const posts = parseFeed(await feedResponse.json());

  if (!posts.length) {
    return {
      ok: true,
      mode: "SAFE_TEST_NO_PUSH",
      message: "Blogger feed is empty.",
      pushSent: false,
    };
  }

  const accessToken = await getFirebaseAccessToken(env);
  const state = await getNotificationState(env, accessToken);
  const eligibleUsers = await getEligibleUsers(env, accessToken);

  // Safe test evaluates the latest Blogger posts even when there are no new posts.
  // This lets us test matching without publishing another offer.
  const testPosts = posts.slice(0, 10);

  const results = testPosts.map((post) => {
    const matches = findNotificationMatches(post, eligibleUsers);
    const matched = matches.filter((item) => item.matched);

    return {
      postId: post.id,
      title: post.title,
      offerType: isOfflineOffer(post) ? "OFFLINE" : "ONLINE",
      labels: post.labels,
      locationName: post.locationName || "",
      matchedUsers: matched.length,
      noMatchUsers: matches.length - matched.length,
      matches,
    };
  });

  return {
    ok: true,
    mode: "SAFE_TEST_NO_PUSH",
    workerVersion: WORKER_VERSION,
    bloggerPosts: posts.length,
    testedPosts: testPosts.length,
    stateExists: Boolean(state),
    eligibleUsers: eligibleUsers.length,
    results,
    pushSent: false,
    firestoreStateChanged: false,
    message:
      "Safe matching test completed. No push notifications were sent and Firestore state was not changed.",
  };
};


const sendDirectFcmTest = async (env, fcmToken) => {
  const token = String(fcmToken || "").trim();

  if (!token) {
    throw new Error("An FCM registration token is required.");
  }

  const accessToken = await getFirebaseMessagingAccessToken(env);
  const endpoint =
    "https://fcm.googleapis.com/v1/projects/" +
    env.FIREBASE_PROJECT_ID +
    "/messages:send";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: "Offerhaikya FCM Test",
          body: "Direct Firebase FCM test.",
        },
        data: {
          test: "true",
          source: "offerhaikya-direct-fcm-test",
        },
        android: {
          priority: "HIGH",
        },
      },
    }),
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      response: data,
    };
  }

  return {
    ok: true,
    httpStatus: response.status,
    response: data,
  };
};

const getExpoPushReceipts = async (ids) => {
  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      "Expo receipt check failed: HTTP " + response.status + " " + text
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return data;
};

// --------------------------------------------------
// WORKER
// --------------------------------------------------

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (
        request.method === "POST" &&
        url.searchParams.get("mode") === "fcm-test"
      ) {
        const secret = url.searchParams.get("secret") || "";

        if (secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const fcmToken = body?.fcmToken || "";

        const result = await sendDirectFcmTest(env, fcmToken);

        return new Response(
          JSON.stringify(
            {
              ok: result.ok,
              mode: "DIRECT_FCM_TEST",
              result,
            },
            null,
            2
          ),
          {
            status: result.ok ? 200 : 502,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (request.method === "GET" && url.searchParams.get("mode") === "test-push") {
        const secret = url.searchParams.get("secret") || "";

        if (secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const token = "ExponentPushToken[mOlLAwB2puKFH03y7RDp0U]";

        const result = await sendExpoPushNotifications([
          {
            to: token,
            sound: "default",
            title: "Offerhaikya Test",
            body: "If you received this, push notifications are working.",
            data: {
              test: true,
              message: "Offerhaikya fresh token test",
            },
          },
        ]);

        return new Response(
          JSON.stringify({
            ok: true,
            mode: "TEST_PUSH",
            result,
          }, null, 2),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (request.method === "GET" && url.searchParams.get("mode") === "receipts") {
        const secret = url.searchParams.get("secret") || "";

        if (secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const ids = (url.searchParams.get("ids") || "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);

        if (!ids.length) {
          return new Response(
            JSON.stringify({
              ok: false,
              message: "No Expo receipt IDs were provided.",
            }, null, 2),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        const receipts = await getExpoPushReceipts(ids);

        return new Response(
          JSON.stringify({
            ok: true,
            mode: "EXPO_RECEIPT_CHECK",
            receiptIds: ids,
            receipts,
          }, null, 2),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (
        request.method === "GET" &&
        !url.searchParams.has("hub.mode")
      ) {
        return new Response(
          "Offerhaikya Cloudflare Worker is running.",
          {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }
        );
      }

      if (
        request.method === "GET" &&
        url.searchParams.get("hub.mode") === "subscribe"
      ) {
        const verifyToken =
          url.searchParams.get("hub.verify_token") || "";

        if (verifyToken !== env.WEBHOOK_SECRET) {
          return new Response("Verification failed", { status: 403 });
        }

        return new Response(
          url.searchParams.get("hub.challenge") || "",
          {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }
        );
      }

      if (request.method === "GET" && url.searchParams.get("mode") === "receipts") {
        const secret = url.searchParams.get("secret") || "";

        if (secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const ids = (url.searchParams.get("ids") || "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);

        if (!ids.length) {
          return new Response(
            JSON.stringify({
              ok: false,
              message: "No Expo receipt IDs were provided.",
            }, null, 2),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        const receipts = await getExpoPushReceipts(ids);

        return new Response(
          JSON.stringify({
            ok: true,
            mode: "EXPO_RECEIPT_CHECK",
            receiptIds: ids,
            receipts,
          }, null, 2),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (request.method === "POST") {
        const mode = url.searchParams.get("mode") || "production";
        const secret = url.searchParams.get("secret") || "";

        if (mode === "seed") {
          if (secret !== env.WEBHOOK_SECRET) {
            return new Response("Unauthorized", { status: 401 });
          }

          const result = await seedCurrentPost(env);

          return new Response(
            JSON.stringify(result, null, 2),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        const result = await runProductionNotification(env);

        return new Response(
          JSON.stringify(result, null, 2),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response("Method not allowed", { status: 405 });
    } catch (error) {
      console.error(error);

      return new Response(
        JSON.stringify({
          ok: false,
          error: error?.message || String(error),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};
