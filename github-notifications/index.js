const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const FEED_URL = 'https://www.offerhaikya.com/feeds/posts/default';
const STATE_PATH = 'notificationState/bloggerFeed';
const NEARBY_RADIUS_KM = 300;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const normalizeText = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripHtml = (value = '') =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const firstImage = (html = '') => html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';

const highResImage = (url = '') =>
  url
    .replace(/\/s\d+(-c)?\//i, '/s800/')
    .replace(/=w\d+(-h\d+)?(-p)?/i, '=s800')
    .replace(/\/w\d+(-h\d+)?\//i, '/s800/');

const extractMapCoordinates = (html = '') => {
  const match = html.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (match) return { latitude: Number(match[1]), longitude: Number(match[2]) };

  const query = html.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i);
  if (query) return { latitude: Number(query[1]), longitude: Number(query[2]) };

  return null;
};

const distanceKm = (a, b) => {
  const earthRadiusKm = 6371;
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
};

const locationAliases = {
  belagavi: ['belagavi', 'belgavi', 'belgaum', 'belgaon', 'belagavi district', 'belgavi district', 'belgaum district'],
  belgaum: ['belagavi', 'belgavi', 'belgaum', 'belgaon', 'belagavi district', 'belgavi district', 'belgaum district'],
  bengaluru: ['bengaluru', 'bangalore'],
  bangalore: ['bengaluru', 'bangalore'],
  bombay: ['mumbai', 'bombay'],
  mumbai: ['mumbai', 'bombay'],
  calcutta: ['kolkata', 'calcutta'],
  kolkata: ['kolkata', 'calcutta'],
  madras: ['chennai', 'madras'],
  chennai: ['chennai', 'madras'],
};

const buildLocationTerms = (...values) => {
  const raw = values
    .flat()
    .map(value => String(value || '').trim())
    .filter(Boolean);

  const expanded = raw.flatMap(value => {
    const normalized = normalizeText(value);
    const aliases = locationAliases[normalized] || [];
    const belagaviAliases = /belagavi|belgaum|belgaon/i.test(value)
      ? locationAliases.belagavi
      : [];
    return [value, ...aliases, ...belagaviAliases];
  });

  return [...new Set(expanded.map(normalizeText).filter(Boolean))];
};

const isLocalOffer = post => {
  const labels = [...post.labels, post.label].map(normalizeText).filter(Boolean);
  return labels.some(label => label.includes('offline offer') || label.includes('local offer'));
};

const getUserLocationMatch = (post, user) => {
  const data = user.data || {};
  const current = data.location;
  const manual = data.manualLocationCoordinates;

  const currentCoords =
    current &&
    Number.isFinite(Number(current.latitude)) &&
    Number.isFinite(Number(current.longitude))
      ? { latitude: Number(current.latitude), longitude: Number(current.longitude) }
      : null;

  const manualCoords =
    manual &&
    Number.isFinite(Number(manual.latitude)) &&
    Number.isFinite(Number(manual.longitude))
      ? { latitude: Number(manual.latitude), longitude: Number(manual.longitude) }
      : null;

  const selectedCoords = currentCoords || manualCoords;
  const selectedLocationType = currentCoords ? 'CURRENT' : manualCoords ? 'SAVED' : 'NONE';

  const locationTerms = buildLocationTerms(
    data.locationLabel,
    data.areaCity,
    data.location?.city,
    data.location?.district,
    data.location?.region,
  );

  const offerText = [
    normalizeText(post.title),
    normalizeText(post.content),
    normalizeText(post.rawContent),
  ].join(' ');

  const textMatch = locationTerms.some(term => offerText.includes(term));

  const postLocation = extractMapCoordinates(post.rawContent);
  const distanceMatch =
    Boolean(selectedCoords && postLocation) &&
    distanceKm(selectedCoords, postLocation) <= NEARBY_RADIUS_KM;

  return {
    source: selectedLocationType,
    hasLocation: Boolean(selectedCoords || locationTerms.length),
    matched: textMatch || distanceMatch,
  };
};

const parseFeed = data => {
  const entries = data?.feed?.entry || [];
  return entries.map((entry, index) => {
    const links = entry.link || [];
    const alternate = links.find(item => item.rel === 'alternate');
    const content = entry.content?.$t || entry.summary?.$t || '';
    const labels = (entry.category || []).map(item => item.term).filter(Boolean);

    return {
      id: entry.id?.$t || String(index),
      title: entry.title?.$t || 'New Offerhaikya Offer',
      url: alternate?.href || 'https://www.offerhaikya.com',
      publishedAt: entry.published?.$t || entry.updated?.$t || '',
      date: entry.published?.$t || entry.updated?.$t || '',
      label: labels[0] || 'Offers',
      labels,
      image: highResImage(firstImage(content) || entry.media$thumbnail?.url || ''),
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
      content: stripHtml(content),
      rawContent: content,
    };
  });
};

const sendExpoPushMessages = async messages => {
  for (let start = 0; start < messages.length; start += 100) {
    const batch = messages.slice(start, start + 100);
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error('Expo Push Service returned HTTP ' + response.status);
    }

    console.log('Expo push response:', JSON.stringify(await response.json()));
  }
};

