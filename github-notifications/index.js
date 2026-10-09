const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const FEED_URL = 'https://www.offerhaikya.com/feeds/posts/default';
const STATE_PATH = 'notificationState/bloggerFeed';
const NEARBY_RADIUS_KM = 300;
const NOTIFICATION_LOGIC_VERSION = 3;
const WEBHOOK_POST_URL = String(process.env.WEBHOOK_POST_URL || '').trim();

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

// Blogger Location fields are separate from post body content. Read them directly
// so offline notifications use the same location source as the mobile app.
const extractBloggerLocation = (entry, content = '') => {
  const rawLocation = entry?.location || entry?.['gd$where'] || entry?.['georss$where'];
  const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
  const name =
    location?.name?.$t || location?.name || location?.['gd$name']?.$t ||
    location?.['gd$name'] || location?.valueString || location?.['valueString'] ||
    entry?.['gd$where']?.name?.$t || entry?.['gd$where']?.name ||
    entry?.['gd$where']?.valueString || '';
  const pointText = location?.['georss$point']?.$t || location?.['georss$point'] ||
    entry?.['georss$point']?.$t || entry?.['georss$point'] || '';
  const pointParts = String(pointText).trim().split(/[ ,]+/).filter(Boolean);
  const gmlPosition = location?.['gd$Point']?.['gml$Point']?.['gml$pos']?.$t || '';
  const gmlParts = String(gmlPosition).trim().split(/[ ,]+/).filter(Boolean);
  const latitude = Number(location?.lat ?? location?.latitude ?? gmlParts[0] ?? pointParts[0]);
  const longitude = Number(location?.lng ?? location?.longitude ?? gmlParts[1] ?? pointParts[1]);
  const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : extractMapCoordinates(content);
  return { name: String(name || '').trim(), coordinates };
};

const getPostExpiryTime = post => {
  const expiryTag = (post.labels || []).find(label => /^E\d+$/i.test(String(label).trim()));
  const published = Date.parse(post.publishedAt || post.date || '');
  if (!expiryTag || !Number.isFinite(published)) return null;
  const days = Number(String(expiryTag).trim().slice(1));
  if (!Number.isFinite(days) || days < 0) return null;
  return published + days * 24 * 60 * 60 * 1000;
};

