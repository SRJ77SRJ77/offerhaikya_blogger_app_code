const {onSchedule} = require("firebase-functions/v2/scheduler");
const {setGlobalOptions} = require("firebase-functions/v2");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

initializeApp();
setGlobalOptions({maxInstances: 1});

const FEED_URL = "https://www.offerhaikya.com/feeds/posts/default";
const STATE_REF = getFirestore().doc("notificationState/bloggerFeed");

const parseFeed = (data) => {
  const entries = data?.feed?.entry || [];
  return entries.map((entry, index) => {
    const links = entry.link || [];
    const alternate = links.find((item) => item.rel === "alternate");
    const content = entry.content?.$t || entry.summary?.$t || "";
    const labels = (entry.category || [])
      .map((item) => item.term)
      .filter(Boolean);

    return {
      id: entry.id?.$t || String(index),
      title: entry.title?.$t || "New OfferHaikya offer",
      url: alternate?.href || "https://www.offerhaikya.com",
      publishedAt: entry.published?.$t || entry.updated?.$t || "",
      date: entry.published?.$t || entry.updated?.$t || "",
      label: labels[0] || "Offers",
      labels,
      image: firstImage(content) || entry.media$thumbnail?.url || "",
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
      content: stripHtml(content),
      rawContent: content,
    };
  });
};

const firstImage = (html = "") => {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || "";
};

const stripHtml = (value = "") =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const highResImage = (url = "") =>
  url
    .replace(/\/s\d+(-c)?\//i, "/s800/")
    .replace(/=w\d+(-h\d+)?(-p)?/i, "=s800")
    .replace(/\/w\d+(-h\d+)?\//i, "/s800/");

const sendExpoPushMessages = async (messages) => {
  for (let start = 0; start < messages.length; start += 100) {
    const batch = messages.slice(start, start + 100);

    const response = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      },
    );

    if (!response.ok) {
      throw new Error("Expo Push Service returned HTTP " + response.status);
    }

    const result = await response.json();
    console.log("Expo push batch result:", JSON.stringify(result));
  }
};

exports.sendNewOfferNotifications = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Kolkata",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async () => {
    const response = await fetch(
      FEED_URL + "?alt=json&max-results=20&ohk_notification_check=" + Date.now(),
      {
        headers: {
          "Cache-Control": "no-cache, no-store, max-age=0",
          "Pragma": "no-cache",
        },
      },
    );

    if (!response.ok) {
      throw new Error("Unable to read OfferHaikya Blogger feed");
    }

    const posts = parseFeed(await response.json()).map((post) => ({
      ...post,
      image: highResImage(post.image),
    }));

    if (!posts.length) return;

    const stateSnapshot = await STATE_REF.get();
    const state = stateSnapshot.exists ? stateSnapshot.data() : null;
    const newest = posts[0];

    if (!state?.initialized) {
      await STATE_REF.set({
        initialized: true,
        latestPostId: newest.id,
        latestPublishedAt: newest.publishedAt || new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log("Notification watcher initialized at:", newest.id);
      return;
    }

    const lastPublishedAt = String(state.latestPublishedAt || "");
    const lastPostId = String(state.latestPostId || "");

    const newPosts = posts
      .filter((post) => {
        if (post.id === lastPostId) return false;
        if (!lastPublishedAt) return true;
        const publishedTime = Date.parse(post.publishedAt || "");
        const lastTime = Date.parse(lastPublishedAt);
        return Number.isFinite(publishedTime) &&
          Number.isFinite(lastTime) &&
          publishedTime > lastTime;
      })
      .sort((a, b) => {
        const aTime = Date.parse(a.publishedAt || "") || 0;
        const bTime = Date.parse(b.publishedAt || "") || 0;
        return aTime - bTime;
      });

    if (!newPosts.length) return;

    const usersSnapshot = await getFirestore()
      .collection("users")
      .where("registrationCompleted", "==", true)
      .where("notificationsEnabled", "==", true)
      .get();

    const tokens = Array.from(new Set(
      usersSnapshot.docs
        .map((doc) => doc.data()?.expoPushToken)
        .filter((token) => typeof token === "string" && token.startsWith("ExponentPushToken[")),
    ));

    for (const post of newPosts) {
      const messages = tokens.map((token) => ({
        to: token,
        title: "New OfferHaikya Offer",
        body: post.title,
        sound: "default",
        priority: "high",
        channelId: "default",
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

      if (messages.length) {
        await sendExpoPushMessages(messages);
      }

      console.log("Sent new-offer notifications:", post.id, "users:", tokens.length);
    }

    await STATE_REF.set({
      initialized: true,
      latestPostId: newest.id,
      latestPublishedAt: newest.publishedAt || new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  },
);