const run = async () => {
  const response = await fetch(
    FEED_URL + '?alt=json&max-results=500&ohk_github_notification_check=' + Date.now(),
    { headers: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' } },
  );
  if (!response.ok) throw new Error('Unable to read Offerhaikya Blogger feed');

  const posts = parseFeed(await response.json());
  console.log('Blogger feed posts:', posts.length, posts[0] ? { id: posts[0].id, title: posts[0].title, publishedAt: posts[0].publishedAt } : null);
  if (!posts.length) {
    console.log('No Blogger posts found; nothing to notify.');
    return;
  }

  const stateRef = db.doc(STATE_PATH);
  const stateSnapshot = await stateRef.get();
  const state = stateSnapshot.exists ? stateSnapshot.data() : null;
  const previousPosts = state?.posts || {};

  const currentPosts = Object.fromEntries(
    posts.map(post => [
      post.id,
      {
        title: post.title,
        fingerprint: JSON.stringify({
          title: post.title,
          content: post.content,
          labels: post.labels,
          image: post.image,
        }),
      },
    ]),
  );

  if (!state?.initialized) {
    await stateRef.set({
      initialized: true,
      posts: currentPosts,
      latestPostId: posts[0].id,
      latestPublishedAt: posts[0].publishedAt || new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log('Notification watcher initialized:', posts[0].id, 'trackedPosts:', posts.length);
    return;
  }

  const newPosts = posts.filter(post => !previousPosts[post.id]);
  const updatedPosts = posts.filter(post => {
    const previous = previousPosts[post.id];
    return Boolean(previous) && previous.fingerprint !== currentPosts[post.id].fingerprint;
  });

  const changedPosts = [...newPosts, ...updatedPosts].filter(
    (post, index, list) => list.findIndex(item => item.id === post.id) === index,
  );

  console.log('Notification state:', {
    initialized: Boolean(state?.initialized),
    previousPosts: Object.keys(previousPosts).length,
    newPosts: newPosts.length,
    updatedPosts: updatedPosts.length,
    changedPosts: changedPosts.length,
  });

  if (!changedPosts.length) {
    await stateRef.set({
      posts: currentPosts,
      latestPostId: posts[0].id,
      latestPublishedAt: posts[0].publishedAt || new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const usersSnapshot = await db
    .collection('users')
    .where('registrationCompleted', '==', true)
    .where('notificationsEnabled', '==', true)
    .get();

  console.log('Notification users found:', usersSnapshot.size);

  const eligibleUsers = usersSnapshot.docs
    .map(userDoc => ({ data: userDoc.data(), token: userDoc.data()?.expoPushToken }))
    .filter(user =>
      typeof user.token === 'string' &&
      user.token.startsWith('ExponentPushToken['),
    );

  console.log('Eligible users with Expo tokens:', eligibleUsers.length);

  for (const post of changedPosts) {
    const isUpdate = Boolean(previousPosts[post.id]);
    const local = isLocalOffer(post);
    const normalizedLabels = new Set(post.labels.map(normalizeText).filter(Boolean));

    const targetTokens = eligibleUsers
      .filter(user => {
        const data = user.data || {};
        const interestedCategories = Array.isArray(data.interestedCategories)
          ? data.interestedCategories.map(normalizeText).filter(Boolean)
          : [];

        const wantsOnlineOffers = interestedCategories.includes('online offer');
        const wantsOfflineOffers = interestedCategories.includes('offline offer');

        if (!local) {
          // ONLINE OFFER: category subscription only. No location check.
          return wantsOnlineOffers;
        }

        // OFFLINE OFFER: category subscription is required first.
        if (!wantsOfflineOffers) return false;

        // Current location has priority. Saved/manual location is used only
        // when the current location is unavailable.
        const location = getUserLocationMatch(post, user);

        // No current or saved location means no offline notification.
        if (location.source === 'NONE') return false;

        return location.matched;
      })
      .map(user => user.token);

    const messages = [...new Set(targetTokens)].map(token => ({
      to: token,
      title: isUpdate ? 'Offerhaikya Offer Updated' : 'New Offerhaikya Offer',
      body: post.title,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: {
        postId: post.id,
        postTitle: post.title,
        postUrl: post.url,
        postDate: post.date,
        publishedAt: post.publishedAt,
        postLabel: post.label,
        postLabels: post.labels,
        postImage: post.image,
        postExcerpt: post.excerpt,
        postContent: post.content,
        postRawContent: post.rawContent,
      },
    }));

    console.log('Prepared notification batch:', { postId: post.id, title: post.title, local, recipients: messages.length });
    if (messages.length) await sendExpoPushMessages(messages);

    console.log(
      messages.length ? (isUpdate ? 'Sent offer-update notifications:' : 'Sent new-offer notifications:') : 'No matching notification recipients:',
      post.id,
      'type:', local ? 'OFFLINE/LOCAL' : 'ONLINE',
      'users:', messages.length,
    );
  }

  await stateRef.set({
    initialized: true,
    posts: currentPosts,
    latestPostId: posts[0].id,
    latestPublishedAt: posts[0].publishedAt || new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