const isExpiredOffer = post => {
  const expiryTime = getPostExpiryTime(post);
  return expiryTime !== null && expiryTime <= Date.now();
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

  const currentLatitude = current?.latitude ?? current?.lat ?? current?.coordinates?.latitude ?? current?.coordinates?.lat;
  const currentLongitude = current?.longitude ?? current?.lng ?? current?.coordinates?.longitude ?? current?.coordinates?.lng;
  const currentCoords = current && Number.isFinite(Number(currentLatitude)) && Number.isFinite(Number(currentLongitude))
    ? { latitude: Number(currentLatitude), longitude: Number(currentLongitude) }
    : null;

  const manualLatitude = manual?.latitude ?? manual?.lat;
  const manualLongitude = manual?.longitude ?? manual?.lng;
  const manualCoords = manual && Number.isFinite(Number(manualLatitude)) && Number.isFinite(Number(manualLongitude))
    ? { latitude: Number(manualLatitude), longitude: Number(manualLongitude) }
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
    post.locationName,
    post.title,
    ...(post.labels || []),
    post.content,
    post.rawContent,
  ].map(normalizeText).filter(Boolean).join(' ');

  const textMatch = locationTerms.some(term => term.length >= 3 && offerText.includes(term));

  const postLocation = post.locationCoordinates || extractMapCoordinates(post.rawContent);
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
    const bloggerLocation = extractBloggerLocation(entry, content);

    return {
      id: entry.id?.$t || String(index),
      title: entry.title?.$t || 'New Offerhaikya Offer',
      url: alternate?.href || 'https://www.offerhaikya.com',
      publishedAt: entry.published?.$t || entry.updated?.$t || '',
      updatedAt: entry.updated?.$t || entry.published?.$t || '',
      date: entry.published?.$t || entry.updated?.$t || '',
      label: labels[0] || 'Offers',
      labels,
      image: highResImage(firstImage(content) || entry.media$thumbnail?.url || ''),
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
      content: stripHtml(content),
      rawContent: content,
      locationName: bloggerLocation.name,
      locationCoordinates: bloggerLocation.coordinates || undefined,
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

    const payload = await response.json();
    const tickets = Array.isArray(payload?.data) ? payload.data : [];
    console.log('Expo push tickets:', JSON.stringify(tickets));
    const failed = tickets.filter(ticket => ticket?.status !== 'ok');
    if (failed.length > 0 || tickets.length !== batch.length) {
      throw new Error('Expo rejected ' + failed.length + ' push ticket(s); successful delivery is not confirmed.');
    }
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
          locationName: post.locationName,
          locationCoordinates: post.locationCoordinates,
        }),
        notificationSent: state?.notificationLogicVersion !== NOTIFICATION_LOGIC_VERSION || (
          Boolean(previousPosts[post.id]?.notificationSent) && previousPosts[post.id]?.fingerprint === JSON.stringify({
          title: post.title,
          content: post.content,
          labels: post.labels,
          image: post.image,
          locationName: post.locationName,
          locationCoordinates: post.locationCoordinates,
        })
        ),
      },
    ]),
  );

  if (!state?.initialized) {
    await stateRef.set({
      initialized: true,
      // Treat posts present on the first watcher run as historical. Do not
      // send a batch of old posts on the next cron run.
      posts: Object.fromEntries(Object.entries(currentPosts).map(([id, post]) => [id, { ...post, notificationSent: true }])),
      latestPostId: posts[0].id,
      latestPublishedAt: posts[0].publishedAt || new Date().toISOString(),
      notificationLogicVersion: NOTIFICATION_LOGIC_VERSION,
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log('Notification watcher initialized:', posts[0].id, 'trackedPosts:', posts.length);
    return;
  }

  const newPosts = posts.filter(post => !previousPosts[post.id]);
  const migratingNotificationLogic = state?.notificationLogicVersion !== NOTIFICATION_LOGIC_VERSION;
  const updatedPosts = migratingNotificationLogic ? [] : posts.filter(post => {
    const previous = previousPosts[post.id];
    return Boolean(previous) && previous.fingerprint !== currentPosts[post.id].fingerprint;
  });

  // If a post had no eligible recipients or Expo rejected its ticket, retry it
  // during the first 24 hours after publication. This allows recipient data or
  // transient delivery failures to recover without repeatedly pushing old posts.
  const retryRecentUnsentPosts = migratingNotificationLogic ? [] : posts.filter(post => {
    const previous = previousPosts[post.id];
    const lastChanged = Date.parse(post.updatedAt || post.publishedAt || post.date || '');
    return Boolean(previous) && !previous.notificationSent && Number.isFinite(lastChanged) &&
      Date.now() - lastChanged <= 24 * 60 * 60 * 1000 && !isExpiredOffer(post);
  });

  // Logic migrations must not re-send an already-seen post. New posts missing
  // from previousPosts are still handled by newPosts below.
  const retryLatestForLogicFix = [];

  const webhookPost = WEBHOOK_POST_URL
    ? posts.find(post => post.url === WEBHOOK_POST_URL)
    : null;

  const webhookPosts = webhookPost ? [webhookPost] : [];

  const changedPosts = [
    ...newPosts,
    ...updatedPosts,
    ...retryRecentUnsentPosts,
    ...retryLatestForLogicFix,
    ...webhookPosts,
  ].filter(
    (post, index, list) => !isExpiredOffer(post) && list.findIndex(item => item.id === post.id) === index,
  );

  console.log('Notification state:', {
    initialized: Boolean(state?.initialized),
    previousPosts: Object.keys(previousPosts).length,
    newPosts: newPosts.length,
    updatedPosts: updatedPosts.length,
    webhookPost: WEBHOOK_POST_URL || null,
    webhookMatched: Boolean(webhookPost),
    changedPosts: changedPosts.length,
  });

  if (!changedPosts.length) {
    await stateRef.set({
      posts: currentPosts,
      latestPostId: posts[0].id,
      latestPublishedAt: posts[0].publishedAt || new Date().toISOString(),
      notificationLogicVersion: NOTIFICATION_LOGIC_VERSION,
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
    .map(userDoc => ({ userId: userDoc.id, data: { ...userDoc.data(), uid: userDoc.id }, token: userDoc.data()?.expoPushToken }))
    .filter(user =>
      typeof user.token === 'string' &&
      user.token.startsWith('ExponentPushToken['),
    );

  console.log('Eligible users with Expo tokens:', eligibleUsers.length);

  for (const post of changedPosts) {
    const isUpdate = previousPosts[post.id]?.notificationSent === true;
    const local = isLocalOffer(post);
    const normalizedLabels = new Set(post.labels.map(normalizeText).filter(Boolean));
    const categoryLabels = [...normalizedLabels].filter(label =>
      !['online offer', 'online offers', 'offline offer', 'offline offers', 'local offer', 'local offers'].includes(label),
    );

    const targetUsers = eligibleUsers.filter(user => {
      const data = user.data || {};
      const interestedCategories = Array.isArray(data.interestedCategories)
        ? data.interestedCategories.map(normalizeText).filter(Boolean)
        : [];

      const wantsOnlineOffers = interestedCategories.some(category =>
        category === 'online offer' || category === 'online offers',
      );
      const wantsOfflineOffers = interestedCategories.some(category =>
        category === 'offline offer' || category === 'offline offers' ||
        category === 'local offer' || category === 'local offers',
      );
      const matchesSelectedCategory = interestedCategories.some(category =>
        category.length >= 3 && categoryLabels.some(label =>
          label === category || label.includes(category) || category.includes(label),
        ),
      );

      if (!local) {
        // Online offers are matched against the user's selected post categories.
        // Selecting the general Online Offer category opts into all online posts.
        return wantsOnlineOffers || matchesSelectedCategory;
      }

      // Offline/local offers require a category match before checking distance.
      if (!wantsOfflineOffers && !matchesSelectedCategory) return false;

      // Current location has priority. Saved/manual location is used only
      // when the current location is unavailable.
      const location = getUserLocationMatch(post, user);

      // No current or saved location means no offline notification.
      if (location.source === 'NONE') return false;

      return location.matched;
    });

    const targetTokens = targetUsers.map(user => user.token);
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
        updatedAt: post.updatedAt,
        postLabel: post.label,
        postLabels: post.labels,
        postImage: post.image,
        postExcerpt: post.excerpt,
        postContent: post.content,
        postRawContent: post.rawContent,
      },
    }));

    console.log('Prepared notification batch:', { postId: post.id, title: post.title, local, recipients: messages.length });
    if (messages.length) {
      await sendExpoPushMessages(messages);

      currentPosts[post.id].notificationSent = true;

      const notificationWrites = targetUsers.map(user => {
        const uid = user.data?.uid || user.userId || null;
        if (!uid) return null;

        return db.collection('notifications').doc(uid + '_' + post.id).set({
          uid,
          postId: post.id,
          postTitle: post.title,
          postUrl: post.url,
          postDate: post.date,
          publishedAt: post.publishedAt,
          updatedAt: post.updatedAt,
          locationName: post.locationName,
          locationCoordinates: post.locationCoordinates,
          postLabel: post.label,
          postLabels: post.labels,
          postImage: post.image,
          postExcerpt: post.excerpt,
          postContent: post.content,
          postRawContent: post.rawContent,
          notificationType: isUpdate ? 'offer-update' : 'new-offer',
          offerType: local ? 'offline' : 'online',
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }).filter(Boolean);

      await Promise.all(notificationWrites);
      console.log('Saved Firebase notification history:', notificationWrites.length);
    }

    console.log(
      messages.length ? (isUpdate ? 'Sent offer-update notifications:' : 'Sent new-offer notifications:') : 'No matching notification recipients:',
      post.id,
      'type:', local ? 'OFFLINE/LOCAL' : 'ONLINE',
      'users:', targetUsers.length,
    );
  }

  await stateRef.set({
    initialized: true,
    posts: currentPosts,
    latestPostId: posts[0].id,
    latestPublishedAt: posts[0].publishedAt || new Date().toISOString(),
    notificationLogicVersion: NOTIFICATION_LOGIC_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};

run().catch(error => {
  console.error(error);
  process.exit(1);
});
