import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Animated,
  Easing,
  FlatList,
  Image,
  ImageBackground,
  Linking,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ToastAndroid,
  Share,
  Alert,
  BackHandler,
} from 'react-native';
import RenderHTML from 'react-native-render-html';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import Svg, { Path } from 'react-native-svg';
import { useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  reauthenticateWithCredential,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signOut,
  signInWithEmailAndPassword,
  updateEmail,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import { auth, db } from './firebaseConfig';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query as firestoreQuery, serverTimestamp, setDoc, Timestamp, where, writeBatch } from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import mobileAds, {
  BannerAd,
  BannerAdSize,
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaAspectRatio,
  NativeMediaView,
  TestIds,
} from 'react-native-google-mobile-ads';

const BLOG_URL = 'https://www.offerhaikya.com';
const FEED_URL = BLOG_URL + '/feeds/posts/default';
const ACCENT = '#ff5b01';
const HERO = '#6c6cfe';
const PAGE = '#f3f4f6';
const WHITE = '#ffffff';
const TEXT = '#202124';
const MUTED = '#77747a';
const PAGE_SIZE = 20;
const NEARBY_RADIUS_KM = 300;
const MAIN_AUTO_SYNC_INTERVAL_MS = 60 * 1000;
const METADATA_AUTO_SYNC_INTERVAL_MS = 60 * 1000;
const INFO_PAGE_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FEED_CACHE_TTL_MS = 60 * 1000;
const NEARBY_CACHE_TTL_MS = 5 * 60 * 1000;
const NEARBY_NEW_POST_CHECK_INTERVAL_MS = 30 * 1000;
const LOCATION_RETRY_MS = 5 * 60 * 1000;
const LOCATION_CHECK_INTERVAL_MS = 15 * 1000;
const SKIP_REMINDER_MS = 7 * 60 * 1000;
const SKIP_STORAGE_KEY = 'offerhaikya_registration_skipped_at';
const FAVORITES_STORAGE_PREFIX = 'offerhaikya_favorites_';
const PROFILE_CACHE_PREFIX = 'offerhaikya_profile_';
const HAS_REGISTERED_ACCOUNT_KEY = 'offerhaikya_has_registered_account';
const DIRECT_TAGS = ['All', 'News', 'Amazon', 'Flipkart', 'Myntra', 'Meesho', 'Instamart', 'Blinkit', 'Zepto', 'BigBasket Now', 'Snapdeal', 'Shopsy', 'Offline Offers', 'Online Offers', 'Stores', 'Belagavi Store', 'Goa Store'];
const ALL_POSTS_TAG = '__all_posts__';
const CATEGORY_ITEMS = ['Fashion', 'Electronics', 'Home & Kitchen', 'Beauty & Personal Care', 'Grocery & Food', 'Baby & Kids', 'Sports & Fitness', 'Automotive', 'Pet Supplies', 'Books & Education', 'Gaming', 'Travel & Luggage', 'Jewellery & Accessories', 'Tools & Industrial', 'Stores', 'Belagavi Store', 'Goa Store'];
const SPECIAL_DEAL_ITEMS = ['₹1 Deals', 'Loot Deals', 'Flash Sales', "Today's Deals", 'Clearance Sale', 'Buy 1 Get 1', 'Under ₹99', 'Under ₹499', '50%+ Off', 'Coupon Codes', 'Bank Offers', 'Freebies'];
const ADD_OFFERS_WHATSAPP_URL = '';
const NOTIFICATIONS_STORAGE_PREFIX = 'offerhaikya_notifications_';
const NOTIFICATION_DISMISSED_STORAGE_PREFIX = 'offerhaikya_notification_dismissed_';
const GUEST_NOTIFICATION_DISMISSED_STORAGE_KEY = 'offerhaikya_guest_notification_dismissed';
const SAVED_LOCATION_STORAGE_KEY = 'offerhaikya_saved_location';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type Post = {
  id: string;
  title: string;
  url: string;
  date: string;
  publishedAt: string;
  label: string;
  labels: string[];
  image?: string;
  excerpt: string;
  content: string;
  rawContent: string;
  locationName?: string;
  locationCoordinates?: { latitude: number; longitude: number };
  nearbyDistanceKm?: number;
  updatedAt?: string;
  notificationTimestamp?: number;
  notificationType?: 'new' | 'updated' | 'relevant';
};

// Data-access boundary: keep Blogger transport/cache logic separate from UI code,
// so the feed provider can be replaced without rewriting screens.
const FEED_CACHE_MAX_ENTRIES = 6;
const FEED_TOTAL_CACHE_MAX_ENTRIES = 20;
const feedCache = new Map<string, { posts: Post[]; savedAt: number }>();
const feedTotalCountCache = new Map<string, number>();
const feedRequestsInFlight = new Map<string, Promise<Post[]>>();
// Coalesce concurrent full-feed scans without retaining thousands of full post
// objects in memory; the visible Nearby/Latest and page caches remain bounded.
let allPostsScanInFlight: Promise<Post[]> | null = null;
// Per-account in-memory profile cache; persistent cache remains keyed by UID.
const profileMemoryCache = new Map<string, Record<string, any>>();

const stripHtml = (value = '') =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const highResImage = (url = '') => {
  if (!url) return '';
  return url
    .replace(/\/s\d+(-c)?\//i, '/s800/')
    .replace(/=w\d+(-h\d+)?(-p)?/i, '=s800')
    .replace(/\/w\d+(-h\d+)?\//i, '/s800/');
};

const firstImage = (html = '') => {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1];
};

const extractMapCoordinates = (html = ''): { latitude: number; longitude: number } | null => {
  const coordinateMatch = html.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (coordinateMatch) {
    return { latitude: Number(coordinateMatch[1]), longitude: Number(coordinateMatch[2]) };
  }
  const queryMatch = html.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i);
  if (queryMatch) {
    return { latitude: Number(queryMatch[1]), longitude: Number(queryMatch[2]) };
  }
  return null;
};

const extractBloggerLocation = (entry: any, content = '') => {
  const rawLocation = entry?.location || entry?.['gd$where'] || entry?.['georss$where'];
  const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;

  const name =
    location?.name?.$t ||
    location?.name ||
    location?.['gd$name']?.$t ||
    location?.['gd$name'] ||
    location?.valueString ||
    location?.['valueString'] ||
    entry?.['gd$where']?.name?.$t ||
    entry?.['gd$where']?.name ||
    entry?.['gd$where']?.valueString ||
    '';

  const pointText =
    location?.['georss$point']?.$t ||
    location?.['georss$point'] ||
    entry?.['georss$point']?.$t ||
    entry?.['georss$point'] ||
    '';

  const pointParts = String(pointText).trim().split(/[ ,]+/).filter(Boolean);
  const gmlPosition = location?.['gd$Point']?.['gml$Point']?.['gml$pos']?.$t || '';
  const gmlParts = String(gmlPosition).trim().split(/[ ,]+/).filter(Boolean);
  const pointLatitude = Number(pointParts[0]);
  const pointLongitude = Number(pointParts[1]);

  const latitude = Number(
    location?.lat ?? location?.latitude ?? gmlParts[0] ?? pointLatitude ?? NaN,
  );
  const longitude = Number(
    location?.lng ?? location?.longitude ?? gmlParts[1] ?? pointLongitude ?? NaN,
  );

  const coordinateLocation =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : extractMapCoordinates(content);

  return {
    name: String(name || '').trim(),
    coordinates: coordinateLocation,
  };
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const distanceKm = (
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
) => {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRadians(second.latitude - first.latitude);
  const dLon = toRadians(second.longitude - first.longitude);
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
};

const parseFeed = (data: any): Post[] => {
  const entries = data?.feed?.entry || [];
  return entries.map((entry: any, index: number) => {
    const links = entry.link || [];
    const alternate = links.find((item: any) => item.rel === 'alternate');
    const content = entry.content?.$t || entry.summary?.$t || '';
    const labels = (entry.category || []).map((item: any) => item.term).filter(Boolean);

    return {
      id: entry.id?.$t || String(index),
      title: entry.title?.$t || 'Untitled post',
      url: alternate?.href || BLOG_URL,
      date: formatDate(entry.published?.$t || entry.updated?.$t || ''),
      publishedAt: entry.published?.$t || entry.updated?.$t || '',
      updatedAt: entry.updated?.$t || entry.published?.$t || '',
      label: labels[0] || 'Offers',
      labels,
      image: highResImage(firstImage(content) || entry.media$thumbnail?.url),
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
      content: stripHtml(content),
      rawContent: content,
      locationName: extractBloggerLocation(entry, content).name,
      locationCoordinates: extractBloggerLocation(entry, content).coordinates || undefined,
    };
  });
};

const getFeedCacheKey = (query = '', startIndex = 1) =>
  query.trim().toLowerCase() + '::' + startIndex;

const fetchFeedFromNetworkImpl = async (query = '', startIndex = 1, forceRefresh = false) => {
  const params = new URLSearchParams({
    alt: 'json',
    'max-results': String(PAGE_SIZE),
    'start-index': String(startIndex),
  });

  if (query.trim().length >= 1) {
    params.set('q', query.trim());
  }

  if (forceRefresh) {
    params.set('ohk_refresh', String(Date.now()));
  }

  const response = await fetch(
    FEED_URL + '?' + params.toString(),
    forceRefresh
      ? {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, max-age=0',
            'Pragma': 'no-cache',
          },
        }
      : undefined,
  );
  if (!response.ok) throw new Error('Unable to load posts');

  const data = await response.json();
  const posts = parseFeed(data);
  const cacheKey = getFeedCacheKey(query, startIndex);
  feedCache.delete(cacheKey);
  feedCache.set(cacheKey, { posts, savedAt: Date.now() });
  while (feedCache.size > FEED_CACHE_MAX_ENTRIES) {
    const oldestKey = feedCache.keys().next().value;
    if (oldestKey === undefined) break;
    feedCache.delete(oldestKey);
  }

  const totalResults = Number(data?.feed?.['openSearch$totalResults']?.$t);
  if (Number.isFinite(totalResults)) {
    const totalKey = query.trim().toLowerCase();
    feedTotalCountCache.delete(totalKey);
    feedTotalCountCache.set(totalKey, totalResults);
    while (feedTotalCountCache.size > FEED_TOTAL_CACHE_MAX_ENTRIES) {
      const oldestKey = feedTotalCountCache.keys().next().value;
      if (oldestKey === undefined) break;
      feedTotalCountCache.delete(oldestKey);
    }
  }

  return posts;
};

// Identical requests share one network operation; force-refresh requests are
// deduplicated separately from normal cacheable requests.
const fetchFeedFromNetwork = (query = '', startIndex = 1, forceRefresh = false): Promise<Post[]> => {
  const requestKey = getFeedCacheKey(query, startIndex) + (forceRefresh ? "::refresh" : "::normal");
  const existing = feedRequestsInFlight.get(requestKey);
  if (existing) return existing;

  const request = fetchFeedFromNetworkImpl(query, startIndex, forceRefresh).finally(() => {
    if (feedRequestsInFlight.get(requestKey) === request) {
      feedRequestsInFlight.delete(requestKey);
    }
  });
  feedRequestsInFlight.set(requestKey, request);
  return request;
};

const getCachedFeed = (query = '', startIndex = 1) => {
  const cacheKey = getFeedCacheKey(query, startIndex);
  const cached = feedCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.savedAt > FEED_CACHE_TTL_MS) {
    feedCache.delete(cacheKey);
    return null;
  }

  return cached.posts;
};

const getFeed = async (query = '', startIndex = 1) => {
  const cached = getCachedFeed(query, startIndex);
  if (cached) return cached;
  return fetchFeedFromNetwork(query, startIndex);
};

const prefetchFeed = async (query = '', startIndex = 1) => {
  if (getCachedFeed(query, startIndex)) return;

  try {
    await fetchFeedFromNetwork(query, startIndex);
  } catch {
    // Prefetch is best-effort and must never block the UI.
  }
};

const fetchAllPostsForNearbyImpl = async (): Promise<Post[]> => {
  const all: Post[] = [];
  const batchSize = 500;
  let startIndex = 1;

  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const response = await fetch(
      FEED_URL + '?alt=json&max-results=' + batchSize + '&start-index=' + startIndex,
    );
    if (!response.ok) throw new Error('Unable to load nearby offers');

    const batch = parseFeed(await response.json());
    all.push(...batch);

    if (batch.length < batchSize) break;
    startIndex += batchSize;
  }

  return all;
};

const getAllPostsForNearby = (): Promise<Post[]> => {
  if (allPostsScanInFlight) return allPostsScanInFlight;

  const request = fetchAllPostsForNearbyImpl().finally(() => {
    if (allPostsScanInFlight === request) allPostsScanInFlight = null;
  });
  allPostsScanInFlight = request;
  return request;
};

const NativeAdCard = () => {
  const [nativeAd, setNativeAd] = useState<NativeAd>();

  useEffect(() => {
    NativeAd.createForAdRequest(TestIds.GAM_NATIVE, {
      aspectRatio: NativeMediaAspectRatio.LANDSCAPE,
    })
      .then(setNativeAd)
      .catch(error => {
        console.log('Native ad load error:');
      });
  }, []);

  useEffect(() => {
    if (!nativeAd) return;

    return () => {
      nativeAd.destroy();
    };
  }, [nativeAd]);

  if (!nativeAd) {
    return null;
  }

  return (
    <NativeAdView nativeAd={nativeAd} style={styles.nativeAdContainer}>
      <View style={styles.nativeAdInner}>
        <View style={styles.nativeAdHeader}>
          {nativeAd.icon ? (
            <NativeAsset assetType={NativeAssetType.ICON}>
              <Image source={{ uri: nativeAd.icon.url }} style={styles.nativeAdIcon} />
            </NativeAsset>
          ) : null}
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={styles.nativeAdHeadline} numberOfLines={2}>{nativeAd.headline}</Text>
          </NativeAsset>
          <Text style={styles.nativeAdLabel}>AD</Text>
        </View>

        {nativeAd.advertiser ? (
          <NativeAsset assetType={NativeAssetType.ADVERTISER}>
            <Text style={styles.nativeAdAdvertiser} numberOfLines={1}>{nativeAd.advertiser}</Text>
          </NativeAsset>
        ) : null}

        {nativeAd.body ? (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text style={styles.nativeAdBody} numberOfLines={2}>{nativeAd.body}</Text>
          </NativeAsset>
        ) : null}

        <NativeMediaView style={styles.nativeAdMedia} />

        {nativeAd.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <Text style={styles.nativeAdCta}>{nativeAd.callToAction}</Text>
          </NativeAsset>
        ) : null}
      </View>
    </NativeAdView>
  );
};

const TestBannerAd = () => (
  <View style={styles.bannerAdWrap}>
    <BannerAd
      unitId={TestIds.ADAPTIVE_BANNER}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
    />
  </View>
);

export default function App() {
  const { width } = useWindowDimensions();

  useEffect(() => {
    mobileAds()
      .initialize()
      .catch(error => {
        console.log('Google Mobile Ads initialization error:');
      });
  }, []);
  const [posts, setPosts] = useState<Post[]>([]);
  const [hotOffersPosts, setHotOffersPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState('');
  const [nearbySort, setNearbySort] = useState<'distance' | 'oldest' | 'newest'>('newest');
  const [nearbySortOpen, setNearbySortOpen] = useState(false);
  const [latestSort, setLatestSort] = useState<'nearExpiry' | 'oldest' | 'newest' | 'expired'>('newest');
  const [latestSortOpen, setLatestSortOpen] = useState(false);
  const [activeLabel, setActiveLabel] = useState('All');
  const [tagPage, setTagPage] = useState<string | null>(null);
  const [tagPagePosts, setTagPagePosts] = useState<Post[]>([]);
  const [tagPageLoading, setTagPageLoading] = useState(false);
  const [tagPageLoadingMore, setTagPageLoadingMore] = useState(false);
  const tagPageAllPostsRef = useRef<Post[]>([]);
  const tagPageStartPageRef = useRef(1);
  const tagPagePageRef = useRef(1);
  const [tagPageHasMore, setTagPageHasMore] = useState(false);
  const [tagPageDropdownOpen, setTagPageDropdownOpen] = useState(false);
  const [page, setPage] = useState(1);
  const paginationPageRef = useRef(1);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [detail, setDetail] = useState<Post | null>(null);
  const [favorites, setFavorites] = useState<Post[]>([]);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Post[]>([]);
  const dismissedNotificationIdsRef = useRef<Set<string>>(new Set());
  const guestDismissedNotificationRef = useRef<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCategoriesOpen, setMenuCategoriesOpen] = useState(false);
  const [menuStoresOpen, setMenuStoresOpen] = useState(false);
  const [menuSpecialDealsOpen, setMenuSpecialDealsOpen] = useState(false);
  const [infoPage, setInfoPage] = useState<'about' | 'contact' | 'privacy' | 'terms' | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [suggestions, setSuggestions] = useState<Post[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [error, setError] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [startupPreloader, setStartupPreloader] = useState(true);
  const [startupPreloaderStage, setStartupPreloaderStage] = useState<'local' | 'online'>('local');
  const startupPreloaderProgress = useRef(new Animated.Value(0)).current;
  const [registrationName, setRegistrationName] = useState('');
  const [registrationContact, setRegistrationContact] = useState('');
  const [registrationEmail, setRegistrationEmail] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [registrationPasswordVisible, setRegistrationPasswordVisible] = useState(false);
  const [registrationAreaCity, setRegistrationAreaCity] = useState('');
  const [registrationCategories, setRegistrationCategories] = useState<string[]>([]);
  const [registrationCategoriesOpen, setRegistrationCategoriesOpen] = useState(false);
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const signInSubmittingRef = useRef(false);
  const registrationPasswordRef = useRef('');
  const [registrationError, setRegistrationError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState('');
  const [registrationCompleted, setRegistrationCompleted] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [accountStateLoaded, setAccountStateLoaded] = useState(false);
  const [startupGateOpen, setStartupGateOpen] = useState(false);
  const [notificationStageDone, setNotificationStageDone] = useState(false);
  const [authUserKey, setAuthUserKey] = useState('');
  const [profileStatus, setProfileStatus] = useState<'new' | 'skipped' | 'registered'>('new');
  const [authMode, setAuthMode] = useState<'register' | 'signIn'>('register');
  // true only when Firebase confirms registrationCompleted; skipped users use the Welcome form.
  const [profileMode, setProfileMode] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const skipReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registrationFlowActiveRef = useRef(false);
  const authBootstrappedRef = useRef(false);
  const pendingDeleteAfterLoginRef = useRef(false);
  const accountDeletionResetRef = useRef(false);
  const registrationNameRef = useRef('');
  const registrationContactRef = useRef('');
  const registrationEmailRef = useRef('');
  const registrationAreaCityRef = useRef('');
  const registrationCategoriesRef = useRef<string[]>([]);
  const [bloggerInfoData, setBloggerInfoData] = useState<{ title: string; html: string } | null>(null);
  const [infoPagePosts, setInfoPagePosts] = useState<Post[]>([]);
  const [infoPagePostsLoading, setInfoPagePostsLoading] = useState(false);
  const [detailPagePosts, setDetailPagePosts] = useState<Post[]>([]);
  const [detailPagePostsLoading, setDetailPagePostsLoading] = useState(false);
  const [bloggerCategories, setBloggerCategories] = useState<string[]>([]);
  const [bloggerTags, setBloggerTags] = useState<string[]>([]);
  const [bloggerMenuCategories, setBloggerMenuCategories] = useState<string[]>([]);
  const [bloggerMenuSpecialDeals, setBloggerMenuSpecialDeals] = useState<string[]>([]);
  const [bloggerDarkLogoUri, setBloggerDarkLogoUri] = useState('');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [nearbyPosts, setNearbyPosts] = useState<Post[]>([]);
  const [nearbyVisibleCount, setNearbyVisibleCount] = useState(PAGE_SIZE);
  const [latestTotalCount, setLatestTotalCount] = useState(0);
  const nearbyVisibleCountRef = useRef(PAGE_SIZE);
  const nearbyLastUpdatedCheckRef = useRef(Date.now() - 60 * 1000);
  const nearbyPollInFlightRef = useRef(false);
  const locationCheckInFlightRef = useRef(false);
  const mainFeedRefreshInFlightRef = useRef(false);
  const [nearbyPreloaderOpen, setNearbyPreloaderOpen] = useState(false);
  const [nearbyPreloaderProgress, setNearbyPreloaderProgress] = useState(0);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);
  const [locationServicesEnabled, setLocationServicesEnabled] = useState(true);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const locationAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationAutoStartedRef = useRef(false);
  const locationPromptSnoozeUntilRef = useRef(0);
  const locationPermissionRequestActiveRef = useRef(false);
  const localOffersPermissionPendingRef = useRef(false);
  const returnHomeAfterLocationSettingsRef = useRef(false);
  const returnHomeToNearbyAfterLocationRef = useRef(false);
  const locationReadyRef = useRef<boolean | null>(null);
  const [offerRequestOpen, setOfferRequestOpen] = useState(false);
  const [offerRequestName, setOfferRequestName] = useState('');
  const [offerRequestContact, setOfferRequestContact] = useState('');
  const [offerRequestText, setOfferRequestText] = useState('');
  const [offerRequestSubmitting, setOfferRequestSubmitting] = useState(false);
  const [offerRequestSuccess, setOfferRequestSuccess] = useState(false);
  const [offerRequestError, setOfferRequestError] = useState('');
  const [bottomTab, setBottomTab] = useState<'home' | 'local' | 'hot' | 'search' | 'request' | null>(null);
  const [sharePostUrl, setSharePostUrl] = useState<string | null>(null);
  const [expiryNow, setExpiryNow] = useState(() => Date.now());
  const [localOfferEmptyOpen, setLocalOfferEmptyOpen] = useState(false);
  const [localOffersDisabled, setLocalOffersDisabled] = useState(false);
  const [localOfferEmptyCountdown, setLocalOfferEmptyCountdown] = useState(5);
  const mainListRef = useRef<FlatList<Post[]>>(null);
  const nearbyCacheRef = useRef<{ key: string; savedAt: number; posts: Post[] } | null>(null);
  const nearbySectionOffsetRef = useRef(0);
  const nearbyPreloaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyPreloaderFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyPreloaderOpenRef = useRef(false);
  const nearbyPreloaderTimedOutRef = useRef(false);
  const nearbyPreloaderSpin = useRef(new Animated.Value(0)).current;
  const [locationTerms, setLocationTerms] = useState<string[]>([]);
  const searchInputRef = useRef<TextInput>(null);
  const menuAnim = useRef(new Animated.Value(-320)).current;
  const bottomTabResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomTabRef = useRef<typeof bottomTab>(bottomTab);
  bottomTabRef.current = bottomTab;

  const startNearbyPreloader = useCallback(() => {
    if (nearbyPreloaderTimerRef.current) clearTimeout(nearbyPreloaderTimerRef.current);
    if (nearbyPreloaderFinishTimerRef.current) clearTimeout(nearbyPreloaderFinishTimerRef.current);

    nearbyPreloaderOpenRef.current = true;
    nearbyPreloaderTimedOutRef.current = false;
    setNearbyPreloaderProgress(0);
    setNearbyPreloaderOpen(true);

    nearbyPreloaderTimerRef.current = setTimeout(() => {
      nearbyPreloaderTimedOutRef.current = true;
      nearbyPreloaderOpenRef.current = false;
      setNearbyPreloaderOpen(false);
      setNearbyPreloaderProgress(0);
      nearbyPreloaderTimerRef.current = null;
    }, 5000);
  }, []);

  const finishNearbyPreloader = useCallback(() => {
    if (
      !nearbyPreloaderOpenRef.current ||
      nearbyPreloaderTimedOutRef.current
    ) {
      return;
    }

    if (nearbyPreloaderTimerRef.current) {
      clearTimeout(nearbyPreloaderTimerRef.current);
      nearbyPreloaderTimerRef.current = null;
    }

    setNearbyPreloaderProgress(100);

    if (nearbyPreloaderFinishTimerRef.current) {
      clearTimeout(nearbyPreloaderFinishTimerRef.current);
    }

    nearbyPreloaderFinishTimerRef.current = setTimeout(() => {
      nearbyPreloaderOpenRef.current = false;
      setNearbyPreloaderOpen(false);
      setNearbyPreloaderProgress(0);
      nearbyPreloaderFinishTimerRef.current = null;
    }, 350);
  }, []);

  const ensureAnonymousUser = async () => {
    if (auth.currentUser) return auth.currentUser;
    const credential = await signInAnonymously(auth);
    return credential.user;
  };

  const checkRegistrationReminder = async () => {
    if (registrationCompleted || profileMode) return;

    try {
      const hasRegisteredAccount = (await AsyncStorage.getItem(HAS_REGISTERED_ACCOUNT_KEY)) === 'true';
      if (hasRegisteredAccount) return;
      const skippedAt = Number(
        (await AsyncStorage.getItem(SKIP_STORAGE_KEY)) || '0'
      );

      if (!skippedAt) {
        setRegistrationOpen(true);
        return;
      }

      const remaining = SKIP_REMINDER_MS - (Date.now() - skippedAt);

      if (remaining <= 0) {
        await AsyncStorage.removeItem(SKIP_STORAGE_KEY);
        setRegistrationOpen(true);
        setProfileMode(false);
        setAuthMode('register');
        return;
      }

      if (skipReminderTimerRef.current) {
        clearTimeout(skipReminderTimerRef.current);
      }

      skipReminderTimerRef.current = setTimeout(() => {
        void checkRegistrationReminder();
      }, remaining);
    } catch (error) {
      console.log('Registration reminder error:');
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadAccountState = async (user: any) => {
      if (!user || user.isAnonymous) {
        if (cancelled) return;
        setRegistrationCompleted(false);
        setProfileStatus('skipped');
        setProfileMode(false);
        setAuthMode('register');
        await checkRegistrationReminder();
        return;
      }

      try {
        const snapshot = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;

        const data = snapshot.exists() ? snapshot.data() : null;
        const registered = data?.registrationCompleted === true || !!user.email;

        setRegistrationCompleted(registered);
        setProfileStatus(registered ? 'registered' : 'new');

        if (registered) {
          await AsyncStorage.setItem(HAS_REGISTERED_ACCOUNT_KEY, 'true');
        }

        if (registered) {
          setRegistrationCompleted(true);
          setProfileStatus('registered');
          if (!registrationFlowActiveRef.current) {
            setRegistrationOpen(false);
            setProfileMode(false);
            setAuthMode('register');
          }
        } else {
          await checkRegistrationReminder();
        }
      } catch (error) {
        console.log('Account state load error:');

        // A non-anonymous Firebase user is an authenticated account.
        // Never send that user back to the first registration popup just
        // because Firestore is temporarily unavailable.
        if (!cancelled && user && !user.isAnonymous) {
          setRegistrationCompleted(true);
          setProfileStatus('registered');
          if (!registrationFlowActiveRef.current) {
            setRegistrationOpen(false);
            setProfileMode(false);
            setAuthMode('register');
          }
        }
      }
    };

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (!authBootstrappedRef.current) return;
      if (cancelled) return;
      setAuthUserKey(user?.uid || '');
      void loadAccountState(user);
      void loadFavoritesForUser(user);
    });

    const bootstrapAuth = async () => {
      try {
        await auth.authStateReady();
        if (cancelled) return;

        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }

        if (cancelled) return;

        authBootstrappedRef.current = true;
        setAuthReady(true);
        await loadAccountState(auth.currentUser);
        if (!cancelled) setAccountStateLoaded(true);
        await loadFavoritesForUser(auth.currentUser);
      } catch (error) {
        console.log('Auth bootstrap error:');

        if (!cancelled) {
          setAccountStateLoaded(true);
          authBootstrappedRef.current = true;
          setAuthReady(true);
          setRegistrationCompleted(false);
          setProfileStatus('skipped');
          setRegistrationOpen(true);
          setProfileMode(false);
          setAuthMode('register');
        }
      }
    };

    void bootstrapAuth();

    return () => {
      cancelled = true;
      unsubscribe();
      if (skipReminderTimerRef.current) {
        clearTimeout(skipReminderTimerRef.current);
        skipReminderTimerRef.current = null;
      }
    };
  }, []);


  useEffect(() => {
    if (!nearbyPreloaderOpen) return;

    nearbyPreloaderSpin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(nearbyPreloaderSpin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [nearbyPreloaderOpen, nearbyPreloaderSpin]);

  useEffect(() => {
    return () => {
      if (nearbyPreloaderTimerRef.current) clearTimeout(nearbyPreloaderTimerRef.current);
      if (nearbyPreloaderFinishTimerRef.current) clearTimeout(nearbyPreloaderFinishTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setExpiryNow(Date.now());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (bottomTabResetTimerRef.current) {
        clearTimeout(bottomTabResetTimerRef.current);
        bottomTabResetTimerRef.current = null;
      }
    };
  }, []);

  const loadPosts = useCallback(async (search = '', pageNumber = 1, silent = false) => {
    try {
      setError('');
      if (!silent) {
        if (!search) setLoading(true);
        else setSearching(true);
      }
      const startIndex = (pageNumber - 1) * PAGE_SIZE + 1;
      const cached = getCachedFeed(search, startIndex);

      if (cached) {
        setPosts(cached);
        setLatestTotalCount(feedTotalCountCache.get(search.trim().toLowerCase()) ?? cached.length);
        setPage(pageNumber);
        paginationPageRef.current = pageNumber;
        const cachedTotal = feedTotalCountCache.get(search.trim().toLowerCase());
        setHasMorePosts(search.trim() ? false : cachedTotal != null ? startIndex + cached.length - 1 < cachedTotal : cached.length === PAGE_SIZE);

        // A cached search result is only a fast first paint. Continue below to
        // refresh and rank against the full feed instead of returning early.
        if (!search.trim()) {
          setLoading(false);
          setSearching(false);
          void fetchFeedFromNetwork(search, startIndex).catch(() => {});
          if (cached.length === PAGE_SIZE) void prefetchFeed(search, pageNumber + 1);
          return;
        }
      }

      let result = await fetchFeedFromNetwork(search, startIndex);

      // For search, Blogger's q endpoint can rank description matches ahead of
      // title matches or miss a title entirely. Use the same title-first local
      // ranking as the live dropdown when the direct result is weak.
      if (search.trim()) {
        const normalized = search.toLowerCase().replace(/\s+/g, ' ').trim();
        const score = (post: Post) => {
          const title = post.title.toLowerCase();
          const label = post.label.toLowerCase();
          const labels = post.labels.join(' ').toLowerCase();
          const content = post.content.toLowerCase();
          const location = String(post.locationName || '').toLowerCase();
          let value = 0;
          if (title === normalized) value += 3000;
          if (title.startsWith(normalized)) value += 1800;
          if (title.includes(normalized)) value += 1200;
          if (label.includes(normalized)) value += 500;
          if (labels.includes(normalized)) value += 350;
          if (location.includes(normalized)) value += 250;
          if (content.includes(normalized)) value += 120;
          return value;
        };

        // Blogger's q endpoint can return only a small subset of matches.
        // Search the complete locally fetched feed so titles, labels/tags,
        // descriptions, and locations are all included, with title matches first.
        try {
          const allSearchPosts = await getAllPostsForNearby();
          const combinedById = new Map<string, Post>();
          [...allSearchPosts, ...result].forEach(post => combinedById.set(post.id, post));
          result = Array.from(combinedById.values())
            .filter(post => score(post) > 0)
            .sort((a, b) => score(b) - score(a));
        } catch {
          // If the full feed cannot be loaded, retain all direct Blogger results.
          result = result
            .filter(post => score(post) > 0)
            .sort((a, b) => score(b) - score(a));
        }
      }

      setPosts(result);
      setLatestTotalCount(feedTotalCountCache.get(search.trim().toLowerCase()) ?? result.length);
      setPage(pageNumber);
      paginationPageRef.current = pageNumber;
      const totalAvailable = feedTotalCountCache.get(search.trim().toLowerCase());
      setHasMorePosts(search.trim() ? false : totalAvailable != null ? startIndex + result.length - 1 < totalAvailable : result.length === PAGE_SIZE);

      if (result.length === PAGE_SIZE) {
        void prefetchFeed(search, pageNumber + 1);
      }
    } catch {
      setError('Could not load the latest offers. Please try again.');
    } finally {
      if (!silent) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, []);

  const loadMorePosts = useCallback(async () => {
    if (!hasMorePosts || loading || searching || loadingMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      setLoadingMore(true);
      const activeSearch = query.trim().length >= 1 ? query.trim() : '';

      // Always request the next batch from the number of offers currently shown.
      // 20 shown -> start at 21 -> append the next 20 -> 40 shown.
      const currentCount = posts.length;
      const startIndex = currentCount + 1;
      const result = await fetchFeedFromNetwork(activeSearch, startIndex);

      setPosts(current => {
        const existingIds = new Set(current.map(item => item.id));
        const newPosts = result.filter(item => !existingIds.has(item.id));
        return [...current, ...newPosts];
      });

      const nextTotal = currentCount + result.length;
      const nextPage = Math.floor(nextTotal / PAGE_SIZE) || 1;
      setPage(nextPage);
      paginationPageRef.current = nextPage;
      const totalAvailable = feedTotalCountCache.get(search.trim().toLowerCase());
      setHasMorePosts(totalAvailable != null ? startIndex + result.length - 1 < totalAvailable : result.length === PAGE_SIZE);
    } catch {
      setError('Could not load more offers. Please try again.');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMorePosts, loading, searching, loadingMore, query, posts.length]);


  
  const syncPushTokenForCurrentUser = async (requestPermissionIfNeeded = true) => {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return;

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Offerhaikya',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
        });
      }

      const existingPermission = await Notifications.getPermissionsAsync();
      let finalStatus = existingPermission.status;

      if (finalStatus !== 'granted' && requestPermissionIfNeeded) {
        const permission = await Notifications.requestPermissionsAsync();
        finalStatus = permission.status;
      }

      if (finalStatus !== 'granted') {
        await setDoc(
          doc(db, 'users', firebaseUser.uid),
          {
            notificationsEnabled: false,
            notificationPermission: finalStatus,
          },
          { merge: true },
        );
        return;
      }

      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      if (!projectId) {
        console.log('Expo project ID not found for push notifications.');
        return;
      }

      const pushToken = (
        await Notifications.getExpoPushTokenAsync({ projectId })
      ).data;

      // Main save: this is the one the Worker needs.
      await setDoc(
        doc(db, 'users', firebaseUser.uid),
        {
          expoPushToken: pushToken,
          notificationsEnabled: true,
          notificationPermission: 'granted',
        },
        { merge: true },
      );


    } catch (error) {
      console.log('Push notification sync error:');
    }
  };


  useEffect(() => {
    if (!authReady || !startupGateOpen) return;

    let cancelled = false;

    const setup = async () => {
      if (cancelled) return;
      await syncPushTokenForCurrentUser();
      if (!cancelled) setNotificationStageDone(true);
    };

    void setup();

    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // If the user enabled notifications in Android Settings while the app
        // was away, refresh the token without triggering another permission dialog.
        void syncPushTokenForCurrentUser(false);
      }
    });

    const tokenSubscription = Notifications.addPushTokenListener(async token => {
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser || cancelled) return;

        const projectId =
          Constants?.expoConfig?.extra?.eas?.projectId ??
          Constants?.easConfig?.projectId;

        if (!projectId) {
          console.log('Expo project ID not found for push token listener.');
          return;
        }

        const pushToken = (
          await Notifications.getExpoPushTokenAsync({ projectId })
        ).data;

        await setDoc(
          doc(db, 'users', firebaseUser.uid),
          {
            expoPushToken: pushToken,
            notificationsEnabled: true,
            notificationPermission: 'granted',
          },
          { merge: true },
        );

      } catch (error) {
        console.log('Push token update error:');
      }
    });

    return () => {
      cancelled = true;
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [authReady, startupGateOpen]);



  useEffect(() => {
    startupPreloaderProgress.setValue(0);
    setStartupPreloaderStage('local');

    const onlineTimer = setTimeout(() => {
      setStartupPreloaderStage('online');
    }, 1500);

    const animation = Animated.timing(startupPreloaderProgress, {
      toValue: 1,
      duration: 1500,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    animation.start();

    const timer = setTimeout(() => {
      setStartupPreloader(false);
    }, 1500);

    return () => {
      animation.stop();
      clearTimeout(timer);
      clearTimeout(onlineTimer);
    };
  }, [startupPreloaderProgress]);

  useEffect(() => {
    if (startupGateOpen) return;
    if (!authReady || !accountStateLoaded || startupPreloader || registrationOpen) return;
    setStartupGateOpen(true);
  }, [authReady, accountStateLoaded, startupPreloader, registrationOpen, startupGateOpen]);

  // Safety net: keep the app usable if account-state loading stalls unexpectedly.
  useEffect(() => {
    const timer = setTimeout(() => setAccountStateLoaded(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (registrationOpen) return;

    let cancelled = false;

    const locationAliases: Record<string, string[]> = {
      belagavi: ['belagavi', 'belgavi', 'belgaum', 'belgaon', 'belagavi district', 'belgavi district', 'belgaum district'],
      belgaum: ['belagavi', 'belgavi', 'belgaum', 'belgaon', 'belagavi district', 'belgavi district', 'belgaum district'],
      bangalore: ['bengaluru', 'bangalore'],
      bengaluru: ['bengaluru', 'bangalore'],
      bombay: ['mumbai', 'bombay'],
      mumbai: ['mumbai', 'bombay'],
      calcutta: ['kolkata', 'calcutta'],
      kolkata: ['kolkata', 'calcutta'],
      madras: ['chennai', 'madras'],
      chennai: ['chennai', 'madras'],
    };

    const normalizeLocationText = (value = '') =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

    const buildLocationTerms = (place: any) => {
      const raw = [
        place?.street,
        place?.district,
        place?.subregion,
        place?.city,
        place?.region,
        place?.name,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean);

      const expanded = raw.flatMap(value => {
        const normalized = normalizeLocationText(value);
        const aliases = locationAliases[normalized] || [];
        const belagaviAliases = /belagavi|belgaum|belgaon/i.test(value)
          ? locationAliases.belagavi
          : [];
        return [value, ...aliases, ...belagaviAliases];
      });

      return Array.from(new Set(expanded.map(normalizeLocationText).filter(Boolean)));
    };

    const nearbyGeocodeCache = new Map<string, { latitude: number; longitude: number } | null>();

    const resolveOfferLocationCoordinates = async (
      candidates: string[],
    ): Promise<{ latitude: number; longitude: number } | null> => {
      for (const candidate of candidates) {
        const normalized = normalizeLocationText(candidate);
        if (!normalized) continue;

        const knownLocation = Object.keys(locationAliases).find(key =>
          normalized === key || normalized.includes(key),
        );
        const query = knownLocation || candidate;
        const cacheKey = normalizeLocationText(query);

        if (nearbyGeocodeCache.has(cacheKey)) {
          const cached = nearbyGeocodeCache.get(cacheKey);
          if (cached) return cached;
          continue;
        }

        try {
          const results = await Location.geocodeAsync(query);
          const first = results?.[0];
          const latitude = Number(first?.latitude);
          const longitude = Number(first?.longitude);
          const resolved =
            Number.isFinite(latitude) && Number.isFinite(longitude)
              ? { latitude, longitude }
              : null;

          nearbyGeocodeCache.set(cacheKey, resolved);
          if (resolved) return resolved;
        } catch {
          nearbyGeocodeCache.set(cacheKey, null);
        }
      }

      return null;
    };

    const matchesNearbyOffer = async (
      post: Post,
      coords: { latitude: number; longitude: number },
      detectedLocationTerms: string[],
    ): Promise<number | null> => {
      const normalizedLabels = [...post.labels, post.label]
        .map(label => normalizeLocationText(label))
        .filter(Boolean);
      const nearbyLocalTags = ['offline offer', 'local offer'];
      const allTagText = normalizedLabels.join(' ');
      const hasLocalOfferTag = nearbyLocalTags.some(tag => allTagText.includes(tag));
      if (!hasLocalOfferTag) return null;

      // Location priority:
      // 1) Blogger Location field
      // 2) Tags / labels
      // 3) Title
      // Description is intentionally not scanned.
      const bloggerLocationText = normalizeLocationText(post.locationName || '');
      const labelLocationCandidates = normalizedLabels
        .filter(label => !nearbyLocalTags.some(tag => label.includes(tag)));
      const titleText = normalizeLocationText(post.title);

      const locationCandidates = [
        bloggerLocationText,
        ...labelLocationCandidates,
        titleText,
      ].filter(Boolean);

      const matchedLocationTerm = detectedLocationTerms.find(term => {
        const normalizedTerm = normalizeLocationText(term);
        if (!normalizedTerm) return false;
        return locationCandidates.some(candidate => candidate.includes(normalizedTerm));
      });

      // Prefer coordinates supplied by Blogger Location.
      // If Blogger only supplies a name, geocode that name. This prevents
      // Goa/Kolhapur posts from disappearing just because Blogger omitted
      // explicit coordinates in the feed.
      let postLocation = post.locationCoordinates || null;

      if (!postLocation) {
        const locationCandidatesForGeocoding = [
          bloggerLocationText,
          ...labelLocationCandidates,
          titleText,
        ];

        const detectedCandidate = locationCandidatesForGeocoding.find(candidate =>
          Object.keys(locationAliases).some(key =>
            candidate === key || candidate.includes(key),
          ),
        );

        const geocodeCandidates = detectedCandidate
          ? [detectedCandidate]
          : locationCandidatesForGeocoding.slice(0, 3);

        postLocation = await resolveOfferLocationCoordinates(geocodeCandidates);
      }

      const distanceKmValue = postLocation ? distanceKm(coords, postLocation) : null;
      const distanceMatch =
        distanceKmValue !== null && distanceKmValue <= NEARBY_RADIUS_KM;

      return distanceMatch ? distanceKmValue : null;
    };

    const loadNearbyOffers = async () => {
      try {
        // locationRefreshKey means the device location state changed or the
        // app returned to the foreground. Never trust the previous Nearby cache.
        if (locationRefreshKey > 0) {
          nearbyCacheRef.current = null;
        }
        const permission = await Location.getForegroundPermissionsAsync();

        let coords: { latitude: number; longitude: number } | null = null;
        let detectedLocationTerms: string[] = [];
        let detectedLocationLabel = '';

        if (permission.status === 'granted') {
          const servicesEnabled = await Location.hasServicesEnabledAsync();
          if (!cancelled) setLocationServicesEnabled(servicesEnabled);

          if (servicesEnabled) {
            try {
              const lastKnown = await Location.getLastKnownPositionAsync({
                maxAge: 2 * 60 * 1000,
                requiredAccuracy: 5000,
              });

              const current = lastKnown || await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });

              if (!cancelled && current?.coords) {
                coords = {
                  latitude: current.coords.latitude,
                  longitude: current.coords.longitude,
                };
                setUserLocation(coords);

                try {
                  const places = await Location.reverseGeocodeAsync(coords);
                  const place = places?.[0];
                  detectedLocationLabel =
                    place?.district ||
                    place?.city ||
                    place?.subregion ||
                    place?.region ||
                    '';
                  detectedLocationTerms = buildLocationTerms(place);

                  if (
                    detectedLocationLabel &&
                    /belagavi|belgaum|belgaon/i.test(detectedLocationLabel)
                  ) {
                    detectedLocationTerms = Array.from(
                      new Set([
                        ...detectedLocationTerms,
                        'belagavi',
                        'belgaum',
                        'belgaon',
                        'belagavi district',
                        'belgaum district',
                      ]),
                    );
                  }
                } catch {
                  // Keep the coordinates even if reverse geocoding is temporarily unavailable.
                  detectedLocationLabel = '';
                  detectedLocationTerms = [];
                }

                // Save the latest real device location for registered users.
                try {
                  const firebaseUser = auth.currentUser;
                  if (firebaseUser && !firebaseUser.isAnonymous) {
                    await setDoc(
                      doc(db, 'users', firebaseUser.uid),
                      {
                        location: coords,
                        locationSource: 'gps',
                        locationLabel: detectedLocationLabel,
                        locationUpdatedAt: new Date().toISOString(),
                      },
                      { merge: true },
                    );
                  }
                } catch {
                  // Best-effort location storage.
                }
              }
            } catch {
              // GPS can be temporarily unavailable even though Location Services are ON.
              // Fall through to the saved Firebase location instead of losing Nearby.
            }
          }
        }

        // If current device Location is unavailable, use the registered user's
        // saved Firebase location. Current device GPS always has priority.
        if (!coords) {
          try {
            const firebaseUser = auth.currentUser;

            if (firebaseUser && !firebaseUser.isAnonymous) {
              const profileSnapshot = await getDoc(
                doc(db, 'users', firebaseUser.uid),
              );
              const profileData = profileSnapshot.exists()
                ? profileSnapshot.data()
                : null;

              const savedCoords = profileData?.location || profileData?.manualLocationCoordinates;
              const manualAreaCity = String(profileData?.areaCity || '').trim();

              if (
                savedCoords &&
                Number.isFinite(Number(savedCoords.latitude)) &&
                Number.isFinite(Number(savedCoords.longitude))
              ) {
                coords = {
                  latitude: Number(savedCoords.latitude),
                  longitude: Number(savedCoords.longitude),
                };
                detectedLocationLabel =
                  String(profileData?.locationLabel || manualAreaCity || '').trim();
                detectedLocationTerms = [];

                try {
                  const places = await Location.reverseGeocodeAsync(coords);
                  const place = places?.[0];

                  detectedLocationTerms = buildLocationTerms({
                    ...place,
                    city: place?.city || manualAreaCity,
                    name: place?.name || manualAreaCity,
                  });

                  if (manualAreaCity) {
                    detectedLocationTerms = Array.from(
                      new Set([
                        ...detectedLocationTerms,
                        ...buildLocationTerms({
                          city: manualAreaCity,
                          name: manualAreaCity,
                        }),
                      ]),
                    );
                  }

                  detectedLocationLabel =
                    place?.district ||
                    place?.city ||
                    place?.subregion ||
                    place?.region ||
                    detectedLocationLabel ||
                    manualAreaCity;
                } catch {
                  detectedLocationTerms = buildLocationTerms({
                    city: manualAreaCity || detectedLocationLabel,
                    name: manualAreaCity || detectedLocationLabel,
                  });
                }

                if (!cancelled) {
                  setUserLocation(coords);
                  setLocationLabel(detectedLocationLabel);
                  setLocationTerms(detectedLocationTerms);
                }
              }
            }
          } catch {
            // Best-effort Firebase location fallback.
          }
        }

        // Guests without a live GPS location do not reuse a stale local location.
        // Registered users use Firebase as the saved-location fallback above.
        if (coords) {
          try {
            await AsyncStorage.setItem(
              SAVED_LOCATION_STORAGE_KEY,
              JSON.stringify({
                coords,
                label: detectedLocationLabel,
                terms: detectedLocationTerms,
              }),
            );
          } catch {
            // Best-effort local location persistence.
          }
        }

        if (!coords) {
          if (!cancelled) {
            setUserLocation(null);
            setLocationLabel('');
            setLocationTerms([]);
            setNearbyPosts([]);
            setLocalOffersDisabled(false);
          }
          return;
        }

        if (!cancelled && permission.status === 'granted') {
          setLocationLabel(detectedLocationLabel);
          setLocationTerms(detectedLocationTerms);
        }

        const nearbyCacheKey =
          coords.latitude.toFixed(2) +
          ',' +
          coords.longitude.toFixed(2) +
          '|' +
          detectedLocationTerms.slice().sort().join('|');

        const cachedNearby = nearbyCacheRef.current;
        if (
          cachedNearby &&
          cachedNearby.key === nearbyCacheKey &&
          Date.now() - cachedNearby.savedAt <= NEARBY_CACHE_TTL_MS
        ) {
          if (!cancelled) {
            setNearbyPosts(cachedNearby.posts);
            setLocalOffersDisabled(cachedNearby.posts.length === 0);
            if (cachedNearby.posts.length === 0) {
              setLocalOfferEmptyOpen(true);
            } else {
              setLocalOfferEmptyOpen(false);
            }
          }
          finishNearbyPreloader();

          if (!cancelled && returnHomeToNearbyAfterLocationRef.current) {
            returnHomeToNearbyAfterLocationRef.current = false;
            setTimeout(() => {
              if (cancelled) return;
              goToHomeTab();
              setTimeout(() => {
                if (cancelled) return;
                mainListRef.current?.scrollToOffset({
                  offset: nearbySectionOffsetRef.current,
                  animated: true,
                });
              }, 450);
            }, 400);
          }
          return;
        }

        const allPosts = await getAllPostsForNearby();
        nearbyVisibleCountRef.current = PAGE_SIZE;
        setNearbyVisibleCount(PAGE_SIZE);
        nearbyLastUpdatedCheckRef.current = Date.now();

        const nearbyResults = await Promise.all(
          allPosts.map(post =>
            matchesNearbyOffer(post, coords, detectedLocationTerms),
          ),
        );
        const matches = allPosts
          .map((post, index) => {
            const distance = nearbyResults[index];
            return distance === null ? null : { ...post, nearbyDistanceKm: distance };
          })
          .filter((post): post is Post & { nearbyDistanceKm: number } => post !== null)
          .sort((a, b) => a.nearbyDistanceKm - b.nearbyDistanceKm);

        nearbyCacheRef.current = {
          key: nearbyCacheKey,
          savedAt: Date.now(),
          posts: matches,
        };

        if (!cancelled) {
          setNearbyPosts(matches);
          setLocalOffersDisabled(matches.length === 0);
          if (matches.length === 0) {
            setLocalOfferEmptyOpen(true);
          } else {
            setLocalOfferEmptyOpen(false);
          }
        }

        finishNearbyPreloader();

        if (!cancelled && returnHomeToNearbyAfterLocationRef.current) {
          returnHomeToNearbyAfterLocationRef.current = false;

          // Let the Nearby preload GIF complete first, then land on the
          // Home page and scroll directly to the Nearby section.
          setTimeout(() => {
            if (cancelled) return;
            goToHomeTab();
            setTimeout(() => {
              if (cancelled) return;
              mainListRef.current?.scrollToOffset({
                offset: nearbySectionOffsetRef.current,
                animated: true,
              });
            }, 450);
          }, 400);
        }
      } catch {
        if (!cancelled) {
          setNearbyPosts([]);
          setLocalOffersDisabled(false);
          setLocalOfferEmptyOpen(false);
        }

        finishNearbyPreloader();
      }
    };

    loadNearbyOffers();
    return () => { cancelled = true; };
  }, [registrationOpen, locationRefreshKey, finishNearbyPreloader]);

  useEffect(() => {
    if (registrationOpen || !userLocation) return;

    let cancelled = false;

    const normalizeLocationTextForPolling = (value = '') =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim();

    const matchesNearbyOfferForPolling = async (
      post: Post,
      coords: { latitude: number; longitude: number } | null,
      detectedLocationTerms: string[],
    ): Promise<number | null> => {
      if (!coords) return null;

      const normalizedLabels = [...post.labels, post.label]
        .map(label => normalizeLocationTextForPolling(label))
        .filter(Boolean);
      const nearbyLocalTags = ['offline offer', 'local offer'];
      if (!nearbyLocalTags.some(tag => normalizedLabels.join(' ').includes(tag))) {
        return null;
      }

      const locationCandidates = [
        normalizeLocationTextForPolling(post.locationName || ''),
        ...normalizedLabels.filter(label =>
          !nearbyLocalTags.some(tag => label.includes(tag)),
        ),
        normalizeLocationTextForPolling(post.title),
      ].filter(Boolean);

      const knownLocations = [
        'belagavi', 'belgaum', 'belgaon',
        'kolhapur', 'goa', 'panaji',
        'mumbai', 'pune', 'bengaluru', 'bangalore',
      ];

      const locationCandidate = locationCandidates.find(candidate =>
        knownLocations.some(location =>
          candidate === location || candidate.includes(location),
        ),
      );

      let postLocation = post.locationCoordinates || null;

      if (!postLocation && locationCandidate) {
        try {
          const result = await Location.geocodeAsync(locationCandidate);
          const first = result?.[0];
          if (
            Number.isFinite(Number(first?.latitude)) &&
            Number.isFinite(Number(first?.longitude))
          ) {
            postLocation = {
              latitude: Number(first.latitude),
              longitude: Number(first.longitude),
            };
          }
        } catch {
          // Best effort during background polling.
        }
      }

      if (!postLocation) return null;

      const distance = distanceKm(coords, postLocation);
      return distance <= NEARBY_RADIUS_KM ? distance : null;
    };

    const checkForNearbyPostUpdates = async () => {
      if (nearbyPollInFlightRef.current) return;
      nearbyPollInFlightRef.current = true;
      try {
        const updatedMin = new Date(
          nearbyLastUpdatedCheckRef.current - 5000,
        ).toISOString();

        const params = new URLSearchParams({
          alt: 'json',
          'max-results': '500',
          orderby: 'updated',
          'updated-min': updatedMin,
          ohk_refresh: String(Date.now()),
        });

        const response = await fetch(FEED_URL + '?' + params.toString(), {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, max-age=0',
            'Pragma': 'no-cache',
          },
        });

        if (!response.ok || cancelled) return;

        const data = await response.json();
        const updatedPosts = parseFeed(data);
        nearbyLastUpdatedCheckRef.current = Date.now();

        if (updatedPosts.length === 0) return;

        const latestNearbyResults = await Promise.all(
          updatedPosts.map(post =>
            matchesNearbyOfferForPolling(post, userLocation, locationTerms),
          ),
        );

        const latestNearbyMatches = updatedPosts
          .map((post, index) => {
            const distance = latestNearbyResults[index];
            return distance === null ? null : { ...post, nearbyDistanceKm: distance };
          })
          .filter((post): post is Post & { nearbyDistanceKm: number } => post !== null);

        setNearbyPosts(current => {
          const changedById = new Map(
            updatedPosts.map(post => [post.id, post]),
          );
          const changedNearbyById = new Map(
            latestNearbyMatches.map(post => [post.id, post]),
          );

          const refreshed = current
            .map(post => {
              const latest = changedById.get(post.id);
              if (!latest) return post;

              const nearbyMatch = changedNearbyById.get(post.id);
              return nearbyMatch || null;
            })
            .filter((post): post is Post & { nearbyDistanceKm: number } => post !== null);

          const refreshedIds = new Set(refreshed.map(post => post.id));
          const additions = latestNearbyMatches.filter(
            post => !refreshedIds.has(post.id),
          );

          const merged = [...additions, ...refreshed]
            .sort((a, b) => {
              const aUpdated = Date.parse(a.updatedAt || a.publishedAt || '');
              const bUpdated = Date.parse(b.updatedAt || b.publishedAt || '');
              if (Number.isFinite(aUpdated) && Number.isFinite(bUpdated) && aUpdated !== bUpdated) {
                return bUpdated - aUpdated;
              }
              return a.nearbyDistanceKm - b.nearbyDistanceKm;
            });

          const cached = nearbyCacheRef.current;
          if (cached) {
            nearbyCacheRef.current = {
              ...cached,
              savedAt: Date.now(),
              posts: merged,
            };
          }

          const hasMatches = merged.length > 0;
          setLocalOffersDisabled(!hasMatches);
          if (hasMatches) {
            setLocalOfferEmptyOpen(false);
          }

          return merged;
        });
      } catch {
        // Nearby polling is best-effort and must never interrupt the UI.
      } finally {
        nearbyPollInFlightRef.current = false;
      }
    };

    const interval = setInterval(
      checkForNearbyPostUpdates,
      NEARBY_NEW_POST_CHECK_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [registrationOpen, userLocation, locationTerms]);
  useEffect((): void | (() => void) => {
    if (!startupGateOpen || !notificationStageDone || registrationOpen || locationAutoStartedRef.current) {
      return;
    }

    locationAutoStartedRef.current = true;

    const showLocationPromptIfNeeded = async () => {
      try {
        // Do not check or reopen the custom location prompt while the Android
        // permission dialog is currently open.
        if (locationPermissionRequestActiveRef.current) return;

        const permission = await Location.getForegroundPermissionsAsync();
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        const locationReady =
          permission.status === 'granted' && servicesEnabled;

        // Refresh Nearby Offers only once when Location becomes ready.
        if (locationReady) {
          const wasLocationReady = locationReadyRef.current === true;

          locationReadyRef.current = true;
          setLocationPromptOpen(false);
          locationPromptSnoozeUntilRef.current = 0;

          if (locationAutoTimerRef.current) {
            clearTimeout(locationAutoTimerRef.current);
            locationAutoTimerRef.current = null;
          }

          // Keep the 30-second watcher alive so a later ON -> OFF
          // device Location change while the app is open is detected immediately.

          if (!wasLocationReady) {
            returnHomeToNearbyAfterLocationRef.current = true;

            if (returnHomeAfterLocationSettingsRef.current) {
              returnHomeAfterLocationSettingsRef.current = false;
              // Nearby navigation is handled after the fresh Nearby load completes.
            } else if (localOffersPermissionPendingRef.current) {
              localOffersPermissionPendingRef.current = false;
              enterLocalOffers();
            }
            startNearbyPreloader();
            nearbyCacheRef.current = null;
            setLocationRefreshKey(value => value + 1);
          }
          return;
        }

        // A real ON -> OFF transition must always ask immediately,
        // even if a previous "No" created a 5-minute snooze.
        const wasLocationReady = locationReadyRef.current === true;
        locationReadyRef.current = false;

        if (wasLocationReady) {
          locationPromptSnoozeUntilRef.current = 0;
        }

        // Check the device state frequently, but refresh Nearby only once when
        // the device actually changes from Location ON -> OFF.
        if (wasLocationReady) {
          nearbyCacheRef.current = null;
          setLocationRefreshKey(value => value + 1);
        }
        if (Date.now() < locationPromptSnoozeUntilRef.current) return;

        // Permission was permanently denied. Let the user use the location
        // button to open Settings instead of repeatedly showing this prompt.
        if (
          permission.status !== 'granted' &&
          permission.canAskAgain === false
        ) {
          return;
        }

        // Location was turned OFF while the app is open: show the existing
        // custom location box.
        setLocationPromptOpen(current => current ? current : true);
      } catch {
        // Stay silent if location state cannot be checked.
      }
    };

    const runLocationCheck = async () => {
      if (locationCheckInFlightRef.current) return;
      locationCheckInFlightRef.current = true;
      try {
        await showLocationPromptIfNeeded();
      } finally {
        locationCheckInFlightRef.current = false;
      }
    };

    const startLocationChecks = async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      const locationReady =
        permission.status === 'granted' && servicesEnabled;

      if (locationReady) {
        locationReadyRef.current = true;
        locationPromptSnoozeUntilRef.current = 0;
        startNearbyPreloader();
        setLocationRefreshKey(value => value + 1);
      } else {
        // Location is currently unavailable. Load the saved-location fallback
        // once, then keep checking silently for a future Location ON transition.
        locationPromptSnoozeUntilRef.current = 0;
        nearbyCacheRef.current = null;
        setLocationRefreshKey(value => value + 1);
        void runLocationCheck();
      }

      // Check every 15 seconds so turning device Location OFF while the app is
      // open is detected promptly. Tapping No schedules the 5-minute re-prompt.
      // The checker continues silently in the background.
      locationPromptSnoozeUntilRef.current = 0;
      void runLocationCheck();

      locationCheckIntervalRef.current = setInterval(
        runLocationCheck,
        LOCATION_CHECK_INTERVAL_MS
      );
    };

    void startLocationChecks();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        nearbyCacheRef.current = null;
        void runLocationCheck();
        setLocationRefreshKey(value => value + 1);
      }
    });

    return () => {
      if (locationAutoTimerRef.current) {
        clearTimeout(locationAutoTimerRef.current);
        locationAutoTimerRef.current = null;
      }
      if (locationCheckIntervalRef.current) {
        clearInterval(locationCheckIntervalRef.current);
        locationCheckIntervalRef.current = null;
      }
      locationAutoStartedRef.current = false;
      subscription.remove();
    };
  }, [registrationOpen, startNearbyPreloader, startupGateOpen, notificationStageDone]);

  useEffect(() => {
    let cancelled = false;

    const decodeMenuText = (value: string) => value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/\s+/g, ' ')
      .trim();

    const groupMenuLabels = (labels: string[], widgetSettings: boolean) => {
      const categories: string[] = [];
      const specialDeals: string[] = [];
      let group: 'categories' | 'special' | '' = '';
      labels.forEach(raw => {
        const isSubItem = raw.trim().startsWith('_');
        const label = decodeMenuText(raw.trim().replace(/^_+/, ''));
        const normalized = label.toLowerCase();
        if (normalized === 'categories') {
          group = 'categories';
          return;
        }
        if (normalized === 'special deal categories') {
          group = 'special';
          return;
        }
        if (!label || !group) return;
        if (widgetSettings && !isSubItem) {
          group = '';
          return;
        }
        if (!widgetSettings && ['about us', 'contact us', 'privacy policy', 'terms and condition', 'terms & conditions'].includes(normalized)) {
          group = '';
          return;
        }
        if (group === 'categories') categories.push(label);
        if (group === 'special') specialDeals.push(label);
      });
      return {
        categories: [...new Set(categories)],
        specialDeals: [...new Set(specialDeals)],
      };
    };

    const syncBloggerMenu = async () => {
      try {
        let source = '';
        let isWidgetSettings = false;

        // Prefer the live Blogger site so menu edits appear without a new APK.
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          try {
            const liveResponse = await fetch(BLOG_URL + '/?ohk_menu_sync=' + Date.now(), {
              headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' },
              signal: controller.signal,
            });
            if (liveResponse.ok) {
              source = await liveResponse.text();
              const logoStart = source.search(/id=['\"]main-logo['\"]/i);
              const logoRegion = logoStart >= 0 ? source.slice(logoStart, logoStart + 12000) : '';
              const darkLogoMatch = logoRegion.match(/data-dark-src=['\"]([^'\"]+)['\"]/i);
              const darkLogoCandidate = darkLogoMatch ? decodeMenuText(darkLogoMatch[1]) : '';
              const normalizedDarkLogoCandidate = darkLogoCandidate.startsWith('//')
                ? 'https:' + darkLogoCandidate
                : darkLogoCandidate;
              if (/^https?:\/\//i.test(normalizedDarkLogoCandidate) && !cancelled) {
                setBloggerDarkLogoUri(normalizedDarkLogoCandidate);
              }
            }
          } finally {
            clearTimeout(timeout);
          }
        } catch {
          // Fall back to the checked-in Blogger theme if the live page is unavailable.
        }

        let labels: string[] = [];
        if (source) {
          const widgetStart = source.search(/id=['"]LinkList200['"]/i);
          const nextWidget = widgetStart >= 0
            ? source.slice(widgetStart).search(/id=['"]LinkList201['"]/i)
            : -1;
          const widgetHtml = widgetStart >= 0
            ? source.slice(widgetStart, nextWidget > 0 ? widgetStart + nextWidget : widgetStart + 40000)
            : '';
          const anchorPattern = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
          let anchorMatch: RegExpExecArray | null;
          while ((anchorMatch = anchorPattern.exec(widgetHtml)) !== null) {
            const label = decodeMenuText(anchorMatch[1]);
            if (label) labels.push(label);
          }
        }

        if (labels.length > 0 && !isWidgetSettings) {
          const liveParsed = groupMenuLabels(labels, false);
          if (liveParsed.categories.length === 0 || liveParsed.specialDeals.length === 0) {
            labels = [];
          }
        }

        if (labels.length === 0) {
          const themeResponse = await fetch(
            'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_app_code/main/index.xml?ohk_menu_sync=' + Date.now(),
            { headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } },
          );
          if (!themeResponse.ok) return;
          source = await themeResponse.text();
          const widgetMatch = source.match(/<b:widget\b(?=[^>]*\bid=['"]LinkList200['"])[\s\S]*?<\/b:widget>/i);
          if (!widgetMatch) return;
          const settingPattern = /<b:widget-setting name=['"]text-(\d+)['"]>([\s\S]*?)<\/b:widget-setting>/gi;
          const settings: Array<{ index: number; label: string }> = [];
          let settingMatch: RegExpExecArray | null;
          while ((settingMatch = settingPattern.exec(widgetMatch[0])) !== null) {
            settings.push({ index: Number(settingMatch[1]), label: decodeMenuText(settingMatch[2]) });
          }
          labels = settings.sort((a, b) => a.index - b.index).map(item => item.label);
          isWidgetSettings = true;
        }

        const parsed = groupMenuLabels(labels, isWidgetSettings);
        if (!cancelled && parsed.categories.length > 0) setBloggerMenuCategories(parsed.categories);
        if (!cancelled && parsed.specialDeals.length > 0) setBloggerMenuSpecialDeals(parsed.specialDeals);
      } catch {
        // Keep the existing menu fallback if both live sources are unavailable.
      }
    };

    void syncBloggerMenu();
    const interval = setInterval(syncBloggerMenu, INFO_PAGE_AUTO_SYNC_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') void syncBloggerMenu();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let categoriesSyncInFlight = false;

    const syncBloggerCategories = async () => {
      if (cancelled || categoriesSyncInFlight) return;
      categoriesSyncInFlight = true;
      try {
        const response = await fetch(FEED_URL + '?alt=json&max-results=500');
        if (!response.ok) throw new Error('Unable to load Blogger categories');

        const data = await response.json();
        const entries = data?.feed?.entry || [];
        const seen = new Set<string>();
        const categories: string[] = [];

        entries.forEach((entry: any) => {
          (entry.category || []).forEach((item: any) => {
            const label = String(item?.term || '').trim();
            if (!label || label === 'All') return;
            if (!seen.has(label)) {
              seen.add(label);
              categories.push(label);
            }
          });
        });

        // Keep the Stores group visible even while Blogger labels are syncing.
        ['Stores', 'Belagavi Store', 'Goa Store'].forEach(label => {
          if (!seen.has(label)) {
            seen.add(label);
            categories.push(label);
          }
        });

        if (!cancelled) {
          setBloggerCategories(categories);
          setBloggerTags(categories);
        }
      } catch {
        // Keep fallback categories/tags when Blogger is temporarily unavailable.
      } finally {
        categoriesSyncInFlight = false;
      }
    };

    syncBloggerCategories();

    const interval = setInterval(syncBloggerCategories, METADATA_AUTO_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') syncBloggerCategories();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (registrationOpen) return;

    const syncNow = async () => {
      // Never let auto-refresh race with Load More or reset an expanded list.
      if (mainFeedRefreshInFlightRef.current || loadingMoreRef.current || paginationPageRef.current > 1) return;
      mainFeedRefreshInFlightRef.current = true;
      try {
        const activeSearch = query.trim().length >= 1 ? query.trim() : '';
        if (activeSearch) {
          await loadPosts(activeSearch, 1, true);
          return;
        }

        const params = new URLSearchParams({
          alt: 'json',
          'max-results': String(PAGE_SIZE),
          orderby: 'updated',
          ohk_refresh: String(Date.now()),
        });
        const response = await fetch(FEED_URL + '?' + params.toString(), {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, max-age=0',
            'Pragma': 'no-cache',
          },
        });
        if (!response.ok) throw new Error('Latest refresh failed');
        const data = await response.json();
        const refreshed = parseFeed(data);
        const totalResults = Number(data?.feed?.['openSearch$totalResults']?.$t);
        if (Number.isFinite(totalResults)) {
          setLatestTotalCount(totalResults);
          feedTotalCountCache.set('', totalResults);
        }
        // Keep the latest cache synchronized with the refreshed Home feed.
        const latestKey = getFeedCacheKey('', 1);
        feedCache.delete(latestKey);
        feedCache.set(latestKey, { posts: refreshed, savedAt: Date.now() });
        while (feedCache.size > FEED_CACHE_MAX_ENTRIES) {
          const oldestKey = feedCache.keys().next().value;
          if (oldestKey === undefined) break;
          feedCache.delete(oldestKey);
        }
        setPosts(refreshed);
        setPage(1);
        paginationPageRef.current = 1;
        setHasMorePosts(refreshed.length === PAGE_SIZE);
      } catch {
        // Keep the current latest list if background refresh fails.
      } finally {
        mainFeedRefreshInFlightRef.current = false;
      }
    };

    const interval = setInterval(syncNow, MAIN_AUTO_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') syncNow();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [registrationOpen, query, loadPosts]);

  useEffect(() => {
    const text = query.trim();
    const normalizedQuery = text.toLowerCase().replace(/\s+/g, ' ').trim();

    const timer = setTimeout(async () => {
      setActiveLabel('All');

      if (!normalizedQuery) {
        setSuggestions([]);
        loadPosts('', 1);
        return;
      }

      const scoreSuggestion = (post: Post) => {
        const title = post.title.toLowerCase();
        const location = (post.locationName || '').toLowerCase();
        const description = post.content.toLowerCase();
        const label = post.label.toLowerCase();
        const labels = post.labels.join(' ').toLowerCase();

        let score = 0;

        if (title === normalizedQuery) score += 3000;
        if (title.startsWith(normalizedQuery)) score += 1800;
        if (title.includes(normalizedQuery)) score += 1200;
        if (location === normalizedQuery) score += 1000;
        if (location.includes(normalizedQuery)) score += 800;
        if (label === normalizedQuery) score += 700;
        if (label.includes(normalizedQuery)) score += 500;
        if (labels.includes(normalizedQuery)) score += 350;
        if (description.includes(normalizedQuery)) score += 120;

        const words = normalizedQuery.split(' ').filter(Boolean);
        const matchedWords = words.filter(word =>
          title.includes(word) ||
          location.includes(word) ||
          description.includes(word) ||
          label.includes(word) ||
          labels.includes(word)
        );

        score += matchedWords.length * 35;

        return score;
      };

      try {
        setSuggestionLoading(true);

        const localMatches = posts
          .filter(post => scoreSuggestion(post) > 0)
          .sort((a, b) => scoreSuggestion(b) - scoreSuggestion(a));

        let combined = localMatches;

        try {
          const remoteResults = await getFeed(text, 1);
          const existingIds = new Set(combined.map(post => post.id));

          for (const post of remoteResults) {
            if (!existingIds.has(post.id)) {
              combined.push(post);
              existingIds.add(post.id);
            }
          }
        } catch {
          // Keep local suggestions when Blogger search is unavailable.
        }

        // Blogger's q search can miss older/title-specific posts. When the
        // ranked set is still empty, scan the nearby/latest feed once and rank
        // locally with title priority.
        if (combined.length === 0) {
          try {
            const allSearchPosts = await getAllPostsForNearby();
            const existingIds = new Set<string>();
            combined = allSearchPosts
              .filter(post => scoreSuggestion(post) > 0)
              .sort((a, b) => scoreSuggestion(b) - scoreSuggestion(a))
              .filter(post => {
                if (existingIds.has(post.id)) return false;
                existingIds.add(post.id);
                return true;
              });
          } catch {
            // Keep an empty suggestion list if the fallback search fails.
          }
        }

        const ranked = combined
          .map(post => ({
            post,
            score: scoreSuggestion(post),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map(item => item.post);

        setSuggestions(ranked);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestionLoading(false);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [query, posts, loadPosts]);

  const labels = useMemo(() => {
    const values = posts.map(post => post.label).filter(Boolean);
    return ['All', ...Array.from(new Set(values))];
  }, [posts]);

  const visiblePosts = useMemo(
    () => activeLabel === 'Hot Offers'
      ? hotOffersPosts
      : activeLabel === 'All'
        ? posts
        : posts.filter(post => post.label === activeLabel),
    [posts, hotOffersPosts, activeLabel],
  );

  const mainPostRows = useMemo(() => {
    const rows: Post[][] = [];
    for (let index = 0; index < visiblePosts.length; index += 2) {
      rows.push(visiblePosts.slice(index, index + 2));
    }
    return rows;
  }, [visiblePosts]);

  const tagPageRows = useMemo(() => {
    const rows: Post[][] = [];
    for (let index = 0; index < tagPagePosts.length; index += 2) {
      rows.push(tagPagePosts.slice(index, index + 2));
    }
    return rows;
  }, [tagPagePosts]);

  const getPostExpiryTime = (post: Post) => {
    const expiryTag = post.labels.find(label => /^E\d+$/i.test(label.trim()));
    if (!expiryTag || !post.publishedAt) return null;
    const days = Number(expiryTag.trim().slice(1));
    const publishedTime = Date.parse(post.publishedAt);
    if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(publishedTime)) return null;
    return publishedTime + days * 24 * 60 * 60 * 1000;
  };

  const sortedNearbyPosts = useMemo(() => {
    const sortDate = (post: Post) => {
      const time = Date.parse(post.updatedAt || post.publishedAt || '');
      return Number.isFinite(time) ? time : 0;
    };
    return [...nearbyPosts].sort((a, b) => {
      if (nearbySort === 'distance') {
        return (a.nearbyDistanceKm ?? Number.POSITIVE_INFINITY) - (b.nearbyDistanceKm ?? Number.POSITIVE_INFINITY);
      }
      if (nearbySort === 'oldest') return sortDate(a) - sortDate(b);
      return sortDate(b) - sortDate(a);
    });
  }, [nearbyPosts, nearbySort]);

  const sortedVisiblePosts = useMemo(() => {
    const items = [...visiblePosts];
    const published = (post: Post) => {
      const time = Date.parse(post.updatedAt || post.publishedAt || '');
      return Number.isFinite(time) ? time : 0;
    };
    const expiry = (post: Post) => getPostExpiryTime(post);
    const isExpired = (post: Post) => {
      const time = expiry(post);
      return time !== null && time <= expiryNow;
    };

    if (latestSort === 'oldest') return items.sort((a, b) => published(a) - published(b));
    if (latestSort === 'newest') return items.sort((a, b) => published(b) - published(a));

    if (latestSort === 'expired') {
      return items.sort((a, b) => {
        const aExpired = isExpired(a);
        const bExpired = isExpired(b);
        if (aExpired !== bExpired) return aExpired ? -1 : 1;
        const aExpiry = expiry(a);
        const bExpiry = expiry(b);
        if (aExpiry === null && bExpiry !== null) return 1;
        if (aExpiry !== null && bExpiry === null) return -1;
        if (aExpiry !== null && bExpiry !== null && aExpiry !== bExpiry) return aExpiry - bExpiry;
        return published(b) - published(a);
      });
    }

    return items.sort((a, b) => {
      const aExpiry = expiry(a);
      const bExpiry = expiry(b);
      const aExpired = aExpiry !== null && aExpiry <= expiryNow;
      const bExpired = bExpiry !== null && bExpiry <= expiryNow;

      if (aExpired !== bExpired) return aExpired ? 1 : -1;
      if (aExpiry === null && bExpiry !== null) return 1;
      if (aExpiry !== null && bExpiry === null) return -1;
      if (aExpiry !== null && bExpiry !== null && aExpiry !== bExpiry) return aExpiry - bExpiry;
      return published(b) - published(a);
    });
  }, [visiblePosts, latestSort, expiryNow]);

  const sortedMainPostRows = useMemo(() => {
    const rows: Post[][] = [];
    for (let index = 0; index < sortedVisiblePosts.length; index += 2) {
      rows.push(sortedVisiblePosts.slice(index, index + 2));
    }
    return rows;
  }, [sortedVisiblePosts]);

  const searchTagPage = useCallback(async (text: string) => {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    setTagPageLoading(true);
    try {
      const allPosts = await getAllPostsForNearby();
      const score = (post: Post) => {
        const title = post.title.toLowerCase();
        const location = (post.locationName || '').toLowerCase();
        const description = post.content.toLowerCase();
        const label = post.label.toLowerCase();
        const labels = post.labels.join(' ').toLowerCase();
        let value = 0;
        if (title === normalized) value += 3000;
        if (title.startsWith(normalized)) value += 1800;
        if (title.includes(normalized)) value += 1200;
        if (location === normalized) value += 1000;
        if (location.includes(normalized)) value += 800;
        if (label.includes(normalized)) value += 500;
        if (labels.includes(normalized)) value += 350;
        if (description.includes(normalized)) value += 120;
        const words = normalized.split(' ').filter(Boolean);
        value += words.filter(word =>
          title.includes(word) ||
          location.includes(word) ||
          description.includes(word) ||
          label.includes(word) ||
          labels.includes(word)
        ).length * 35;
        return value;
      };
      const matches = allPosts
        .filter(post => score(post) > 0)
        .sort((a, b) => score(b) - score(a));
      tagPageAllPostsRef.current = matches;
      tagPageStartPageRef.current = 1;
      tagPagePageRef.current = 1;
      setTagPagePosts(matches.slice(0, PAGE_SIZE));
      setTagPageHasMore(matches.length > PAGE_SIZE);
    } catch {
      setTagPagePosts([]);
      setTagPageHasMore(false);
    } finally {
      setTagPageLoading(false);
    }
  }, []);

  const loadHotOffers = async () => {
    try {
      setError('');
      setLoading(true);
      const allPosts = await getAllPostsForNearby();
      const hotOffers = allPosts.filter(post =>
        post.labels.some(label => {
          const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          return normalized === 'online offers'
            || normalized === 'online offer'
            || normalized === 'offline offers'
            || normalized === 'offline offer';
        }),
      );
      setHotOffersPosts(hotOffers);
    } catch {
      setHotOffersPosts([]);
      setError('Could not load hot offers. Please try again.');
    } finally {
      setLoading(false);
      setSearching(false);
    }
  };

  const loadTagPosts = useCallback(async (tag: string, startPage = 1) => {
    try {
      setTagPageLoading(true);
      const allPosts = await getAllPostsForNearby();
      const matches = tag === ALL_POSTS_TAG
        ? allPosts
        : (() => {
            const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
            return allPosts.filter(post =>
              post.labels.some(label =>
                label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() === normalizedTag,
              ),
            );
          })();

      tagPageAllPostsRef.current = matches;
      tagPageStartPageRef.current = startPage;
      tagPagePageRef.current = startPage;

      const start = (startPage - 1) * PAGE_SIZE;
      const firstBatch = matches.slice(start, start + PAGE_SIZE);
      setTagPagePosts(firstBatch);
      setTagPageHasMore(start + firstBatch.length < matches.length);
    } catch {
      tagPageAllPostsRef.current = [];
      tagPageStartPageRef.current = startPage;
      tagPagePageRef.current = startPage;
      setTagPagePosts([]);
      setTagPageHasMore(false);
    } finally {
      setTagPageLoading(false);
    }
  }, []);

  const refreshTagPosts = useCallback(async (tag: string) => {
    try {
      const allPosts = await getAllPostsForNearby();
      const matches = tag === ALL_POSTS_TAG
        ? allPosts
        : (() => {
            const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
            return allPosts.filter(post =>
              post.labels.some(label =>
                label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() === normalizedTag,
              ),
            );
          })();

      const start = (tagPageStartPageRef.current - 1) * PAGE_SIZE;
      const end = tagPagePageRef.current * PAGE_SIZE;

      tagPageAllPostsRef.current = matches;
      setTagPagePosts(matches.slice(start, end));
      setTagPageHasMore(end < matches.length);
    } catch {
      // Keep the currently displayed tag-page posts if a refresh fails.
    }
  }, []);

  const loadMoreTagPosts = useCallback(() => {
    if (!tagPageHasMore || tagPageLoading || tagPageLoadingMore) return;

    setTagPageLoadingMore(true);
    const nextPage = tagPagePageRef.current + 1;
    const start = (nextPage - 1) * PAGE_SIZE;
    const nextBatch = tagPageAllPostsRef.current.slice(start, start + PAGE_SIZE);

    setTagPagePosts(current => [...current, ...nextBatch]);
    tagPagePageRef.current = nextPage;
    setTagPageHasMore(start + nextBatch.length < tagPageAllPostsRef.current.length);
    setTagPageLoadingMore(false);
  }, [tagPageHasMore, tagPageLoading, tagPageLoadingMore]);

  useEffect(() => {
    if (!tagPage) return;

    const text = query.trim();
    const timer = setTimeout(async () => {
      if (!text) {
        const startPage = tagPageStartPageRef.current;
        await loadTagPosts(tagPage, startPage);
        return;
      }

      const normalized = text.toLowerCase().replace(/\\s+/g, ' ').trim();
      const score = (post: Post) => {
        const title = post.title.toLowerCase();
        const location = (post.locationName || '').toLowerCase();
        const description = post.content.toLowerCase();
        const label = post.label.toLowerCase();
        const labels = post.labels.join(' ').toLowerCase();
        let value = 0;
        if (title === normalized) value += 3000;
        if (title.startsWith(normalized)) value += 1800;
        if (title.includes(normalized)) value += 1200;
        if (location === normalized) value += 1000;
        if (location.includes(normalized)) value += 800;
        if (label.includes(normalized)) value += 500;
        if (labels.includes(normalized)) value += 350;
        if (description.includes(normalized)) value += 120;
        const words = normalized.split(' ').filter(Boolean);
        value += words.filter(word =>
          title.includes(word) ||
          location.includes(word) ||
          description.includes(word) ||
          label.includes(word) ||
          labels.includes(word)
        ).length * 35;
        return value;
      };

      try {
        setTagPageLoading(true);
        let source = tagPageAllPostsRef.current;

        if (source.length === 0) {
          source = await getAllPostsForNearby();
        }

        const results = source
          .filter(post => score(post) > 0)
          .sort((a, b) => score(b) - score(a));

        tagPageStartPageRef.current = 1;
        tagPagePageRef.current = 1;
        setTagPagePosts(results.slice(0, PAGE_SIZE));
        setTagPageHasMore(results.length > PAGE_SIZE);
      } catch {
        setTagPagePosts([]);
        setTagPageHasMore(false);
      } finally {
        setTagPageLoading(false);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [tagPage, query, loadTagPosts]);

  useEffect(() => {
    if (!tagPage || query.trim()) return;

    const interval = setInterval(() => {
      void refreshTagPosts(tagPage);
    }, MAIN_AUTO_SYNC_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [tagPage, query, refreshTagPosts]);

  const getNotificationsStorageKey = (uid: string) =>
    NOTIFICATIONS_STORAGE_PREFIX + uid;

  const getNotificationDismissedStorageKey = (uid: string) =>
    NOTIFICATION_DISMISSED_STORAGE_PREFIX + uid;

  const notificationVersionKey = (post: Post) =>
    String(post.id) + '::' + String(post.updatedAt || post.publishedAt || 'unknown');

  const isNotificationDismissed = (post: Post) => {
    // Dismiss only the exact post version. A later Blogger edit has a new
    // version key and may appear in the bell again.
    const versionKey = notificationVersionKey(post);
    return dismissedNotificationIdsRef.current.has(versionKey) ||
      dismissedNotificationIdsRef.current.has(String(post.id)) ||
      Object.prototype.hasOwnProperty.call(guestDismissedNotificationRef.current, versionKey) ||
      Object.prototype.hasOwnProperty.call(guestDismissedNotificationRef.current, String(post.id));
  };

  const notificationPostFromData = (data: any): Post | null => {
    const postId = data?.postId || data?.id;
    const postTitle = data?.postTitle || data?.title;
    const postUrl = data?.postUrl || data?.url;
    if (!postId || !postTitle || !postUrl) return null;
    return {
      id: String(postId),
      title: String(postTitle),
      url: String(postUrl),
      date: String(data.postDate || data.date || ''),
      publishedAt: String(data.publishedAt || data.postDate || data.date || ''),
      updatedAt: String(data.updatedAt || data.publishedAt || data.postDate || data.date || ''),
      notificationTimestamp: typeof data.createdAt?.toMillis === 'function'
        ? data.createdAt.toMillis()
        : Number(data.notificationTimestamp || 0) || Date.parse(String(data.updatedAt || data.publishedAt || data.postDate || data.date || '')) || 0,
      notificationType: ['updated', 'offer-update'].includes(String(data.notificationType || '')) ? 'updated' : data.notificationType === 'relevant' ? 'relevant' : 'new',
      label: String(data.postLabel || data.label || 'Offers'),
      labels: Array.isArray(data.postLabels || data.labels) ? (data.postLabels || data.labels).map((value: any) => String(value)) : [],
      image: typeof (data.postImage || data.image) === 'string' ? (data.postImage || data.image) : '',
      excerpt: String(data.postExcerpt || data.excerpt || ''),
      content: String(data.postContent || data.content || ''),
      rawContent: String(data.postRawContent || data.rawContent || ''),
      locationName: typeof data.locationName === 'string' ? data.locationName : undefined,
      locationCoordinates: data.locationCoordinates && typeof data.locationCoordinates === 'object' ? data.locationCoordinates : undefined,
    };
  };

  const loadNotificationDismissals = async (user: any) => {
    const dismissed = new Set<string>();
    if (!user?.uid) {
      dismissedNotificationIdsRef.current = dismissed;
      return dismissed;
    }

    if (user.isAnonymous) {
      try {
        const stored = await AsyncStorage.getItem(GUEST_NOTIFICATION_DISMISSED_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        guestDismissedNotificationRef.current =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        guestDismissedNotificationRef.current = {};
      }
      dismissedNotificationIdsRef.current = dismissed;
      return dismissed;
    }

    try {
      const stored = await AsyncStorage.getItem(getNotificationDismissedStorageKey(user.uid));
      const localParsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(localParsed)) localParsed.forEach(item => item && dismissed.add(String(item)));
    } catch {}

    try {
      const stateSnapshot = await getDoc(doc(db, 'notificationStates', user.uid));
      const cloudDismissed = stateSnapshot.exists() ? stateSnapshot.data()?.dismissedPostIds : [];
      if (Array.isArray(cloudDismissed)) cloudDismissed.forEach(item => item && dismissed.add(String(item)));
    } catch (error) {
      console.log('Notification dismissal state load error:');
    }

    dismissedNotificationIdsRef.current = dismissed;
    try {
      await AsyncStorage.setItem(getNotificationDismissedStorageKey(user.uid), JSON.stringify(Array.from(dismissed)));
    } catch {}
    return dismissed;
  };

  const getLatestBellNotifications = (sourcePosts: Post[]) => {
    const latestTen = sourcePosts.slice(0, 10);
    return latestTen
      .filter(post => !isNotificationDismissed(post))
      .map(post => {
        const versionKey = notificationVersionKey(post);
        const hasOlderDismissal =
          Object.keys(guestDismissedNotificationRef.current).some(key =>
            key.startsWith(String(post.id) + '::') && key !== versionKey,
          ) ||
          Array.from(dismissedNotificationIdsRef.current).some(key =>
            key.startsWith(String(post.id) + '::') && key !== versionKey,
          );
        const receivedUpdate = notifications.some(item =>
          item.id === post.id &&
          notificationVersionKey(item) === versionKey &&
          item.notificationType === 'updated',
        );
        return hasOlderDismissal || receivedUpdate
          ? { ...post, notificationType: 'updated' as const }
          : post;
      });
  };

  const loadNotificationsForUser = async (user: any) => {
    try {
      await loadNotificationDismissals(user);
      const latest = getLatestBellNotifications(posts);

      if (user && !user.isAnonymous) {
        const stored = await AsyncStorage.getItem(getNotificationsStorageKey(user.uid));
        const parsed = stored ? JSON.parse(stored) : [];
        const storedNotifications = Array.isArray(parsed) ? parsed : [];
        let cloudNotifications: Post[] = [];
        try {
          const cloudSnapshot = await getDocs(
            firestoreQuery(collection(db, 'notifications'), where('uid', '==', user.uid)),
          );
          cloudNotifications = cloudSnapshot.docs
            .map(snapshot => notificationPostFromData(snapshot.data()))
            .filter((item): item is Post => Boolean(item))
            .sort((a, b) => (b.notificationTimestamp || 0) - (a.notificationTimestamp || 0));
        } catch (error) {
          console.log('Cloud notification history load error:');
        }

        // Keep the newest 10 notifications. Cloud history restores push notices
        // received while the app was closed; current Blogger data wins by ID.
        let relevant: Post[] = [];
        try {
          const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
          const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
          const categories = Array.isArray(profile.interestedCategories)
            ? profile.interestedCategories.map((item: any) =>
                String(item).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
              ).filter(Boolean)
            : [];

          const allPosts = await getAllPostsForNearby();
          const categoryMatches = allPosts.filter(post => {
            const labels = [post.label, ...post.labels]
              .map(item => String(item).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
              .filter(Boolean);
            return categories.some(category =>
              labels.some(label => label === category || label.includes(category) || category.includes(label)),
            );
          });

          const nearbyMatches = nearbyPosts;
          const seen = new Set<string>();
          relevant = [...categoryMatches, ...nearbyMatches].filter(post => {
            if (latest.some(item => item.id === post.id)) return false;
            if (isNotificationDismissed(post)) return false;
            if (seen.has(post.id)) return false;
            seen.add(post.id);
            return true;
          });
        } catch (error) {
          console.log('Relevant notification refresh error:');
        }

        // If the feed has a newer version of a stored notification, prefer
        // the current feed version. Otherwise keep push metadata such as "updated".
        const retainedStored = storedNotifications.filter(stored =>
          !latest.some(current => current.id === stored.id &&
            notificationVersionKey(current) !== notificationVersionKey(stored)),
        );
        const mergedById = new Map<string, Post>();
        cloudNotifications.forEach(item => {
          if (!isNotificationDismissed(item)) mergedById.set(item.id, item);
        });
        latest.forEach(item => {
          if (isNotificationDismissed(item)) return;
          const cloudVersion = cloudNotifications.find(cloudItem => cloudItem.id === item.id);
          mergedById.set(item.id, cloudVersion?.notificationType === 'updated'
            ? { ...item, notificationType: 'updated', notificationTimestamp: cloudVersion.notificationTimestamp }
            : item);
        });
        [...retainedStored, ...relevant].forEach(item => {
          if (!mergedById.has(item.id) && !isNotificationDismissed(item)) mergedById.set(item.id, item);
        });
        const merged = Array.from(mergedById.values())
          .sort((a, b) => (b.notificationTimestamp || Date.parse(b.updatedAt || b.publishedAt || '') || 0) - (a.notificationTimestamp || Date.parse(a.updatedAt || a.publishedAt || '') || 0))
          .slice(0, 10);
        setNotifications(merged);
      } else {
        setNotifications(latest);
      }
    } catch {
      setNotifications([]);
    }
  };

  const persistNotificationsForUser = async (user: any, nextNotifications: Post[]) => {
    if (!user?.uid || user.isAnonymous) return;
    try {
      await AsyncStorage.setItem(getNotificationsStorageKey(user.uid), JSON.stringify(nextNotifications));
    } catch (error) {
      console.log('Notifications save error:');
    }
  };

  const addReceivedNotification = (post: Post) => {
    if (isNotificationDismissed(post)) return;
    const user = auth.currentUser;
    setNotifications(current => {
      const next = [post, ...current.filter(item => item.id !== post.id)].slice(0, 10);
      if (user && !user.isAnonymous) void persistNotificationsForUser(user, next);
      return next;
    });
  };

  const dismissNotification = async (post: Post) => {
    const user = auth.currentUser;
    const postId = String(post.id);
    const versionKey = notificationVersionKey(post);

    if (user?.isAnonymous) {
      const nextGuestDismissed = { ...guestDismissedNotificationRef.current, [versionKey]: Date.now() };
      guestDismissedNotificationRef.current = nextGuestDismissed;
      setNotifications(current => current.filter(item => item.id !== postId));
      try {
        await AsyncStorage.setItem(GUEST_NOTIFICATION_DISMISSED_STORAGE_KEY, JSON.stringify(nextGuestDismissed));
      } catch (error) {
        console.log('Guest notification dismissal save error:');
      }
      return;
    }

    dismissedNotificationIdsRef.current.add(versionKey);
    setNotifications(current => current.filter(item => item.id !== postId));
    if (!user?.uid) return;

    try {
      await AsyncStorage.setItem(
        getNotificationDismissedStorageKey(user.uid),
        JSON.stringify(Array.from(dismissedNotificationIdsRef.current)),
      );
    } catch (error) {
      console.log('Notification dismissal save error:');
    }

    try {
      await setDoc(
        doc(db, 'notificationStates', user.uid),
        { dismissedPostIds: arrayUnion(versionKey) },
        { merge: true },
      );
    } catch (error) {
      console.log('Cloud notification dismissal save error:');
    }
  };

  const deleteAllNotifications = () => {
    if (notifications.length === 0) return;

    Alert.alert(
      'Delete all notifications?',
      'Are you sure you want to delete all notifications?',
      [
        { text: 'NO', style: 'cancel' },
        {
          text: 'YES',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const user = auth.currentUser;
              const dismissedKeys = notifications.map(item => notificationVersionKey(item)).filter(Boolean);

              // Clear the visible UI immediately. Persistence happens in the
              // background so Delete All never blocks the popup for seconds.
              setNotifications([]);
              setNotificationsOpen(false);

              if (user?.isAnonymous) {
                const now = Date.now();
                const nextGuestDismissed = { ...guestDismissedNotificationRef.current };
                dismissedKeys.forEach(key => { nextGuestDismissed[key] = now; });
                guestDismissedNotificationRef.current = nextGuestDismissed;
                try {
                  await AsyncStorage.setItem(
                    GUEST_NOTIFICATION_DISMISSED_STORAGE_KEY,
                    JSON.stringify(nextGuestDismissed),
                  );
                } catch (error) {
                  console.log('Guest delete-all save error:');
                }
              } else if (user?.uid) {
                dismissedKeys.forEach(key => dismissedNotificationIdsRef.current.add(key));
                try {
                  await AsyncStorage.setItem(
                    getNotificationDismissedStorageKey(user.uid),
                    JSON.stringify(Array.from(dismissedNotificationIdsRef.current)),
                  );
                } catch (error) {
                  console.log('Notification delete-all local save error:');
                }
                try {
                  if (dismissedKeys.length > 0) {
                    await setDoc(
                      doc(db, 'notificationStates', user.uid),
                      { dismissedPostIds: arrayUnion(...dismissedKeys) },
                      { merge: true },
                    );
                  }
                } catch (error) {
                  console.log('Notification delete-all cloud save error:');
                }
                try {
                  await AsyncStorage.removeItem(getNotificationsStorageKey(user.uid));
                } catch (error) {
                  console.log('Notification history clear error:');
                }
              }

            })();
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (!authReady) return;

    // Notification reconciliation can scan Blogger data; let the UI render first.
    const timer = setTimeout(() => {
      void loadNotificationsForUser(auth.currentUser);
    }, 350);
    return () => clearTimeout(timer);
  }, [authReady, registrationCompleted, authUserKey]);

  useEffect(() => {
    if (!authReady) return;

    setNotifications(current => {
      const latest = getLatestBellNotifications(posts);
      const latestIds = new Set(latest.map(post => post.id));
      const receivedOnly = current.filter(
        post => !latestIds.has(post.id) && !isNotificationDismissed(post),
      );
      const merged = [...receivedOnly, ...latest];
      const seen = new Set<string>();
      return merged.filter(post => {
        if (seen.has(post.id)) return false;
        seen.add(post.id);
        return true;
      }).slice(0, 10);
    });
  }, [posts, authReady]);

  useEffect(() => {
    if (!authReady) return;

    let cancelled = false;
    const syncLatestNotifications = async () => {
      try {
        const latest = await fetchFeedFromNetwork('', 1, true);
        if (!cancelled) {
          setNotifications(current => {
            const latestNotifications = getLatestBellNotifications(latest);
            const latestIds = new Set(latestNotifications.map(post => post.id));
            const receivedOnly = current.filter(
              post => !latestIds.has(post.id) && !isNotificationDismissed(post),
            );
            const merged = [...receivedOnly, ...latestNotifications];
            const seen = new Set<string>();
            return merged.filter(post => {
              if (seen.has(post.id)) return false;
              seen.add(post.id);
              return true;
            }).slice(0, 10);
          });
        }
      } catch {
        // Bell refresh is best-effort and must never affect the feed.
      }
    };

    const interval = setInterval(() => {
      void syncLatestNotifications();
    }, MAIN_AUTO_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authReady]);

  useEffect(() => {
    const receivedSubscription =
      Notifications.addNotificationReceivedListener(notification => {
        const post = notificationPostFromData(
          notification.request.content.data,
        );

        if (post) {
          addReceivedNotification(post);
        }
      });

    const openNotification = (notification: Notifications.Notification) => {
      const post = notificationPostFromData(
        notification.request.content.data,
      );

      if (!post) return;

      addReceivedNotification(post);
      setNotificationsOpen(false);
      openDetail(post);
    };

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(response => {
        openNotification(response.notification);
      });

    const checkInitialNotification = async () => {
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        if (response?.notification) {
          openNotification(response.notification);
          await Notifications.clearLastNotificationResponseAsync();
        }
      } catch (error) {
        console.log('Initial notification response error:');
      }
    };

    void checkInitialNotification();

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  const getFavoritesStorageKey = (uid: string) =>
    FAVORITES_STORAGE_PREFIX + uid;

  const loadFavoritesForUser = async (user: any) => {
    setFavorites([]);

    if (!user?.uid) return;

    try {
      const stored = await AsyncStorage.getItem(getFavoritesStorageKey(user.uid));
      if (!stored) return;

      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setFavorites(parsed);

        if (!user.isAnonymous) {
          await setDoc(
            doc(db, 'users', user.uid),
            {
              favoritePostIds: parsed
                .filter(item => item?.id)
                .map(item => String(item.id)),
            },
            { merge: true },
          );
        }
      }
    } catch (error) {
      console.log('Favorites load error:');
      setFavorites([]);
    }
  };

  const persistFavoritesForUser = async (user: any, nextFavorites: Post[]) => {
    if (!user?.uid) return;

    try {
      await AsyncStorage.setItem(
        getFavoritesStorageKey(user.uid),
        JSON.stringify(nextFavorites),
      );
    } catch (error) {
      console.log('Favorites save error:');
    }
  };

  const toggleFavorite = (post: Post) => {
    const user = auth.currentUser;

    setFavorites(current => {
      const next = current.some(item => item.id === post.id)
        ? current.filter(item => item.id !== post.id)
        : [...current, post];

      if (user?.uid) {
        void persistFavoritesForUser(user, next);

        if (!user.isAnonymous) {
          void setDoc(
            doc(db, 'users', user.uid),
            {
              favoritePostIds: next.some(item => item.id === post.id)
                ? arrayUnion(post.id)
                : arrayRemove(post.id),
            },
            { merge: true },
          ).catch(error => {
            console.log('Favorite notification target sync error:');
          });
        }
      }

      return next;
    });
  };

  const copyPostLink = async (url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      ToastAndroid.show('Link copied', ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show('Could not copy link', ToastAndroid.SHORT);
    }
  };

  const openShareOptions = (url: string) => {
    setSharePostUrl(url);
  };

  const sharePost = async () => {
    if (!sharePostUrl) return;

    try {
      await Share.share({
        message: sharePostUrl,
        title: 'Share Offerhaikya post',
      });
    } catch {
      ToastAndroid.show('Could not open share options', ToastAndroid.SHORT);
    } finally {
      setSharePostUrl(null);
    }
  };

  const isFavorite = (post: Post) => favorites.some(item => item.id === post.id);

  const getExpiryLabel = (post: Post) => {
    const expiryTag = post.labels.find(label => /^E\d+$/i.test(label.trim()));

    if (!expiryTag || !post.publishedAt) {
      return '';
    }

    const days = Number(expiryTag.trim().slice(1));

    if (!Number.isFinite(days) || days <= 0) {
      return '';
    }

    const publishedTime = new Date(post.publishedAt).getTime();

    if (Number.isNaN(publishedTime)) {
      return '';
    }

    const expiryTime = publishedTime + days * 24 * 60 * 60 * 1000;
    const remainingMs = expiryTime - expiryNow;

    if (remainingMs <= 0) {
      return 'Expired';
    }

    const totalMinutes = Math.ceil(remainingMs / (60 * 1000));
    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const remainingDays = Math.floor(totalHours / 24);
    const hours = totalHours % 24;

    if (remainingDays > 0) {
      return hours > 0
        ? `Expires in ${remainingDays}d ${hours}h`
        : `Expires in ${remainingDays}d`;
    }

    if (totalHours > 0) {
      return minutes > 0
        ? `Expires in ${totalHours}h ${minutes}m`
        : `Expires in ${totalHours}h`;
    }

    return `Expires in ${minutes}m`;
  };

  const openDetail = (post: Post) => {
    closeMenu();
    setInfoPage(null);
    setDetail(post);
  };

  const openInfoPage = (page: 'about' | 'contact' | 'privacy' | 'terms') => {
    closeMenu();
    setMenuOpen(false);
    setDetail(null);
    setBottomTab(null);
    setInfoPage(page);
  };

  const openMenu = () => {
    setMenuOpen(true);
    menuAnim.setValue(-320);
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const closeMenu = () => {
    Animated.timing(menuAnim, {
      toValue: -320,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMenuOpen(false);
    });
  };

  const openWelcomeRegistration = () => {
    setAuthMode('register');
    setProfileMode(false);
    setProfileLoading(false);
    setRegistrationError('');
    setRegistrationSuccess('');
    setRegistrationPassword('');
      registrationPasswordRef.current = '';
    setRegistrationPasswordVisible(false);
    setRegistrationName('');
    setRegistrationContact('');
    setRegistrationEmail('');
    setRegistrationAreaCity('');
    setRegistrationCategories([]);
    registrationNameRef.current = '';
    registrationContactRef.current = '';
    registrationEmailRef.current = '';
    registrationAreaCityRef.current = '';
    registrationCategoriesRef.current = [];
    setRegistrationOpen(true);
  };

  const validateRegistration = () => {
    const name = registrationName.trim();
    const contact = registrationContact.trim();
    const email = (registrationEmailRef.current || registrationEmail).trim().toLowerCase();
    const password = registrationPasswordRef.current || registrationPassword;
    const categories = registrationCategoriesRef.current.length
      ? registrationCategoriesRef.current
      : registrationCategories;

    if (!/^[A-Za-z ]{3,12}$/.test(name)) {
      setRegistrationError('Name must be 3-12 letters.');
      return null;
    }

    if (!/^\d{10}$/.test(contact)) {
      setRegistrationError('Enter a valid 10-digit Indian phone number.');
      return null;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegistrationError('Enter a valid email address.');
      return null;
    }

    if (password.length < 6) {
      setRegistrationError('Password must be at least 6 characters.');
      return null;
    }

    if (categories.length === 0) {
      setRegistrationError('Please select at least one interested category.');
      return null;
    }

    return {
      name,
      contact: '91' + contact,
      email,
      password,
      areaCity: registrationAreaCity.trim(),
      categories,
    };
  };


  const saveRegisteredProfile = async (
    user: any,
    profile: {
      name: string;
      contact: string;
      email: string;
      categories: string[];
      areaCity: string;
    },
  ) => {
    // Firestore is the source of truth. Do not cache a profile until the
    // cloud write succeeds, otherwise a failed registration can look complete
    // on the next app launch.
    await setDoc(
      doc(db, 'users', user.uid),
      {
        uid: user.uid,
        name: profile.name,
        contact: profile.contact,
        email: profile.email,
        interestedCategories: profile.categories,
        areaCity: profile.areaCity,
        profileStatus: 'registered',
        registrationCompleted: true,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    const profileCacheData = {
      uid: user.uid,
      name: profile.name,
      contact: profile.contact,
      email: profile.email,
      interestedCategories: profile.categories,
      areaCity: profile.areaCity,
    };
    profileMemoryCache.set(user.uid, profileCacheData);
    try {
      await AsyncStorage.setItem(
        PROFILE_CACHE_PREFIX + user.uid,
        JSON.stringify(profileCacheData),
      );
    } catch {
      // The cloud profile was saved successfully; local cache is optional.
    }

    // Geocode only after the profile is already saved, so this can never block
    // the registration/login UI.
    if (profile.areaCity) {
      void Location.geocodeAsync(profile.areaCity)
        .then(geocoded => {
          const first = geocoded?.[0];
          if (first?.latitude == null || first?.longitude == null) return;

          return setDoc(
            doc(db, 'users', user.uid),
            {
              manualLocationCoordinates: {
                latitude: first.latitude,
                longitude: first.longitude,
              },
            },
            { merge: true },
          );
        })
        .catch(() => {
          // Manual location text remains saved even if geocoding is unavailable.
        });
    }
  };

  const submitRegistration = async () => {
    if (signInSubmittingRef.current) return;

    const profile = validateRegistration();
    if (!profile) return;

    try {
      signInSubmittingRef.current = true;
      registrationFlowActiveRef.current = true;
      setRegistrationSubmitting(true);
      setRegistrationError('');
      setRegistrationSuccess('');

      let user = auth.currentUser;

      if (!user) {
        user = (await signInAnonymously(auth)).user;
      }

      const credential = EmailAuthProvider.credential(
        profile.email,
        profile.password,
      );

      let registeredUser;

      if (user.isAnonymous) {
        registeredUser = (await linkWithCredential(user, credential)).user;
      } else {
        registeredUser = (
          await createUserWithEmailAndPassword(
            auth,
            profile.email,
            profile.password,
          )
        ).user;
      }

      // Keep the user's name on Firebase Auth as a fallback, then persist
      // the complete profile to Firestore before showing registration success.
      try {
        await updateFirebaseProfile(registeredUser, { displayName: profile.name });
      } catch {
        // Firestore remains the source of truth for the full profile.
      }
      await saveRegisteredProfile(registeredUser, profile);
      void syncPushTokenForCurrentUser();
      await AsyncStorage.setItem(HAS_REGISTERED_ACCOUNT_KEY, 'true');
      await AsyncStorage.removeItem(SKIP_STORAGE_KEY);

      if (skipReminderTimerRef.current) {
        clearTimeout(skipReminderTimerRef.current);
        skipReminderTimerRef.current = null;
      }

      setProfileStatus('registered');
      setRegistrationCompleted(true);
      setRegistrationSubmitting(false);
      setRegistrationSuccess('Account created successfully ✓');

      setTimeout(() => {
        registrationFlowActiveRef.current = false;
        setRegistrationOpen(false);
        setProfileMode(false);
        setRegistrationSuccess('');
        setRegistrationPassword('');
        setRegistrationPasswordVisible(false);
      }, 450);
    } catch (error: any) {
      console.log('Registration error:');

      if (error?.code === 'auth/email-already-in-use' || error?.code === 'auth/credential-already-in-use') {
        setRegistrationError('This email is already registered. Tap Sign in below.');
      } else if (error?.code === 'auth/weak-password') {
        setRegistrationError('Password must be at least 6 characters.');
      } else {
        setRegistrationError('Could not create your account. Please try again.');
      }

      registrationFlowActiveRef.current = false;
      setRegistrationSubmitting(false);
    } finally {
      // Always release the shared submit lock so Login works after a failed registration.
      signInSubmittingRef.current = false;
    }
  };

  const loadRegisteredProfile = async (user: any) => {
    if (accountDeletionResetRef.current) return;

    const applyProfile = (data: any) => {
      if (accountDeletionResetRef.current) return;
      const profile = data || {};
      const name = String(profile.name || user.displayName || '');
      const contact = String(profile.contact || '').replace(/^91/, '');
      const email = String(profile.email || user.email || '');
      const areaCity = String(profile.areaCity || '');
      const categories = Array.isArray(profile.interestedCategories)
        ? profile.interestedCategories
        : [];

      setProfileStatus('registered');
      setRegistrationCompleted(true);
      setProfileMode(true);
      setAuthMode('register');
      setRegistrationName(name);
      setRegistrationContact(contact);
      setRegistrationEmail(email);
      setRegistrationAreaCity(areaCity);
      setRegistrationCategories(categories);

      registrationNameRef.current = name;
      registrationContactRef.current = contact;
      registrationEmailRef.current = email;
      registrationAreaCityRef.current = areaCity;
      registrationCategoriesRef.current = categories;
    };

    // Show in-memory data synchronously first, then hydrate from persistent cache.
    const memoryCachedProfile = profileMemoryCache.get(user.uid);
    if (memoryCachedProfile) {
      applyProfile(memoryCachedProfile);
      setProfileLoading(false);
    }

    try {
      const cached = await AsyncStorage.getItem(PROFILE_CACHE_PREFIX + user.uid);
      if (cached) {
        const parsed = JSON.parse(cached);
        profileMemoryCache.set(user.uid, parsed);
        applyProfile(parsed);
        setProfileLoading(false);
      }
    } catch (error) {
      console.log('Profile cache read error:');
    }

    // Refresh from Firestore in the background.
    void getDoc(doc(db, 'users', user.uid))
      .then(async snapshot => {
        if (!snapshot.exists() || accountDeletionResetRef.current) return;
        const data = snapshot.data();
        const refreshedProfile = {
          uid: user.uid,
          name: data.name || '',
          contact: data.contact || '',
          email: data.email || user.email || '',
          interestedCategories: Array.isArray(data.interestedCategories)
            ? data.interestedCategories
            : [],
          areaCity: data.areaCity || '',
        };
        profileMemoryCache.set(user.uid, refreshedProfile);
        await AsyncStorage.setItem(
          PROFILE_CACHE_PREFIX + user.uid,
          JSON.stringify(refreshedProfile),
        );
        applyProfile(data);
      })
      .catch(error => {
        console.log('Profile Firestore read error:');
        // If there was no cache, still show the Firebase account email immediately.
        if (!auth.currentUser || accountDeletionResetRef.current) return;
        applyProfile({ email: auth.currentUser.email || '' });
      });
  };

  const openProfile = async () => {
    setRegistrationError('');
    setRegistrationSuccess('');
    setRegistrationCategoriesOpen(false);
    setRegistrationPassword('');
      registrationPasswordRef.current = '';
    setRegistrationPasswordVisible(false);

    try {
      // Never show an old Nearby loading overlay while opening Profile.
      if (nearbyPreloaderTimerRef.current) clearTimeout(nearbyPreloaderTimerRef.current);
      if (nearbyPreloaderFinishTimerRef.current) clearTimeout(nearbyPreloaderFinishTimerRef.current);
      nearbyPreloaderOpenRef.current = false;
      nearbyPreloaderTimedOutRef.current = true;
      setNearbyPreloaderOpen(false);
      setNearbyPreloaderProgress(0);

      const user = auth.currentUser;
      const hasRegisteredAccount = (await AsyncStorage.getItem(HAS_REGISTERED_ACCOUNT_KEY)) === 'true';

      if (!user || user.isAnonymous) {
        setProfileMode(false);
        setProfileLoading(false);
        if (hasRegisteredAccount) {
          setAuthMode('signIn');
          setRegistrationOpen(true);
        } else {
          openWelcomeRegistration();
        }
        return;
      }

      setRegistrationOpen(true);
      setProfileMode(true);
      setProfileLoading(true);
      await loadRegisteredProfile(user);
    } catch (error) {
      console.log('Profile load error:');

      // Keep the registered profile screen open instead of showing
      // the new-user registration form.
      setRegistrationOpen(true);
      setProfileMode(true);
      setProfileStatus('registered');
      setRegistrationCompleted(true);
      setAuthMode('register');
      setRegistrationEmail(String(auth.currentUser?.email || ''));
      setRegistrationError('');
    } finally {
      setProfileLoading(false);
    }
  };

  const saveProfile = async () => {
    const user = auth.currentUser;

    if (!user || user.isAnonymous) {
      setRegistrationError('Please sign in to update your profile.');
      return;
    }

    const name = registrationName.trim();
    const contact = registrationContact.trim();
    const email = registrationEmail.trim().toLowerCase();
    const areaCity = registrationAreaCity.trim();
    const categories = registrationCategoriesRef.current.length
      ? registrationCategoriesRef.current
      : registrationCategories;

    if (!/^[A-Za-z ]{3,12}$/.test(name)) {
      setRegistrationError('Name must be 3-12 letters.');
      return;
    }

    if (!/^\d{10}$/.test(contact)) {
      setRegistrationError('Enter a valid 10-digit Indian phone number.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegistrationError('Enter a valid email address.');
      return;
    }

    if (categories.length === 0) {
      setRegistrationError('Please select at least one interested category.');
      return;
    }

    try {
      registrationFlowActiveRef.current = true;
      setRegistrationSubmitting(true);
      setRegistrationError('');

      if (email !== String(user.email || '').toLowerCase()) {
        await updateEmail(user, email);
      }

      await updateFirebaseProfile(user, { displayName: name });

      await saveRegisteredProfile(user, {
        name,
        contact: '91' + contact,
        email,
        categories,
        areaCity,
      });

      setRegistrationSubmitting(false);
      setRegistrationSuccess('Profile updated successfully ✓');

      setTimeout(() => {
        registrationFlowActiveRef.current = false;
        setRegistrationOpen(false);
        setProfileMode(false);
        setRegistrationSuccess('');
      }, 900);
    } catch (error: any) {
      console.log('Profile update error:');

      if (error?.code === 'auth/requires-recent-login') {
        setRegistrationError('Please sign in again before changing your email.');
      } else {
        setRegistrationError('Could not update your profile. Please try again.');
      }

      registrationFlowActiveRef.current = false;
      setRegistrationSubmitting(false);
    }
  };

  const signInAccount = async () => {
    if (signInSubmittingRef.current) return;

    const email = registrationEmail.trim().toLowerCase();
    const password = registrationPassword;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegistrationError('Enter a valid email address.');
      return;
    }

    if (!password) {
      setRegistrationError('Enter your password.');
      return;
    }

    try {
      signInSubmittingRef.current = true;
      registrationFlowActiveRef.current = true;
      setRegistrationSubmitting(true);
      setRegistrationError('');

      const credential = await signInWithEmailAndPassword(auth, email, password);
      await AsyncStorage.setItem(HAS_REGISTERED_ACCOUNT_KEY, 'true');

      if (pendingDeleteAfterLoginRef.current) {
        pendingDeleteAfterLoginRef.current = false;
        await deleteAccountAfterRecentLogin();
        signInSubmittingRef.current = false;
        registrationFlowActiveRef.current = false;
        setRegistrationSubmitting(false);
        return;
      }

      // Close the login UI immediately after Firebase authentication succeeds.
      // Profile hydration continues in the background from cache/Firestore.
      void loadRegisteredProfile(credential.user);
      void syncPushTokenForCurrentUser();

      signInSubmittingRef.current = false;
      registrationFlowActiveRef.current = false;
      setRegistrationSubmitting(false);
      setRegistrationPassword('');
      registrationPasswordRef.current = '';
      setRegistrationPasswordVisible(false);
      setRegistrationError('');
      setRegistrationSuccess('');

      // Normal login ends at the home screen. The profile icon can be used
      // later to open My Profile.
      setRegistrationOpen(false);
      setProfileMode(false);
      setAuthMode('register');
    } catch (error: any) {
      console.log('Sign in error:');

      if (
        error?.code === 'auth/invalid-credential' ||
        error?.code === 'auth/user-not-found' ||
        error?.code === 'auth/wrong-password'
      ) {
        setRegistrationError('Email or password is incorrect.');
      } else if (error?.code === 'auth/invalid-email') {
        setRegistrationError('Enter a valid email address.');
      } else if (error?.code === 'auth/too-many-requests') {
        setRegistrationError('Too many attempts. Please try again later.');
      } else if (error?.code === 'auth/network-request-failed') {
        setRegistrationError('Internet connection failed. Please try again.');
      } else {
        setRegistrationError('Login failed. Please try again.');
      }

      registrationFlowActiveRef.current = false;
      signInSubmittingRef.current = false;
      setRegistrationSubmitting(false);
    }
  };

  const forgotPassword = async () => {
    const email = registrationEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegistrationError('Enter your email address first.');
      return;
    }

    try {
      setRegistrationSubmitting(true);
      await sendPasswordResetEmail(auth, email);
      setRegistrationSubmitting(false);
      setRegistrationError('');
      setRegistrationSuccess('Password reset email sent. Check your inbox ✓');
      setTimeout(() => setRegistrationSuccess(''), 3000);
    } catch (error: any) {
      console.log('Forgot password error:');

      setRegistrationSubmitting(false);
      if (error?.code === 'auth/user-not-found') {
        setRegistrationError('No account was found with this email.');
      } else {
        setRegistrationError('Could not send the password reset email.');
      }
    }
  };

  const skipRegistration = async () => {
    try {
      await ensureAnonymousUser();
      await AsyncStorage.setItem(SKIP_STORAGE_KEY, String(Date.now()));

      setProfileStatus('skipped');
      setRegistrationCompleted(false);
      setProfileMode(false);
      setAuthMode('register');
      setRegistrationOpen(false);

      if (skipReminderTimerRef.current) {
        clearTimeout(skipReminderTimerRef.current);
      }

      skipReminderTimerRef.current = setTimeout(() => {
        void checkRegistrationReminder();
      }, SKIP_REMINDER_MS);
    } catch (error) {
      console.log('Skip registration error:');
      setRegistrationOpen(false);
    }
  };

  const deleteAccountAfterRecentLogin = async () => {
    const user = auth.currentUser;

    if (!user || user.isAnonymous) {
      setRegistrationError('Registered account not found.');
      return;
    }

    try {
      setRegistrationSubmitting(true);
      setRegistrationError('');

      const uid = user.uid;
      const email = user.email?.trim().toLowerCase() || '';

      if (!email || !registrationPassword) {
        setRegistrationError('Enter your account password to confirm deletion.');
        return;
      }

      // Explicitly re-authenticate before the destructive operation.
      const credential = EmailAuthProvider.credential(email, registrationPassword);
      const reauthenticated = await reauthenticateWithCredential(user, credential);

      // Delete the user's profile and favorites while Auth is still valid.
      await deleteDoc(doc(db, 'users', uid));
      profileMemoryCache.delete(uid);
      await AsyncStorage.removeItem(getFavoritesStorageKey(uid));
      await AsyncStorage.removeItem(PROFILE_CACHE_PREFIX + uid);
      setFavorites([]);

      // Block any delayed profile hydration from restoring deleted-account fields.
      accountDeletionResetRef.current = true;

      // Delete the Firebase Authentication account using the freshly re-authenticated user.
      await deleteUser(reauthenticated.user);
      await signOut(auth).catch(() => {});
      await signInAnonymously(auth);
      await loadFavoritesForUser(auth.currentUser);
      await AsyncStorage.removeItem(HAS_REGISTERED_ACCOUNT_KEY);

      await AsyncStorage.setItem(SKIP_STORAGE_KEY, String(Date.now()));

      setProfileStatus('skipped');
      setRegistrationCompleted(false);
      setRegistrationOpen(false);
      setProfileMode(false);
      setAuthMode('register');
      setRegistrationName('');
      setRegistrationContact('');
      setRegistrationEmail('');
      setRegistrationPassword('');
      registrationPasswordRef.current = '';
      setRegistrationPasswordVisible(false);
      setRegistrationAreaCity('');
      setRegistrationCategories([]);
      setRegistrationCategoriesOpen(false);
      setLocationRefreshKey(value => value + 1);

      registrationNameRef.current = '';
      registrationContactRef.current = '';
      registrationEmailRef.current = '';
      registrationAreaCityRef.current = '';
      registrationCategoriesRef.current = [];
      pendingDeleteAfterLoginRef.current = false;

      // Clear once more after the auth transition has settled so every input is visibly blank.
      setTimeout(() => {
        setRegistrationName('');
        setRegistrationContact('');
        setRegistrationEmail('');
        setRegistrationPassword('');
        registrationPasswordRef.current = '';
        setRegistrationPasswordVisible(false);
        setRegistrationAreaCity('');
        setRegistrationCategories([]);
        setRegistrationCategoriesOpen(false);
        registrationNameRef.current = '';
        registrationContactRef.current = '';
        registrationEmailRef.current = '';
        registrationAreaCityRef.current = '';
        registrationCategoriesRef.current = [];
        accountDeletionResetRef.current = false;
      }, 500);

      if (skipReminderTimerRef.current) {
        clearTimeout(skipReminderTimerRef.current);
      }

      skipReminderTimerRef.current = setTimeout(() => {
        void checkRegistrationReminder();
      }, SKIP_REMINDER_MS);
    } catch (error: any) {
      console.log('Profile delete error:');

      if (error?.code === 'auth/requires-recent-login') {
        pendingDeleteAfterLoginRef.current = true;
        setProfileMode(false);
        setAuthMode('signIn');
        setRegistrationPassword('');
        setRegistrationPasswordVisible(false);
        setRegistrationError('Please login again to confirm account deletion.');
        setRegistrationOpen(true);
      } else {
        setRegistrationError('Could not delete your account. Please try again.');
      }
    } finally {
      setRegistrationSubmitting(false);
    }
  };

  const deleteProfile = () => {
    Alert.alert(
      'Delete profile?',
      'Please login again to confirm deletion of your account and profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            pendingDeleteAfterLoginRef.current = true;
            setRegistrationError('Please login again to confirm account deletion.');
            setRegistrationPassword('');
            setRegistrationPasswordVisible(false);
            setAuthMode('signIn');
            setProfileMode(false);
            setRegistrationOpen(true);
          },
        },
      ],
    );
  };

  const logoutAccount = async () => {
    Alert.alert(
      'Log out?',
      'Are you sure you want to log out of your Offerhaikya account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try {
              setRegistrationSubmitting(true);
              setRegistrationError('');
              pendingDeleteAfterLoginRef.current = false;

              const previousUserId = auth.currentUser?.uid;
              await signOut(auth);
              if (previousUserId) profileMemoryCache.delete(previousUserId);

              // Immediately remove the previous user's data from the visible form.
              setNotifications([]);
              setNotificationsOpen(false);
              setFavorites([]);
              setProfileStatus('skipped');
              setRegistrationCompleted(false);
              setProfileMode(false);
              setAuthMode('register');
              setRegistrationName('');
              setRegistrationContact('');
              setRegistrationEmail('');
              setRegistrationPassword('');
              setRegistrationPasswordVisible(false);
              setRegistrationAreaCity('');
              setRegistrationCategories([]);
              setRegistrationCategoriesOpen(false);
              setRegistrationSuccess('');

              registrationNameRef.current = '';
              registrationContactRef.current = '';
              registrationEmailRef.current = '';
              registrationAreaCityRef.current = '';
              registrationCategoriesRef.current = [];

              // Create a separate guest session after logout.
              await signInAnonymously(auth);
              // Guest browsing can resume while guest favorites hydrate from storage.
              void loadFavoritesForUser(auth.currentUser);
              // Re-run the location/nearby flow for the guest session. The
              // 30-second checker will prefer current GPS, then saved location.
              setLocationRefreshKey(value => value + 1);
              setRegistrationOpen(false);
            } catch (error) {
              console.log('Logout error:');
              setRegistrationError('Could not log out. Please try again.');
            } finally {
              setRegistrationSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const scheduleLocationPromptRetry = () => {
    if (locationAutoTimerRef.current) {
      clearTimeout(locationAutoTimerRef.current);
    }

    const snoozeUntil = Date.now() + LOCATION_RETRY_MS;
    locationPromptSnoozeUntilRef.current = snoozeUntil;

    locationAutoTimerRef.current = setTimeout(async () => {
      locationAutoTimerRef.current = null;

      try {
        const permission = await Location.getForegroundPermissionsAsync();
        const servicesEnabled = await Location.hasServicesEnabledAsync();

        if (permission.status === 'granted' && servicesEnabled) return;
        if (permission.status !== 'granted' && permission.canAskAgain === false) return;

        if (Date.now() < locationPromptSnoozeUntilRef.current) return;

        setLocationPromptOpen(true);
      } catch {
        // Do not reopen the prompt if location services or permission state cannot be checked.
      }
    }, LOCATION_RETRY_MS);
  };

  const requestLocationPermission = async () => {
    setLocationPromptOpen(false);

    if (locationAutoTimerRef.current) {
      clearTimeout(locationAutoTimerRef.current);
      locationAutoTimerRef.current = null;
    }

    locationPromptSnoozeUntilRef.current = 0;

    try {
      const currentPermission = await Location.getForegroundPermissionsAsync();
      const servicesEnabled = await Location.hasServicesEnabledAsync();

      if (currentPermission.status === 'granted') {
        if (!servicesEnabled) {
          // App permission is already granted: open device Location Settings.
          // Return to Home when Location is turned back ON.
          returnHomeAfterLocationSettingsRef.current = true;
          try {
            if (Platform.OS === 'android' && typeof Linking.sendIntent === 'function') {
              // Permission is already granted: open Android's device Location Services,
              // not the app-permission settings screen.
              await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
            } else {
              // iOS: Location Services is managed from the app/device Settings.
              await Linking.openSettings();
            }
          } catch {
            // Keep the existing retry/check flow if Settings cannot be opened.
          }
          scheduleLocationPromptRetry();
        } else {
          if (localOffersPermissionPendingRef.current) {
            localOffersPermissionPendingRef.current = false;
            enterLocalOffers();
          }
          setLocationRefreshKey(value => value + 1);
        }
        return;
      }

      // If device Location Services are OFF, send the user directly to
      // Android Location Settings. This is the exact action needed to turn
      // device Location ON.
      if (!servicesEnabled) {
        try {
          if (Platform.OS === 'android') {
            await IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS,
            );
          } else {
            await Linking.openSettings();
          }
        } catch {
          // The 30-second checker will detect Location when the user enables it.
        }
        scheduleLocationPromptRetry();
        return;
      }

      // If Android has permanently denied app permission, open the app's
      // Settings page so the user can enable Location permission manually.
      if (currentPermission.canAskAgain === false) {
        try {
          await Linking.openSettings();
        } catch {
          // Keep the periodic checker alive.
        }
        scheduleLocationPromptRetry();
        return;
      }

      locationPermissionRequestActiveRef.current = true;

      const permission = await Location.requestForegroundPermissionsAsync();

      locationPermissionRequestActiveRef.current = false;

      if (permission.status === 'granted') {
        locationPromptSnoozeUntilRef.current = 0;
        returnHomeToNearbyAfterLocationRef.current = true;
        if (localOffersPermissionPendingRef.current) {
          localOffersPermissionPendingRef.current = false;
          returnHomeToNearbyAfterLocationRef.current = false;
          enterLocalOffers();
        } else {
          startNearbyPreloader();
          setLocationRefreshKey(value => value + 1);
        }
      } else {
        localOffersPermissionPendingRef.current = false;
        scheduleLocationPromptRetry();
      }
    } catch {
      locationPermissionRequestActiveRef.current = false;
      scheduleLocationPromptRetry();
    }
  };

  const postponeLocationPrompt = () => {
    setLocationPromptOpen(false);
    scheduleLocationPromptRetry();
  };

  const activateBottomTabFor5Sec = (tab: 'home' | 'local' | 'hot' | 'search' | 'request') => {
    setBottomTab(tab);

    if (bottomTabResetTimerRef.current) {
      clearTimeout(bottomTabResetTimerRef.current);
    }

    bottomTabResetTimerRef.current = setTimeout(() => {
      setBottomTab(null);
      bottomTabResetTimerRef.current = null;
    }, 3000);
  };

  const resetMainFeedToFirstPage = useCallback(() => {
    setPage(1);
    paginationPageRef.current = 1;
    setHasMorePosts(true);
    loadPosts('', 1);
  }, [loadPosts]);

  const goToHomeTab = () => {
    closeMenu();
    setDetail(null);
    setInfoPage(null);
    setTagPage(null);
    setTagPageDropdownOpen(false);
    activateBottomTabFor5Sec('home');
    setActiveLabel('All');
    setQuery('');
    setSuggestions([]);
    resetMainFeedToFirstPage();
    mainListRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const goToSearchTab = () => {
    closeMenu();
    setDetail(null);
    setInfoPage(null);
    activateBottomTabFor5Sec('search');

    setTimeout(() => {
      mainListRef.current?.scrollToOffset({ offset: 0, animated: true });
      searchInputRef.current?.focus();
    }, 300);
  };

  const goToHotOffersTab = () => {
    closeMenu();
    setDetail(null);
    setInfoPage(null);
    activateBottomTabFor5Sec('hot');
    setActiveLabel('Hot Offers');
    setQuery('');
    setSuggestions([]);
    loadHotOffers();
    setTimeout(() => {
      mainListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 150);
  };

  const enterLocalOffers = () => {
    closeMenu();
    setDetail(null);
    setInfoPage(null);
    setTagPage(null);
    setTagPageDropdownOpen(false);
    activateBottomTabFor5Sec('local');
    setLocalOfferEmptyOpen(false);
    setLocalOffersDisabled(false);
    requestAnimationFrame(() => {
      mainListRef.current?.scrollToOffset({
        offset: nearbySectionOffsetRef.current,
        animated: true,
      });
    });
  };

  const goToLocalOffersTab = async () => {
    closeMenu();
    setDetail(null);
    setInfoPage(null);

    try {
      const permission = await Location.getForegroundPermissionsAsync();
      const servicesEnabled = await Location.hasServicesEnabledAsync();

      if (permission.status === 'granted' && servicesEnabled) {
        localOffersPermissionPendingRef.current = false;
        enterLocalOffers();
        return;
      }

      // Open Nearby immediately. If location is unavailable, the existing
      // location prompt can then guide the user to enable/retry it.
      localOffersPermissionPendingRef.current = true;
      enterLocalOffers();
      setLocationPromptOpen(true);
    } catch {
      localOffersPermissionPendingRef.current = true;
      setLocationPromptOpen(true);
    }
  };

  const openOfferRequestTab = () => {
    closeMenu();
    setDetail(null);
    setInfoPage(null);
    activateBottomTabFor5Sec('request');
    setOfferRequestError('');
    setOfferRequestSuccess(false);
    setOfferRequestOpen(true);
  };


  const closeLocalOfferEmptyPopup = () => {
    setLocalOfferEmptyOpen(false);
  };


  const submitOfferRequest = async () => {
    const name = offerRequestName.trim();
    const contact = offerRequestContact.trim();
    const request = offerRequestText.trim();

    if (!/^[A-Za-z ]{3,12}$/.test(name)) {
      setOfferRequestError('Name must be 3-12 letters.');
      return;
    }
    if (!/^\d{10}$/.test(contact)) {
      setOfferRequestError('Enter a valid 10-digit Indian phone number.');
      return;
    }
    if (request.length < 5) {
      setOfferRequestError('Please describe the offer you are looking for.');
      return;
    }
    if (request.length > 50) {
      setOfferRequestError('Offer request must be 50 characters or less.');
      return;
    }

    try {
      setOfferRequestSubmitting(true);
      setOfferRequestSuccess(false);
      setOfferRequestError('');

      // Make sure Firebase has an authenticated session before writing.
      // This also covers users who opened the request form very quickly
      // before the anonymous auth bootstrap finished.
      const firebaseUser = await ensureAnonymousUser();

      // Allow at most 5 requests in any rolling 24-hour window.
      // Firestore rules independently enforce this queue so clients cannot bypass it.
      const limitRef = doc(db, 'offerRequestLimits', firebaseUser.uid);
      const limitSnapshot = await getDoc(limitRef);
      const limitData = limitSnapshot.exists() ? limitSnapshot.data() : null;
      const lastRequestAt = limitData?.lastRequestAt;
      const storedTimes = Array.isArray(limitData?.requestTimes)
        ? limitData.requestTimes.filter((value: any) => value && typeof value.toMillis === 'function')
        : [];

      let requestTimes: any[];
      if (!limitSnapshot.exists()) {
        requestTimes = [Timestamp.now()];
      } else if (Array.isArray(limitData?.requestTimes)) {
        requestTimes = storedTimes;
        if (requestTimes.length >= 5) {
          const oldestRequestAt = requestTimes[0];
          const elapsedMs = Date.now() - oldestRequestAt.toMillis();
          if (elapsedMs < 24 * 60 * 60 * 1000) {
            setOfferRequestSubmitting(false);
            setOfferRequestError('');
            setOfferRequestSuccess(false);
            setOfferRequestOpen(false);
            setOfferRequestName('');
            setOfferRequestContact('');
            setOfferRequestText('');
            Alert.alert('Request Offer', 'You can send another offer request after 24 hours. Thank you.');
            return;
          }
          requestTimes = [...requestTimes.slice(1), Timestamp.now()];
        } else {
          requestTimes = [...requestTimes, Timestamp.now()];
        }
      } else {
        // Migrate older one-request limit records safely. Do not allow another
        // request until the old 24-hour restriction has expired.
        if (lastRequestAt?.toMillis && Date.now() - lastRequestAt.toMillis() < 24 * 60 * 60 * 1000) {
          setOfferRequestSubmitting(false);
          setOfferRequestError('');
          setOfferRequestSuccess(false);
          setOfferRequestOpen(false);
          setOfferRequestName('');
          setOfferRequestContact('');
          setOfferRequestText('');
          Alert.alert('Request Offer', 'You can send another offer request after 24 hours. Thank you.');
          return;
        }
        requestTimes = lastRequestAt?.toMillis
          ? [lastRequestAt, Timestamp.now()]
          : [Timestamp.now()];
      }

      const requestId = firebaseUser.uid + '_' + Date.now();
      const requestRef = doc(db, 'offerRequests', requestId);
      const batch = writeBatch(db);

      batch.set(requestRef, {
        uid: firebaseUser.uid,
        name,
        phone: '91' + contact,
        request,
        requestId,
        createdAt: serverTimestamp(),
      });

      batch.set(limitRef, {
        lastRequestAt: serverTimestamp(),
        requestId,
        requestTimes,
      });

      await batch.commit();

      setOfferRequestSubmitting(false);
      setOfferRequestSuccess(true);

      setTimeout(() => {
        setOfferRequestOpen(false);
        setOfferRequestSuccess(false);
        setOfferRequestName('');
        setOfferRequestContact('');
        setOfferRequestText('');
      }, 900);
    } catch (error: any) {
      console.log('Offer request submit error:', error?.code, error?.message);
      setOfferRequestSubmitting(false);
      setOfferRequestSuccess(false);
      if (error?.code === 'resource-exhausted') {
        setOfferRequestError('');
        setOfferRequestOpen(false);
        setOfferRequestName('');
        setOfferRequestContact('');
        setOfferRequestText('');
        Alert.alert('Request Offer', 'You can send another offer request after 24 hours. Thank you.');
      } else {
        setOfferRequestError('Could not submit your request. Please try again.');
      }
    }
  };

  const renderPost = ({ item }: { item: Post }) => (
    <View key={item.id} style={[styles.card, darkMode && styles.cardDark]}>
      <TouchableOpacity style={styles.cardHeart} onPress={() => toggleFavorite(item)}>
        <Text style={styles.cardHeartText}>{isFavorite(item) ? '♥' : '♡'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.cardShare}
        onPress={() => openShareOptions(item.url)}
        accessibilityLabel="Share post"
      >
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Path
            d="M4 12L20 4L14 20L10 14L4 12Z"
            stroke={TEXT}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M10 14L20 4"
            stroke={TEXT}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      </TouchableOpacity>
      {item.nearbyDistanceKm !== undefined ? (
        <View style={styles.cardDistance}>
          <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
            <Path
              d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5A8 8 0 1 1 20 10.5Z"
              stroke={TEXT}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M12 13.25A2.75 2.75 0 1 0 12 7.75A2.75 2.75 0 0 0 12 13.25Z"
              stroke={TEXT}
              strokeWidth={2}
            />
          </Svg>
          <Text style={styles.cardDistanceText} numberOfLines={1}>
            {Math.round(item.nearbyDistanceKm)} km
          </Text>
        </View>
      ) : null}
      {getExpiryLabel(item) ? (
        <View style={styles.cardExpiry}>
          <Text style={styles.cardExpiryText} numberOfLines={1}>
            {getExpiryLabel(item)}
          </Text>
        </View>
      ) : null}
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={() => openDetail(item)}
      >
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.cardImage} />
        ) : (
          <View style={[styles.cardImage, styles.imageFallback]}>
            <Text style={styles.fallbackText}>Offerhaikya</Text>
          </View>
        )}
        <View style={[styles.cardBody, darkMode && styles.cardBodyDark]}>
          <Text style={styles.label}>{item.label}</Text>
          <Text style={[styles.title, darkMode && styles.darkText]} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.date}>{item.date}</Text>
          <Text style={[styles.excerpt, darkMode && styles.darkMutedText]} numberOfLines={3}>{item.excerpt}</Text>
          <Text style={styles.readText}>Read more ›</Text>
        </View>
      </TouchableOpacity>
    </View>
  );

  const notificationPopup = notificationsOpen ? (
    <View style={styles.favoriteOverlay}>
      <TouchableOpacity
        style={styles.favoriteOverlayBackdrop}
        activeOpacity={1}
        onPress={() => {
          setNotificationsOpen(false);
        }}
      />
      <View style={[styles.favoritePopup, darkMode && styles.favoritePopupDark]}>
        <View style={styles.favoritePopupHeader}>
          <View>
            <Text style={[styles.favoritePopupTitle, darkMode && styles.darkText]}>Notifications</Text>
          </View>
          <TouchableOpacity style={styles.favoriteClose} onPress={() => {
          setNotificationsOpen(false);
        }}>
            <Text style={[styles.favoriteCloseText, darkMode && styles.headerIconDark]}>×</Text>
          </TouchableOpacity>
        </View>

        {notifications.length === 0 ? (
          <View style={styles.favoriteEmpty}>
            <Text style={[styles.errorTitle, darkMode && styles.darkText]}>No notifications yet</Text>
            <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>
              New offer notifications will appear here.
            </Text>
          </View>
        ) : (
          <>
            <FlatList
              data={notifications}
              keyExtractor={item => notificationVersionKey(item)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.favoriteList}
              renderItem={({ item }) => (
                <View style={[styles.favoriteItem, darkMode && styles.favoriteItemDark]}>
                  <TouchableOpacity
                    style={styles.favoriteItemMain}
                    onPress={() => {
                      setNotificationsOpen(false);
                      openDetail(item);
                    }}
                  >
                    {item.image ? (
                      <Image source={{ uri: item.image }} style={styles.favoriteItemImage} />
                    ) : (
                      <View style={[styles.favoriteItemImage, styles.imageFallback]}>
                        <Text style={styles.favoriteItemFallback}>Offer</Text>
                      </View>
                    )}
                    <View style={styles.favoriteItemText}>
                      <Text style={[styles.favoriteItemTitle, darkMode && styles.darkText]} numberOfLines={2}>
                        {item.notificationType === 'updated' ? 'Updated: ' : ''}{item.title}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.favoriteRemove}
                    onPress={() => { void dismissNotification(item); }}
                    accessibilityLabel="Remove notification"
                  >
                    <Text style={styles.favoriteRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
            <TouchableOpacity
              style={styles.notificationDeleteAllButton}
              onPress={deleteAllNotifications}
              accessibilityLabel="Delete all notifications"
            >
              <Text style={styles.notificationDeleteAllText}>Delete All</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  ) : null;

  const favoritePopup = wishlistOpen ? (
    <View style={styles.favoriteOverlay}>
      <TouchableOpacity
        style={styles.favoriteOverlayBackdrop}
        activeOpacity={1}
        onPress={() => setWishlistOpen(false)}
      />
      <View style={[styles.favoritePopup, darkMode && styles.favoritePopupDark]}>
        <View style={styles.favoritePopupHeader}>
          <View>
            <Text style={[styles.favoritePopupTitle, darkMode && styles.darkText]}>Favorites</Text>
          </View>
          <TouchableOpacity style={styles.favoriteClose} onPress={() => setWishlistOpen(false)}>
            <Text style={[styles.favoriteCloseText, darkMode && styles.headerIconDark]}>×</Text>
          </TouchableOpacity>
        </View>

        {favorites.length === 0 ? (
          <View style={styles.favoriteEmpty}>
            <Text style={[styles.errorTitle, darkMode && styles.darkText]}>No favorites yet</Text>
            <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>
              Tap the heart on an offer to add it here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={favorites}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.favoriteList}
            renderItem={({ item }) => (
              <View style={[styles.favoriteItem, darkMode && styles.favoriteItemDark]}>
                <TouchableOpacity
                  style={styles.favoriteItemMain}
                  onPress={() => {
                    setWishlistOpen(false);
                    openDetail(item);
                  }}
                >
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.favoriteItemImage} />
                  ) : (
                    <View style={[styles.favoriteItemImage, styles.imageFallback]}>
                      <Text style={styles.favoriteItemFallback}>Offer</Text>
                    </View>
                  )}
                  <View style={styles.favoriteItemText}>
                    <Text style={[styles.favoriteItemTitle, darkMode && styles.darkText]} numberOfLines={2}>
                      {item.title}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.favoriteRemove}
                  onPress={() => toggleFavorite(item)}
                  accessibilityLabel="Remove favorite"
                >
                  <Text style={styles.favoriteRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>
    </View>
  ) : null;
  useEffect(() => {
    if (!infoPage) {
      setBloggerInfoData(null);
      setInfoPagePosts([]);
      setInfoPagePostsLoading(false);
      return;
    }

    let cancelled = false;

    let infoPostsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    const loadInfoPagePosts = async () => {
      try {
        if (!cancelled) setInfoPagePostsLoading(true);
        const latestPosts = await fetchFeedFromNetwork('', 1, true);
        if (!cancelled) setInfoPagePosts(latestPosts);
      } catch {
        if (!cancelled) setInfoPagePosts([]);
      } finally {
        if (!cancelled) setInfoPagePostsLoading(false);
      }
    };

    const scheduleInfoPostsRefresh = () => {
      if (cancelled) return;
      infoPostsRefreshTimer = setTimeout(() => {
        void loadInfoPagePosts();
        scheduleInfoPostsRefresh();
      }, METADATA_AUTO_SYNC_INTERVAL_MS);
    };

    void loadInfoPagePosts();
    scheduleInfoPostsRefresh();
    const slugs: Record<string, string> = {
      about: 'about-us',
      contact: 'contact-us',
      privacy: 'privacy-policy',
      terms: 'terms-and-condition',
    };

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const loadBloggerInfoPage = async () => {
      const controller = new AbortController();
      const requestTimeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(
          BLOG_URL + '/p/' + slugs[infoPage] + '.html?ohk_refresh=' + Date.now(),
          {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache, no-store, max-age=0',
              'Pragma': 'no-cache',
            },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error('Unable to load Blogger page');
        const html = await response.text();
        const bodyMatch = html.match(/<div[^>]*class=["'][^"']*post-body[^"']*["'][^>]*>([\s\S]*?)(?:<div[^>]*class=["'][^"']*post-footer|<\/article|<\/main)/i);
        const pageHtml = (bodyMatch?.[1] || '').trim();
        if (!pageHtml) return;
        const cleanPageHtml = infoPage === 'privacy' || infoPage === 'terms'
          ? pageHtml.replace(/<img\b[^>]*>/gi, '')
          : pageHtml;
        if (!cancelled) {
          setBloggerInfoData({
            title: infoPage === 'about' ? 'About Us' : infoPage === 'contact' ? 'Contact Us' : infoPage === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions',
            html: cleanPageHtml,
          });
        }
      } catch {
        // Keep the last successfully loaded Information page visible if a refresh fails.
      } finally {
        clearTimeout(requestTimeout);
      }
    };

    const scheduleRefresh = () => {
      if (cancelled) return;
      refreshTimer = setTimeout(() => {
        scheduleRefresh();
        void loadBloggerInfoPage();
      }, INFO_PAGE_AUTO_SYNC_INTERVAL_MS);
    };

    void loadBloggerInfoPage();
    scheduleRefresh();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        loadBloggerInfoPage();
      }
    });

    return () => {
      cancelled = true;
      if (infoPostsRefreshTimer) clearTimeout(infoPostsRefreshTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      subscription.remove();
    };
  }, [infoPage]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (detail) {
        setDetail(null);
        return true;
      }
      if (tagPage) {
        setTagPage(null);
        setTagPageDropdownOpen(false);
        setQuery('');
        setSuggestions([]);
        setActiveLabel('All');
        return true;
      }
      if (infoPage) {
        setInfoPage(null);
        return true;
      }
      if (menuOpen) {
        closeMenu();
        return true;
      }
      if (notificationsOpen) {
        setNotificationsOpen(false);
        return true;
      }
      if (wishlistOpen) {
        setWishlistOpen(false);
        return true;
      }
      if (registrationOpen) {
        setRegistrationOpen(false);
        setProfileMode(false);
        setRegistrationCategoriesOpen(false);
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [detail, tagPage, infoPage, menuOpen, notificationsOpen, wishlistOpen, registrationOpen]);

  useEffect(() => {
    if (!detail) {
      setDetailPagePosts([]);
      setDetailPagePostsLoading(false);
      return;
    }

    let cancelled = false;

    const loadDetailPageData = async () => {
      try {
        const latestPosts = await fetchFeedFromNetwork('', 1, true);
        const updatedDetail = latestPosts.find(post => post.id === detail.id);
        if (!cancelled && updatedDetail) {
          setDetail(updatedDetail);
        }
        if (!cancelled) setDetailPagePosts(latestPosts);
      } catch {
        // Keep the currently visible offer details if a refresh fails.
      } finally {
        if (!cancelled) setDetailPagePostsLoading(false);
      }
    };

    loadDetailPageData();
    const detailRefreshTimer = setInterval(() => {
      void loadDetailPageData();
    }, METADATA_AUTO_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(detailRefreshTimer);
    };
  }, [detail?.id]);

  if (infoPage) {
    const infoTitles = {
      about: 'About Us',
      contact: 'Contact Us',
      privacy: 'Privacy Policy',
      terms: 'Terms & Conditions',
    };
    return (
      <SafeAreaView style={[styles.safe, darkMode && styles.darkSafe]}>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} backgroundColor={darkMode ? '#000000' : WHITE} />
        <View style={[styles.detailHeader, darkMode && styles.detailHeaderDark]}>
          <TouchableOpacity onPress={() => { closeMenu(); setMenuOpen(false); setInfoPage(null); }} style={styles.backButton}>
            <Text style={[styles.backText, darkMode && styles.headerIconDark]}>‹</Text>
          </TouchableOpacity>
          <Text style={[styles.detailHeaderTitle, darkMode && styles.darkText]} numberOfLines={1}>{infoTitles[infoPage]}</Text>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => setDarkMode(value => !value)}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>{darkMode ? '☀' : '☾'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={darkMode ? styles.detailListDark : undefined} contentContainerStyle={[styles.infoContent, darkMode && styles.detailContentDark]}>
          {bloggerInfoData ? (
            <RenderHTML
              ignoredDomTags={['iframe']}
              contentWidth={Math.max(320, width - 40)}
              source={{ html: bloggerInfoData.html }}
              tagsStyles={({
                p: { marginTop: 0, marginBottom: 8, lineHeight: 24, color: darkMode ? '#eeeeee' : '#4f4c52' },
                h1: { color: darkMode ? WHITE : TEXT, fontSize: 27, lineHeight: 35, fontWeight: '900', marginTop: 8, marginBottom: 8 },
                h2: { color: darkMode ? WHITE : TEXT, fontSize: 23, lineHeight: 31, fontWeight: '900', marginTop: 12, marginBottom: 7 },
                h3: { color: darkMode ? WHITE : TEXT, fontSize: 19, lineHeight: 27, fontWeight: '900', marginTop: 10, marginBottom: 6 },
                li: { color: darkMode ? '#eeeeee' : '#4f4c52', fontSize: 15, lineHeight: 24 },
                a: { color: ACCENT },
              } as any)}
            />
          ) : (
            <View style={styles.state}>
              <ActivityIndicator size="large" color={ACCENT} />
              <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>Loading page...</Text>
            </View>
          )}

          <View style={styles.footer}>
            <Text style={[styles.footerBrand, darkMode && styles.footerBrandDark]}>Offerhaikya</Text>
            <Text style={[styles.footerText, darkMode && styles.darkMutedText]}>Fresh offers. Simple browsing.</Text>
            <View style={styles.socialRow}>
              <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="Instagram">
                <View style={styles.instagramLogo}><View style={styles.instagramLens} /><View style={styles.instagramDot} /></View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="YouTube">
                <View style={styles.youtubeLogo}><View style={styles.youtubePlay} /></View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="Facebook">
                <Text style={styles.facebookLogo}>f</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="LinkedIn">
                <Text style={styles.linkedinLogo}>in</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="X">
                <Text style={styles.xLogo}>𝕏</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.footerLinks}>
              <TouchableOpacity onPress={() => openInfoPage('about')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>About Us</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => openInfoPage('contact')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>Contact Us</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => openInfoPage('privacy')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>Privacy Policy</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => openInfoPage('terms')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>Terms & Conditions</Text></TouchableOpacity>
            </View>
          </View>

        </ScrollView>

        <View style={[styles.bottomNav, darkMode && styles.bottomNavDark]}>
          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'request' && styles.bottomNavItemActive]}
            onPress={openOfferRequestTab}
            accessibilityLabel="Request offer"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 5.5H20V18.5H4V5.5Z"
                stroke={bottomTab === 'request' ? ACCENT : (darkMode ? WHITE : TEXT)}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <Path
                d="M4.5 6L12 12L19.5 6"
                stroke={bottomTab === 'request' ? ACCENT : (darkMode ? WHITE : TEXT)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text
              style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'request' && styles.bottomNavLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              Request Offer
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'hot' && styles.bottomNavItemActive]}
            onPress={goToHotOffersTab}
            accessibilityLabel="Hot Offers"
          >
            <Text style={[styles.bottomNavPercentIcon, darkMode && styles.bottomNavPercentIconDark, bottomTab === 'hot' && styles.bottomNavPercentIconActive]}>%</Text>
            <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'hot' && styles.bottomNavLabelActive]}>
              Hot Offers
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'home' && styles.bottomNavItemActive]}
            onPress={goToHomeTab}
            accessibilityLabel="Home"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M3 10.5L12 3L21 10.5V21H14.5V14H9.5V21H3V10.5Z"
                stroke={bottomTab === 'home' ? ACCENT : (darkMode ? WHITE : TEXT)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'home' && styles.bottomNavLabelActive]}>
              Home
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.bottomNavItem,
              bottomTabRef.current === 'local' && styles.bottomNavItemActive,
              localOffersDisabled && styles.bottomNavItemDisabled,
            ]}
            onPress={goToLocalOffersTab}
            accessibilityLabel="Nearby Offers"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5A8 8 0 1 1 20 10.5Z"
                stroke={localOffersDisabled ? '#b8b8b8' : bottomTabRef.current === 'local' ? ACCENT : (darkMode ? WHITE : TEXT)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M12 13.25A2.75 2.75 0 1 0 12 7.75A2.75 2.75 0 0 0 12 13.25Z"
                stroke={localOffersDisabled ? '#b8b8b8' : bottomTabRef.current === 'local' ? ACCENT : (darkMode ? WHITE : TEXT)}
                strokeWidth={2}
              />
            </Svg>
            <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTabRef.current === 'local' && styles.bottomNavLabelActive, localOffersDisabled && styles.bottomNavLabelDisabled]}>Nearby Offers</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'search' && styles.bottomNavItemActive]}
            onPress={goToSearchTab}
            accessibilityLabel="Search"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M11 18A7 7 0 1 0 11 4A7 7 0 0 0 11 18Z"
                stroke={bottomTab === 'search' ? ACCENT : (darkMode ? WHITE : TEXT)}
                strokeWidth={2}
              />
              <Path
                d="M16.5 16.5L21 21"
                stroke={bottomTab === 'search' ? ACCENT : (darkMode ? WHITE : TEXT)}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'search' && styles.bottomNavLabelActive]}>
              Search
            </Text>
          </TouchableOpacity>

        </View>
      </SafeAreaView>
    );
  }

  if (detail) {
    const mapCoordinates = extractMapCoordinates(detail.rawContent);
    const detailPostsSource = detailPagePosts.length > 0 ? detailPagePosts : posts;
    const suggestedDetailPosts = detailPostsSource
      .filter(post => post.id !== detail.id)
      .filter(post => post.labels.some(label => detail.labels.includes(label)))
      .slice(0, 4);
    const latestDetailPosts = detailPostsSource
      .filter(post => post.id !== detail.id)
      .slice(0, 8);
    return (
      <SafeAreaView style={[styles.safe, darkMode && styles.darkSafe]}>
        <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} backgroundColor={darkMode ? '#171717' : WHITE} />
        <View style={[styles.detailHeader, darkMode && styles.detailHeaderDark]}>
          <TouchableOpacity onPress={() => setDetail(null)} style={styles.backButton}>
            <Text style={[styles.backText, darkMode && styles.headerIconDark]}>‹</Text>
          </TouchableOpacity>
          <Text style={[styles.detailHeaderTitle, darkMode && styles.darkText]} numberOfLines={1}>{detail.title}</Text>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => setDarkMode(value => !value)}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>{darkMode ? '☀' : '☾'}</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          style={darkMode ? styles.detailListDark : undefined}
          data={[detail]}
          keyExtractor={item => item.id}
          renderItem={() => (
            <View style={[styles.detailContent, darkMode && styles.detailContentDark]}>
            <Text style={styles.detailLabel}>{detail.label}</Text>
            <Text style={[styles.detailTitle, darkMode && styles.darkText]}>{detail.title}</Text>
            <View style={styles.detailTitleRow}>
              <Text style={[styles.detailDate, darkMode && styles.darkMutedText]}>{detail.date}</Text>
              <View style={styles.detailActions}>
                <TouchableOpacity
                  style={styles.detailIconButton}
                  onPress={() => openShareOptions(detail.url)}
                  accessibilityLabel="Share post"
                >
                  <Image
                    source={{ uri: 'https://cdn-icons-png.flaticon.com/512/107/107784.png' }}
                    style={styles.detailShareIcon}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.detailIconButton}
                  onPress={() => toggleFavorite(detail)}
                  accessibilityLabel={isFavorite(detail) ? 'Remove favorite' : 'Add favorite'}
                >
                  <Text style={styles.detailHeartText}>
                    {isFavorite(detail) ? '♥' : '♡'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <RenderHTML
              ignoredDomTags={['iframe']}
              ignoredStyles={[
                'fontFamily',
                'fontSize',
                'lineHeight',
                'color',
                'fontWeight',
                'fontStyle',
                'textDecorationLine',
              ]}
              contentWidth={Math.max(320, width - 40)}
              source={{ html: detail.rawContent || `<p>${detail.content || detail.excerpt}</p>` }}
              baseStyle={({
                fontFamily: 'Rubik',
                fontSize: 15,
                lineHeight: 24,
                color: darkMode ? '#eeeeee' : '#4f4c52',
              } as any)}
              defaultTextProps={{ allowFontScaling: false }}
              tagsStyles={({
                p: {
                  fontFamily: 'Rubik',
                  fontSize: 15,
                  lineHeight: 24,
                  marginTop: 0,
                  marginBottom: 10,
                  color: darkMode ? '#eeeeee' : '#4f4c52',
                },
                h1: {
                  fontFamily: 'Rubik',
                  color: darkMode ? WHITE : TEXT,
                  fontSize: 27,
                  lineHeight: 35,
                  fontWeight: '900',
                  marginTop: 10,
                  marginBottom: 10,
                },
                h2: {
                  fontFamily: 'Rubik',
                  color: darkMode ? WHITE : TEXT,
                  fontSize: 23,
                  lineHeight: 31,
                  fontWeight: '900',
                  marginTop: 14,
                  marginBottom: 8,
                },
                h3: {
                  fontFamily: 'Rubik',
                  color: darkMode ? WHITE : TEXT,
                  fontSize: 19,
                  lineHeight: 27,
                  fontWeight: '800',
                  marginTop: 12,
                  marginBottom: 7,
                },
                li: {
                  fontFamily: 'Rubik',
                  color: darkMode ? '#eeeeee' : '#4f4c52',
                  fontSize: 15,
                  lineHeight: 24,
                  marginBottom: 4,
                },
                a: {
                  fontFamily: 'Rubik',
                  color: ACCENT,
                  fontSize: 15,
                },
                strong: {
                  fontFamily: 'Rubik',
                  fontWeight: '700',
                },
                em: {
                  fontFamily: 'Rubik',
                  fontStyle: 'italic',
                },
                img: {
                  marginTop: 5,
                  marginBottom: 5,
                },
                ul: { marginTop: 4, marginBottom: 10 },
                ol: { marginTop: 4, marginBottom: 10 },
                table: { width: '100%' },
                th: {
                  fontFamily: 'Rubik',
                  padding: 7,
                  fontSize: 15,
                  fontWeight: '700',
                },
                td: {
                  fontFamily: 'Rubik',
                  padding: 7,
                  fontSize: 15,
                },
              } as any)}
            />
            <NativeAdCard />

            {mapCoordinates ? (
              <View style={styles.mapSection}>
                <Text style={[styles.mapTitle, darkMode && styles.darkText]}>Location</Text>
                <TouchableOpacity
                  style={styles.mapButton}
                  onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${mapCoordinates.latitude},${mapCoordinates.longitude}`)}
                >
                  <Text style={styles.mapButtonText}>Open in Google Maps</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.infoBottomRecommendations}>
              <View style={styles.infoRecommendationSection}>
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Suggested Posts</Text>
                  <Text style={[styles.pageText, darkMode && styles.darkMutedText]}>For you</Text>
                </View>

                {detailPagePostsLoading && detailPostsSource.length === 0 ? (
                  <View style={styles.state}>
                    <ActivityIndicator size="small" color={ACCENT} />
                    <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>Loading suggested posts...</Text>
                  </View>
                ) : suggestedDetailPosts.length > 0 ? (
                  <View>
                    {Array.from({ length: Math.ceil(suggestedDetailPosts.length / 2) }).map((_, rowIndex) => (
                      <View style={styles.row} key={'detail-suggested-row-' + rowIndex}>
                        {suggestedDetailPosts.slice(rowIndex * 2, rowIndex * 2 + 2).map(item => renderPost({ item }))}
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.state}>
                    <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>No suggested posts available right now.</Text>
                  </View>
                )}
              </View>

              <TestBannerAd />

              <View style={styles.infoRecommendationSection}>
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Latest Posts</Text>
                  <Text style={[styles.pageText, darkMode && styles.darkMutedText]}>Latest</Text>
                </View>

                {detailPagePostsLoading && detailPostsSource.length === 0 ? (
                  <View style={styles.state}>
                    <ActivityIndicator size="small" color={ACCENT} />
                    <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>Loading latest posts...</Text>
                  </View>
                ) : latestDetailPosts.length > 0 ? (
                  <View>
                    {Array.from({ length: Math.ceil(latestDetailPosts.length / 2) }).map((_, rowIndex) => (
                      <View style={styles.row} key={'detail-latest-row-' + rowIndex}>
                        {latestDetailPosts.slice(rowIndex * 2, rowIndex * 2 + 2).map(item => renderPost({ item }))}
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.state}>
                    <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>No latest posts available right now.</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 24 }}
        />
        <Modal
          visible={sharePostUrl !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setSharePostUrl(null)}
        >
          <View style={styles.shareOverlay}>
            <TouchableOpacity
              style={styles.shareBackdrop}
              activeOpacity={1}
              onPress={() => setSharePostUrl(null)}
            />
            <View style={[styles.sharePopup, darkMode && styles.favoritePopupDark]}>
              <Text style={[styles.sharePopupTitle, darkMode && styles.darkText]}>Share Offer</Text>

              <TouchableOpacity style={styles.shareOption} onPress={sharePost}>
                <Text style={[styles.shareOptionTitle, darkMode && styles.darkText]}>Share with</Text>
                <Text style={[styles.shareOptionText, darkMode && styles.darkMutedText]}>
                  WhatsApp, Instagram, Facebook & Other Apps
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareOption}
                onPress={() => {
                  if (sharePostUrl) copyPostLink(sharePostUrl);
                  setSharePostUrl(null);
                }}
              >
                <Text style={[styles.shareOptionTitle, darkMode && styles.darkText]}>Click to Copy Link</Text>
                <Text style={[styles.shareOptionText, darkMode && styles.darkMutedText]}>
                  The OfferHaikya post link
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shareCancelButton}
                onPress={() => setSharePostUrl(null)}
              >
                <Text style={styles.shareCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <View style={[styles.bottomNav, darkMode && styles.bottomNavDark]}>
          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'request' && styles.bottomNavItemActive]}
            onPress={openOfferRequestTab}
            accessibilityLabel="Request offer"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 5.5H20V18.5H4V5.5Z"
                stroke={bottomTab === 'request' ? ACCENT : TEXT}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <Path
                d="M4.5 6L12 12L19.5 6"
                stroke={bottomTab === 'request' ? ACCENT : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text
              style={[styles.bottomNavLabel, bottomTab === 'request' && styles.bottomNavLabelActive, darkMode && styles.bottomNavLabelDark]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              Request Offer
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.infoBottomNavItem}
            onPress={goToHotOffersTab}
            accessibilityLabel="Hot Offers"
          >
            <Text style={styles.infoBottomNavPercentIcon}>%</Text>
            <Text style={styles.infoBottomNavLabel}>Hot Offers</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'home' && styles.bottomNavItemActive]}
            onPress={goToHomeTab}
            accessibilityLabel="Home"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M3 10.5L12 3L21 10.5V21H14.5V14H9.5V21H3V10.5Z"
                stroke={bottomTab === 'home' ? ACCENT : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={[styles.bottomNavLabel, bottomTab === 'home' && styles.bottomNavLabelActive, darkMode && styles.bottomNavLabelDark]}>
              Home
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'search' && styles.bottomNavItemActive]}
            onPress={goToSearchTab}
            accessibilityLabel="Search"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M11 18A7 7 0 1 0 11 4A7 7 0 0 0 11 18Z"
                stroke={bottomTab === 'search' ? ACCENT : TEXT}
                strokeWidth={2}
              />
              <Path
                d="M16.5 16.5L21 21"
                stroke={bottomTab === 'search' ? ACCENT : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            <Text style={[styles.bottomNavLabel, bottomTab === 'search' && styles.bottomNavLabelActive, darkMode && styles.bottomNavLabelDark]}>
              Search
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.bottomNavItem,
              bottomTabRef.current === 'local' && styles.bottomNavItemActive,
              localOffersDisabled && styles.bottomNavItemDisabled,
            ]}
            onPress={goToLocalOffersTab}
            accessibilityLabel="Nearby"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5A8 8 0 1 1 20 10.5Z"
                stroke={localOffersDisabled ? '#b8b8b8' : bottomTabRef.current === 'local' ? ACCENT : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M12 13.25A2.75 2.75 0 1 0 12 7.75A2.75 2.75 0 0 0 12 13.25Z"
                stroke={localOffersDisabled ? '#b8b8b8' : bottomTabRef.current === 'local' ? ACCENT : TEXT}
                strokeWidth={2}
              />
            </Svg>
            <Text style={[styles.bottomNavLabel, bottomTabRef.current === 'local' && styles.bottomNavLabelActive, localOffersDisabled && styles.bottomNavLabelDisabled, darkMode && styles.bottomNavLabelDark]}>Nearby</Text>
          </TouchableOpacity>

        </View>
      </SafeAreaView>
    );
  }


  if (startupPreloader || !accountStateLoaded) {
    const startupProgressWidth = startupPreloaderProgress.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    });

    return (
      <View style={styles.startupPreloader}>
          <Image
          source={{ uri: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Offer.gif' }}
          style={styles.startupPreloaderGif}
          resizeMode="contain"
        />
        <View style={styles.startupPreloaderProgressTrack}>
          <Animated.View
            style={[
              styles.startupPreloaderProgressFill,
              { width: startupProgressWidth },
            ]}
          />
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, darkMode && styles.darkSafe]}>
      {authReady && registrationOpen && (
        <View style={styles.registrationOverlay}>
          <View style={styles.registrationPopup}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.registrationFormContent}
            >
              <View style={styles.registrationHeaderRow}>
                <Text style={styles.registrationTitle}>
                  {profileMode
                    ? 'My Profile'
                    : authMode === 'signIn'
                      ? 'Login'
                      : 'Welcome to Offerhaikya 👋'}
                </Text>

                {(profileMode || authMode === 'signIn') ? (
                  <TouchableOpacity
                    style={styles.registrationCloseButton}
                    onPress={() => {
                      if (!registrationSubmitting) {
                        setRegistrationOpen(false);
                        setRegistrationCategoriesOpen(false);
                        setRegistrationError('');
                        setRegistrationSuccess('');
                      }
                    }}
                    disabled={registrationSubmitting}
                    accessibilityLabel="Close"
                  >
                    <Text style={styles.registrationCloseText}>×</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={styles.registrationSubtitle}>
                {profileMode
                  ? 'Update your details and interests anytime.'
                  : authMode === 'signIn'
                    ? 'Sign in to continue with your saved profile.'
                    : 'Enter your details and choose your interests.'}
              </Text>

              {profileLoading ? (
                <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={ACCENT} />
                </View>
              ) : null}

              {authMode === 'signIn' && !profileMode ? null : (
                <>
                  <TextInput
                    value={registrationName}
                    onChangeText={value => {
                      const next = value.replace(/[^A-Za-z ]/g, '').slice(0, 12);
                      registrationNameRef.current = next;
                      setRegistrationName(next);
                    }}
                    placeholder="Name *"
                    placeholderTextColor="#99969c"
                    style={styles.registrationInput}
                    autoCapitalize="words"
                    maxLength={12}
                    editable={!registrationSubmitting && !profileLoading}
                  />

                  <View style={styles.phoneInputWrap}>
                    <Text style={styles.phonePrefix}>+91</Text>
                    <TextInput
                      value={registrationContact}
                      onChangeText={value => {
                        const next = value.replace(/\D/g, '').slice(0, 10);
                        registrationContactRef.current = next;
                        setRegistrationContact(next);
                      }}
                      placeholder="Phone number *"
                      placeholderTextColor="#99969c"
                      style={styles.phoneInput}
                      keyboardType="phone-pad"
                      maxLength={10}
                      editable={!registrationSubmitting && !profileLoading}
                    />
                  </View>
                </>
              )}

              <TextInput
                value={registrationEmail}
                onChangeText={value => {
                  const next = value.slice(0, 80);
                  registrationEmailRef.current = next;
                  setRegistrationEmail(next);
                }}
                placeholder="Email ID *"
                placeholderTextColor="#99969c"
                style={styles.registrationInput}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={80}
                editable={!registrationSubmitting && !profileLoading}
              />

              {!profileMode ? (
                <View style={styles.passwordInputWrap}>
                  <TextInput
                    value={registrationPassword}
                    onChangeText={value => {
                      registrationPasswordRef.current = value;
                      setRegistrationPassword(value);
                    }}
                    placeholder="Password *"
                    placeholderTextColor="#99969c"
                    style={styles.passwordInput}
                    secureTextEntry={!registrationPasswordVisible}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!registrationSubmitting && !profileLoading}
                  />
                  <TouchableOpacity
                    style={styles.passwordEyeButton}
                    onPress={() => setRegistrationPasswordVisible(value => !value)}
                    disabled={registrationSubmitting}
                  >
                    <Text style={styles.passwordEyeText}>
                      {registrationPasswordVisible ? 'Hide' : 'Show'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {authMode === 'register' || profileMode ? (
                <>
                  <TextInput
                    value={registrationAreaCity}
                    onChangeText={value => {
                      const next = value.slice(0, 80);
                      registrationAreaCityRef.current = next;
                      setRegistrationAreaCity(next);
                    }}
                    placeholder="Area / City"
                    placeholderTextColor="#99969c"
                    style={styles.registrationInput}
                    maxLength={80}
                    editable={!registrationSubmitting && !profileLoading}
                  />

                  <Text style={styles.registrationCategoryTitle}>Interested Categories *</Text>
                  <TouchableOpacity
                    style={styles.registrationCategoryDropdown}
                    onPress={() => setRegistrationCategoriesOpen(value => !value)}
                    disabled={registrationSubmitting}
                    accessibilityLabel="Interested categories"
                  >
                    <Text
                      style={[
                        styles.registrationCategoryDropdownText,
                        registrationCategories.length > 0 && styles.registrationCategoryDropdownTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {registrationCategories.length > 0
                        ? `${registrationCategories.length} selected: ${registrationCategories.slice(0, 2).join(', ')}${registrationCategories.length > 2 ? ', …' : ''}`
                        : 'Select interested categories'}
                    </Text>
                    <Text style={styles.registrationCategoryDropdownArrow}>
                      {registrationCategoriesOpen ? '⌃' : '⌄'}
                    </Text>
                  </TouchableOpacity>

                  {registrationCategoriesOpen ? (
                    <View style={styles.registrationCategoryDropdownMenu}>
                      <ScrollView
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                        style={styles.registrationCategoryDropdownScroll}
                      >
                        {(bloggerCategories.length > 0 ? bloggerCategories : CATEGORY_ITEMS).map(category => {
                          const selected = registrationCategories.includes(category);
                          return (
                            <TouchableOpacity
                              key={category}
                              style={styles.registrationCategoryDropdownItem}
                              onPress={() => {
                                setRegistrationCategories(current => {
                                  const next = selected
                                    ? current.filter(item => item !== category)
                                    : [...current, category];
                                  registrationCategoriesRef.current = next;
                                  return next;
                                });
                              }}
                              disabled={registrationSubmitting}
                            >
                              <View
                                style={[
                                  styles.registrationCategoryCheckbox,
                                  selected && styles.registrationCategoryCheckboxSelected,
                                ]}
                              >
                                {selected ? <Text style={styles.registrationCategoryCheck}>✓</Text> : null}
                              </View>
                              <Text
                                style={[
                                  styles.registrationCategoryDropdownItemText,
                                  selected && styles.registrationCategoryDropdownItemTextSelected,
                                ]}
                                numberOfLines={1}
                              >
                                {category}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </>
              ) : null}

              
              {!profileMode ? (
                <>
                  {registrationError ? <Text style={styles.registrationError}>{registrationError}</Text> : null}
                  {registrationSuccess ? <Text style={styles.registrationSuccess}>{registrationSuccess}</Text> : null}

                  <TouchableOpacity
                    style={[styles.registrationButton, registrationSubmitting && styles.disabledButton]}
                    onPress={authMode === 'signIn' ? signInAccount : submitRegistration}
                    disabled={registrationSubmitting || !!registrationSuccess || profileLoading}
                  >
                    {registrationSubmitting ? (
                      <ActivityIndicator size="small" color={WHITE} />
                    ) : (
                      <Text style={styles.registrationButtonText}>
                        {authMode === 'signIn' ? 'Submit' : 'Create Account'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <View style={styles.registrationSecondaryRow}>
                    <TouchableOpacity
                      style={styles.registrationSecondaryHalfButton}
                      onPress={() => {
                        if (ADD_OFFERS_WHATSAPP_URL) {
                          void Linking.openURL(ADD_OFFERS_WHATSAPP_URL);
                        } else {
                          Alert.alert('Add Offers', 'WhatsApp link will be added soon.');
                        }
                      }}
                      disabled={registrationSubmitting || profileLoading}
                    >
                      <Text style={styles.registrationLinkText}>Add Offers</Text>
                    </TouchableOpacity>

                    <Text style={styles.registrationLinkSeparator}>|</Text>

                    <TouchableOpacity
                      style={styles.registrationSecondaryHalfButton}
                      onPress={skipRegistration}
                      disabled={registrationSubmitting || profileLoading}
                    >
                      <Text style={styles.registrationLinkText}>Browse Offers</Text>
                    </TouchableOpacity>

                    <Text style={styles.registrationLinkSeparator}>|</Text>

                    <TouchableOpacity
                      style={styles.registrationSecondaryHalfButton}
                      onPress={() => {
                        if (authMode === 'signIn') {
                          openWelcomeRegistration();
                        } else {
                          setAuthMode('signIn');
                          setRegistrationPassword('');
                          setRegistrationPasswordVisible(false);
                          setRegistrationError('');
                          setRegistrationSuccess('');
                          setRegistrationName('');
                          setRegistrationContact('');
                          setRegistrationAreaCity('');
                          setRegistrationCategories([]);
                          registrationNameRef.current = '';
                          registrationContactRef.current = '';
                          registrationAreaCityRef.current = '';
                          registrationCategoriesRef.current = [];
                        }
                      }}
                      disabled={registrationSubmitting || profileLoading}
                    >
                      <Text style={styles.registrationLinkText}>
                        {authMode === 'signIn' ? 'Signup' : 'Login'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {authMode === 'signIn' ? (
                    <TouchableOpacity
                      style={styles.profileActionTextButton}
                      onPress={forgotPassword}
                      disabled={registrationSubmitting}
                    >
                      <Text style={styles.profileActionText}>Forgot Password?</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : (
                <>
                  {registrationError ? <Text style={styles.registrationError}>{registrationError}</Text> : null}
                  {registrationSuccess ? <Text style={styles.registrationSuccess}>{registrationSuccess}</Text> : null}

                  <TouchableOpacity
                    style={[styles.profileUpdateButton, registrationSubmitting && styles.disabledButton]}
                    onPress={saveProfile}
                    disabled={registrationSubmitting || !!registrationSuccess || profileLoading}
                  >
                    {registrationSubmitting ? (
                      <ActivityIndicator size="small" color={WHITE} />
                    ) : (
                      <Text style={styles.profileUpdateButtonText}>Update</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.profileCloseButton, registrationSubmitting && styles.disabledButton]}
                    onPress={() => {
                      if (!registrationSubmitting) {
                        setRegistrationOpen(false);
                        setProfileMode(false);
                        setRegistrationError('');
                        setRegistrationSuccess('');
                      }
                    }}
                    disabled={registrationSubmitting}
                  >
                    <Text style={styles.profileCloseButtonText}>Close</Text>
                  </TouchableOpacity>

                  <View style={styles.profileLinkRow}>
                    <TouchableOpacity
                      style={styles.profileLinkItem}
                      onPress={deleteProfile}
                      disabled={registrationSubmitting}
                    >
                      <Text style={styles.profileLinkDeleteText}>Delete</Text>
                    </TouchableOpacity>

                    <Text style={styles.profileLinkSeparator}>|</Text>

                    <TouchableOpacity
                      style={styles.profileLinkItem}
                      onPress={forgotPassword}
                      disabled={registrationSubmitting}
                    >
                      <Text style={styles.profileLinkText}>Forgot Password?</Text>
                    </TouchableOpacity>

                    <Text style={styles.profileLinkSeparator}>|</Text>

                    <TouchableOpacity
                      style={styles.profileLinkItem}
                      onPress={logoutAccount}
                      disabled={registrationSubmitting}
                    >
                      <Text style={styles.profileLinkText}>Logout</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      )}


      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} backgroundColor={darkMode ? '#000000' : WHITE} />

      <View style={[styles.header, darkMode && styles.headerDark]}>
        <TouchableOpacity style={styles.headerIconButton} onPress={() => menuOpen ? closeMenu() : openMenu()}>
          <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>☰</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={() => {
            closeMenu();
            setInfoPage(null);
            setDetail(null);
            setActiveLabel('All');
            setQuery('');
            setSuggestions([]);
            resetMainFeedToFirstPage();
          }}
          accessibilityLabel="Go to home"
        >
          <Image
            source={{ uri: darkMode && bloggerDarkLogoUri ? bloggerDarkLogoUri : 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png' }}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerActionButton} onPress={() => setDarkMode(value => !value)}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>{darkMode ? '☀' : '☾'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.headerActionButton} onPress={() => setWishlistOpen(true)}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>♡</Text>
            {favorites.length > 0 ? (
              <View style={styles.favoriteBadge}>
                <Text style={styles.favoriteBadgeText}>{favorites.length}</Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={() => searchInputRef.current?.focus()}
            accessibilityLabel="Search"
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path
                d="M11 18A7 7 0 1 0 11 4A7 7 0 0 0 11 18Z"
                stroke={darkMode ? WHITE : TEXT}
                strokeWidth={2}
              />
              <Path
                d="M16.5 16.5L21 21"
                stroke={darkMode ? WHITE : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={() => setNotificationsOpen(true)}
            accessibilityLabel="Notifications"
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path
                d="M18 9A6 6 0 0 0 6 9C6 16 3.5 16 3.5 18H20.5C20.5 16 18 16 18 9Z"
                stroke={darkMode ? WHITE : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M10 21H14"
                stroke={darkMode ? WHITE : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            {notifications.length > 0 ? (
              <View style={styles.favoriteBadge}>
                <Text style={styles.favoriteBadgeText}>{notifications.length >= 100 ? '99+' : notifications.length}</Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={openProfile}
            accessibilityLabel="Profile"
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 11.5A4 4 0 1 0 12 3.5A4 4 0 0 0 12 11.5Z"
                stroke={darkMode ? WHITE : TEXT}
                strokeWidth={2}
              />
              <Path
                d="M4.5 21A7.5 7.5 0 0 1 19.5 21"
                stroke={darkMode ? WHITE : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      {menuOpen && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={closeMenu} />
          <Animated.View style={[styles.menuPanel, { transform: [{ translateX: menuAnim }] }]}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Menu</Text>
              <TouchableOpacity style={styles.menuCloseButton} onPress={closeMenu}>
                <Text style={styles.menuCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuList}>
              <TouchableOpacity
                style={styles.menuMainItem}
                onPress={() => setMenuCategoriesOpen(value => !value)}
              >
                <Text style={styles.menuMainItemText}>Categories</Text>
                <Text style={styles.menuMainArrow}>{menuCategoriesOpen ? '⌃' : '›'}</Text>
              </TouchableOpacity>
              {menuCategoriesOpen ? (
                <View style={styles.menuSubList}>
                  {(bloggerMenuCategories.length > 0 ? bloggerMenuCategories : bloggerCategories.length > 0 ? bloggerCategories : CATEGORY_ITEMS).map(label => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.menuSubItem, activeLabel === label && styles.menuItemActiveBg]}
                      onPress={() => {
                        tagPageStartPageRef.current = 1;
                        tagPagePageRef.current = 1;
                        setTagPage(label);
                        setActiveLabel(label);
                        setQuery('');
                        setSuggestions([]);
                        setTagPageDropdownOpen(false);
                        closeMenu();
                      }}
                    >
                      <Text style={[styles.menuSubItemText, activeLabel === label && styles.menuItemActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.menuMainItem}
                onPress={() => setMenuStoresOpen(value => !value)}
              >
                <Text style={styles.menuMainItemText}>Stores</Text>
                <Text style={styles.menuMainArrow}>{menuStoresOpen ? '⌃' : '›'}</Text>
              </TouchableOpacity>
              {menuStoresOpen ? (
                <View style={styles.menuSubList}>
                  {(bloggerCategories.filter(label => /store/i.test(label) && !/^stores?$/i.test(label)).length > 0
                    ? bloggerCategories.filter(label => /store/i.test(label) && !/^stores?$/i.test(label))
                    : ['Belagavi Store', 'Goa Store']).map(label => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.menuSubItem, activeLabel === label && styles.menuItemActiveBg]}
                      onPress={() => {
                        tagPageStartPageRef.current = 1;
                        tagPagePageRef.current = 1;
                        setTagPage(label);
                        setActiveLabel(label);
                        setQuery('');
                        setSuggestions([]);
                        setTagPageDropdownOpen(false);
                        closeMenu();
                      }}
                    >
                      <Text style={[styles.menuSubItemText, activeLabel === label && styles.menuItemActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.menuMainItem}
                onPress={() => setMenuSpecialDealsOpen(value => !value)}
              >
                <Text style={styles.menuMainItemText}>Special Deal Categories</Text>
                <Text style={styles.menuMainArrow}>{menuSpecialDealsOpen ? '⌃' : '›'}</Text>
              </TouchableOpacity>
              {menuSpecialDealsOpen ? (
                <View style={styles.menuSubList}>
                  {(bloggerMenuSpecialDeals.length > 0 ? bloggerMenuSpecialDeals : SPECIAL_DEAL_ITEMS).map(label => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.menuSubItem, activeLabel === label && styles.menuItemActiveBg]}
                      onPress={() => {
                        tagPageStartPageRef.current = 1;
                        tagPagePageRef.current = 1;
                        setTagPage(label);
                        setActiveLabel(label);
                        setQuery('');
                        setSuggestions([]);
                        setTagPageDropdownOpen(false);
                        closeMenu();
                      }}
                    >
                      <Text style={[styles.menuSubItemText, activeLabel === label && styles.menuItemActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

            </ScrollView>
          </Animated.View>
        </View>
      )}

      {tagPage ? (
        <View style={darkMode ? styles.darkPage : styles.pageWrap}>
          <FlatList<Post[]>
            data={tagPageRows}
            keyExtractor={(row, index) => row[0]?.id || 'tag-row-' + index}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, darkMode && styles.contentDark]}
            renderItem={({ item: row, index: rowIndex }) => (
              <>
                <View style={styles.row}>
                  {row.map(item => renderPost({ item }))}
                </View>
                {(rowIndex + 1) % 3 === 0 ? <NativeAdCard /> : null}
              </>
            )}
            ListHeaderComponent={
              <>
                <View style={styles.tagStrip}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chips}
                    scrollEventThrottle={16}
                  >
                    {(bloggerTags.length > 0 ? bloggerTags : DIRECT_TAGS).map((item, index) => (
                      <TouchableOpacity
                        key={'tag-page-' + item + '-' + index}
                        onPress={() => {
                          setTagPageDropdownOpen(false);
                          if (item === 'All') {
                            tagPageStartPageRef.current = 1;
                            tagPagePageRef.current = 1;
                            setTagPage(null);
                            setActiveLabel('All');
                            setQuery('');
                            setSuggestions([]);
                            loadPosts('', 1);
                            return;
                          }
                          tagPageStartPageRef.current = 1;
                          tagPagePageRef.current = 1;
                          setTagPage(item);
                          setActiveLabel(item);
                          setQuery('');
                          setSuggestions([]);
                        }}
                        style={[styles.chip, activeLabel === item && styles.activeChip]}
                      >
                        <Text style={styles.chipText}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <ImageBackground
                  source={{ uri: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/5e10e76c-d5d4-40e6-9033-bf9720055ddf.jpg' }}
                  style={styles.hero}
                  imageStyle={styles.heroImage}
                >
                  <Text style={styles.heroSmall}>LATEST DEALS & OFFERS</Text>
                  <Text style={styles.heroTitle}>Find the best offers</Text>
                  <Text style={styles.heroSubtitle}>
                    {registrationCompleted && authUserKey ? `Welcome, ${registrationName.trim() || auth.currentUser?.displayName?.trim() || 'User'}` : 'Welcome Guest'}
                  </Text>
                  <View style={styles.searchBox}>
                    <Text style={styles.searchIcon}>⌕</Text>
                    <TextInput
                      ref={searchInputRef}
                      value={query}
                      onChangeText={text => setQuery(text)}
                      placeholder="Search offers..."
                      placeholderTextColor="#99969c"
                      style={styles.searchInput}
                      returnKeyType="search"
                      onSubmitEditing={() => {
                        const text = query.trim();
                        if (!text) return;
                        // Main-page-style live search suggestions remain visible
                        // while typing; submit/GO shows ranked title-first results.
                        setSuggestions([]);
                        void searchTagPage(text);
                      }}
                    />
                    {query.trim() && (
                      <View style={styles.searchDropdown}>
                        {suggestionLoading ? (
                          <View style={styles.searchDropdownLoading}>
                            <ActivityIndicator size="small" color={ACCENT} />
                          </View>
                        ) : suggestions.length > 0 ? (
                          <ScrollView style={styles.searchSuggestionScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                            {suggestions.map(item => (
                              <TouchableOpacity
                                key={'tag-search-suggestion-' + item.id}
                                style={styles.searchSuggestion}
                                onPress={() => {
                                  setSuggestions([]);
                                  setQuery('');
                                  setDetail(item);
                                }}
                              >
                                {item.image ? <Image source={{ uri: item.image }} style={styles.searchSuggestionImage} /> : null}
                                <View style={styles.searchSuggestionTextWrap}>
                                  <Text style={styles.searchSuggestionTitle} numberOfLines={2}>{item.title}</Text>
                                  <Text style={styles.searchSuggestionLabel} numberOfLines={1}>{item.label}</Text>
                                </View>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        ) : (
                          <Text style={styles.searchNoResult}>No matching offers</Text>
                        )}
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.searchButton}
                      onPress={() => {
                        const text = query.trim();
                        if (!text) return;
                        setSuggestions([]);
                        void searchTagPage(text);
                      }}
                    >
                      {searching ? <ActivityIndicator size="small" color={WHITE} /> : <Text style={styles.searchButtonText}>GO</Text>}
                    </TouchableOpacity>
                  </View>
                </ImageBackground>
                <View style={[styles.tagPageHeader, { justifyContent: 'space-between' }]}>
                  <TouchableOpacity
                    style={styles.tagPageDropdownButton}
                    onPress={() => {
                      tagPageStartPageRef.current = 1;
                      tagPagePageRef.current = 1;
                      setTagPage(null);
                      setQuery('');
                      setSuggestions([]);
                      setActiveLabel('All');
                      setTagPageDropdownOpen(false);
                    }}
                  >
                    <Text style={[styles.tagPageDropdownText, darkMode && styles.darkText]}>‹ Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.tagPageDropdownButton}
                    onPress={() => setTagPageDropdownOpen(value => !value)}
                  >
                    <Text style={[styles.tagPageDropdownText, darkMode && styles.darkText]} numberOfLines={1}>
                      Tags - {tagPage === ALL_POSTS_TAG ? 'All Posts' : (tagPage || 'All')}
                    </Text>
                    <Text style={[styles.tagPageDropdownArrow, darkMode && styles.darkText]}>
                      {tagPageDropdownOpen ? '▴' : '▾'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {tagPageDropdownOpen ? (
                  <View style={[styles.tagPageDropdownMenu, darkMode && styles.tagPageDropdownMenuDark]}>
                    <ScrollView
                      style={styles.tagPageDropdownScroll}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={false}
                    >
                      {(bloggerTags.length > 0 ? bloggerTags : DIRECT_TAGS).map(item => (
                        <TouchableOpacity
                          key={'dropdown-' + item}
                          style={[
                            styles.tagPageDropdownItem,
                            activeLabel === item && styles.tagPageDropdownItemActive,
                            darkMode && styles.tagPageDropdownItemDark,
                          ]}
                          onPress={() => {
                            setTagPageDropdownOpen(false);
                            if (item === 'All') {
                              setTagPage(null);
                              setActiveLabel('All');
                              setQuery('');
                              setSuggestions([]);
                              loadPosts('', 1);
                              return;
                            }
                            tagPageStartPageRef.current = 1;
                          tagPagePageRef.current = 1;
                          setTagPage(item);
                            setActiveLabel(item);
                            setQuery('');
                            setSuggestions([]);
                          }}
                        >
                          <Text
                            style={[
                              styles.tagPageDropdownItemText,
                              activeLabel === item && styles.tagPageDropdownItemTextActive,
                              darkMode && styles.darkText,
                            ]}
                          >
                            {item}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
                {tagPageLoading ? (
                  <View style={styles.tagPageLoading}>
                    <ActivityIndicator size="small" color={ACCENT} />
                  </View>
                ) : null}
              </>
            }
            ListEmptyComponent={
              tagPageLoading ? null : (
                <View style={styles.state}>
                  <Text style={[styles.errorTitle, darkMode && styles.darkText]}>No offers found</Text>
                  <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>{tagPage === ALL_POSTS_TAG ? 'No offers are currently available.' : `No posts are currently tagged with #${tagPage}.`}</Text>
                </View>
              )
            }
            ListFooterComponent={
              tagPagePosts.length > 0 && tagPageHasMore ? (
                <View style={styles.loadMoreWrap}>
                  <TouchableOpacity
                    style={styles.loadMoreButton}
                    onPress={loadMoreTagPosts}
                    disabled={tagPageLoadingMore}
                  >
                    {tagPageLoadingMore ? (
                      <ActivityIndicator size="small" color={WHITE} />
                    ) : (
                      <Text style={styles.loadMoreButtonText}>Load More Offers</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null
            }
          />
        </View>
      ) : (
<View style={darkMode ? styles.darkPage : styles.pageWrap}>
        <View style={styles.tagStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            scrollEventThrottle={16}
          >
            {(bloggerTags.length > 0 ? bloggerTags : DIRECT_TAGS).map((item, index) => (
              <TouchableOpacity
                key={item + '-' + index}
                onPress={() => {
                  if (item === 'All') {
                    setTagPage(null);
                    setActiveLabel('All');
                    setQuery('');
                    setSuggestions([]);
                    loadPosts('', 1);
                    return;
                  }
                  tagPageStartPageRef.current = 1;
                          tagPagePageRef.current = 1;
                          setTagPage(item);
                  setActiveLabel(item);
                  setQuery('');
                  setSuggestions([]);
                }}
                style={[styles.chip, activeLabel === item && styles.activeChip]}
              >
                <Text style={styles.chipText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

      <FlatList<Post[]>
        ref={mainListRef}
        style={darkMode ? styles.listDark : undefined}
        extraData={darkMode}
        data={sortedMainPostRows}
        keyExtractor={(row, index) => row[0]?.id || `main-row-${index}`}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        removeClippedSubviews={Platform.OS === 'android'}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        updateCellsBatchingPeriod={40}
        windowSize={7}
        renderItem={({ item: row, index: rowIndex }) => (
          <>
            <View style={styles.row}>
              {row.map(item => renderPost({ item }))}
            </View>
            {(rowIndex + 1) % 3 === 0 ? <NativeAdCard /> : null}
          </>
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, darkMode && styles.contentDark]}
        ListHeaderComponentStyle={darkMode ? styles.contentDark : undefined}        ListHeaderComponent={
          <>
            <ImageBackground
              source={{ uri: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/5e10e76c-d5d4-40e6-9033-bf9720055ddf.jpg' }}
              style={styles.hero}
              imageStyle={styles.heroImage}
            >
              <Text style={styles.heroSmall}>LATEST DEALS & OFFERS</Text>
              <Text style={styles.heroTitle}>Find the best offers</Text>
              <Text style={styles.heroSubtitle}>
                {registrationCompleted && authUserKey ? `Welcome, ${registrationName.trim() || auth.currentUser?.displayName?.trim() || 'User'}` : 'Welcome Guest'}
              </Text>
              <View style={styles.searchBox}>
                <Text style={styles.searchIcon}>⌕</Text>
                <TextInput
                  ref={searchInputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search offers..."
                  placeholderTextColor="#99969c"
                  style={styles.searchInput}
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    const text = query.trim();
                    if (!text) return;
                    loadPosts(text, 1);
                    setSuggestions([]);
                  }}
                />
                <TouchableOpacity style={styles.searchButton} onPress={() => { loadPosts(query.trim(), 1); setSuggestions([]); }}>
                  {searching ? <ActivityIndicator size="small" color={WHITE} /> : <Text style={styles.searchButtonText}>GO</Text>}
                </TouchableOpacity>
              </View>
              {query.trim().length > 0 && (
                <View style={styles.searchDropdown}>
                  {suggestionLoading ? (
                    <View style={styles.searchDropdownLoading}><ActivityIndicator size="small" color={ACCENT} /></View>
                  ) : suggestions.length > 0 ? (
                    <ScrollView
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={suggestions.length > 3}
                      style={styles.searchSuggestionScroll}
                      keyboardShouldPersistTaps="handled"
                    >
                      {suggestions.map(item => (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.searchSuggestion}
                          onPress={() => {
                            setSuggestions([]);
                            setDetail(item);
                          }}
                        >
                          {item.image ? <Image source={{ uri: item.image }} style={styles.searchSuggestionImage} /> : null}
                          <View style={styles.searchSuggestionTextWrap}>
                            <Text style={styles.searchSuggestionTitle} numberOfLines={2}>{item.title}</Text>
                            <Text style={styles.searchSuggestionLabel} numberOfLines={1}>{item.label}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={styles.searchNoResult}>No matching offers</Text>
                  )}
                </View>
              )}
            </ImageBackground>



            {nearbyPosts.length > 0 ? (
              <>
                <View
                  style={styles.sectionRow}
                  onLayout={event => {
                    nearbySectionOffsetRef.current = event.nativeEvent.layout.y;
                  }}
                >
                  <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>
                    Nearby Offers · {locationLabel || 'Your Area'} · Total {nearbyPosts.length >= 100 ? '99+' : nearbyPosts.length}
                  </Text>
                  <View style={{ position: 'relative' }}>
                    <TouchableOpacity
                      style={[styles.sortButton, darkMode && styles.sortButtonDark]}
                      onPress={() => {
                        setNearbySortOpen(value => !value);
                        setLatestSortOpen(false);
                      }}
                    >
                      <Text style={[styles.sortButtonText, darkMode && styles.darkText]}>
                        Sort: {nearbySort === 'distance' ? 'Near to Far' : nearbySort === 'oldest' ? 'Old to New' : 'New to Old'} ▾
                      </Text>
                    </TouchableOpacity>
                    {nearbySortOpen ? (
                      <View style={[styles.sortMenu, darkMode && styles.sortMenuDark]}>
                        {[
                          ['distance', 'Near to Far'],
                          ['oldest', 'Old to New'],
                          ['newest', 'New to Old'],
                        ].map(([value, label]) => (
                          <TouchableOpacity
                            key={value}
                            style={styles.sortMenuItem}
                            onPress={() => {
                              setNearbySort(value as 'distance' | 'oldest' | 'newest');
                              setNearbySortOpen(false);
                            }}
                          >
                            <Text style={[styles.sortMenuItemText, nearbySort === value && styles.sortMenuItemTextActive]}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
                <View>
                  {Array.from({ length: Math.ceil(Math.min(nearbyVisibleCount, nearbyPosts.length) / 2) }).map((_, rowIndex) => (
                    <React.Fragment key={'nearby-row-group-' + rowIndex}>
                      <View style={styles.row}>
                        {sortedNearbyPosts.slice(0, nearbyVisibleCount).slice(rowIndex * 2, rowIndex * 2 + 2).map(item => renderPost({ item }))}
                      </View>
                      {(rowIndex + 1) % 4 === 0 ? <NativeAdCard /> : null}
                    </React.Fragment>
                  ))}
                </View>
                {nearbyVisibleCount < nearbyPosts.length ? (
                  <View style={styles.loadMoreWrap}>
                    <TouchableOpacity
                      style={styles.loadMoreButton}
                      onPress={() => {
                        const nextCount = Math.min(
                          nearbyVisibleCountRef.current + PAGE_SIZE,
                          nearbyPosts.length,
                        );
                        nearbyVisibleCountRef.current = nextCount;
                        // Do not change nearbySort here. The selected sort is
                        // applied to the complete Nearby list before slicing.
                        setNearbyVisibleCount(nextCount);
                      }}
                    >
                      <Text style={styles.loadMoreButtonText}>Load More Offers</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : null}

  
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Latest Offers - Total {(latestTotalCount || posts.length) >= 100 ? '99+' : (latestTotalCount || posts.length)}</Text>
              <View style={{ position: 'relative' }}>
                <TouchableOpacity
                  style={[styles.sortButton, darkMode && styles.sortButtonDark]}
                  onPress={() => {
                    setLatestSortOpen(value => !value);
                    setNearbySortOpen(false);
                  }}
                >
                  <Text style={[styles.sortButtonText, darkMode && styles.darkText]}>
                    Sort: {latestSort === 'nearExpiry' ? 'Near Expiry' : latestSort === 'oldest' ? 'Old to New' : latestSort === 'newest' ? 'New to Old' : 'Expired'} ▾
                  </Text>
                </TouchableOpacity>
                {latestSortOpen ? (
                  <View style={[styles.sortMenu, styles.sortMenuLatest, darkMode && styles.sortMenuDark]}>
                    {[
                      ['nearExpiry', 'Near Expiry'],
                      ['oldest', 'Old to New'],
                      ['newest', 'New to Old'],
                      ['expired', 'Expired'],
                    ].map(([value, label]) => (
                      <TouchableOpacity
                        key={value}
                        style={styles.sortMenuItem}
                        onPress={() => {
                          setLatestSort(value as 'nearExpiry' | 'oldest' | 'newest' | 'expired');
                          setLatestSortOpen(false);
                        }}
                      >
                        <Text style={[styles.sortMenuItemText, latestSort === value && styles.sortMenuItemTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.state}><ActivityIndicator size="large" color={ACCENT} /><Text style={styles.stateText}>Loading latest offers...</Text></View>
          ) : error ? (
            <View style={styles.state}><Text style={styles.errorTitle}>Something went wrong</Text><Text style={styles.stateText}>{error}</Text><TouchableOpacity style={styles.retry} onPress={() => loadPosts()}><Text style={styles.retryText}>Try again</Text></TouchableOpacity></View>
          ) : (
            <View style={styles.state}><Text style={styles.errorTitle}>No offers found</Text><Text style={styles.stateText}>Try another search or category.</Text></View>
          )
        }
        ListFooterComponent={
          visiblePosts.length > 0 ? (
            <>
              {hasMorePosts ? (
                <View style={styles.loadMoreWrap}>
                  <TouchableOpacity
                    style={[styles.loadMoreButton, loadingMore && styles.disabledButton]}
                    onPress={loadMorePosts}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <ActivityIndicator size="small" color={WHITE} />
                    ) : (
                      <Text style={styles.loadMoreButtonText}>
                        Load More Offers
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={styles.footer}>
                <Text style={[styles.footerBrand, darkMode && styles.footerBrandDark]}>Offerhaikya</Text>
                <Text style={[styles.footerText, darkMode && styles.darkMutedText]}>Fresh offers. Simple browsing.</Text>
                <View style={styles.socialRow}>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="Instagram">
                    <View style={styles.instagramLogo}><View style={styles.instagramLens} /><View style={styles.instagramDot} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="YouTube">
                    <View style={styles.youtubeLogo}><View style={styles.youtubePlay} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="Facebook">
                    <Text style={styles.facebookLogo}>f</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="LinkedIn">
                    <Text style={styles.linkedinLogo}>in</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.instagram.com/offerhaikya/')} accessibilityLabel="X">
                    <Text style={styles.xLogo}>𝕏</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.footerLinks}>
                  <TouchableOpacity onPress={() => openInfoPage('about')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>About Us</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => openInfoPage('contact')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>Contact Us</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => openInfoPage('privacy')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>Privacy Policy</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => openInfoPage('terms')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>Terms & Conditions</Text></TouchableOpacity>
                </View>
              </View>
            </>
          ) : null
        }
      />
      </View>
      )}
      <View style={[styles.bottomNav, darkMode && styles.bottomNavDark]}>
        <TouchableOpacity
          style={[styles.bottomNavItem, bottomTab === 'request' && styles.bottomNavItemActive]}
          onPress={openOfferRequestTab}
          accessibilityLabel="Request offer"
        >
          <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
            <Path
              d="M4 5.5H20V18.5H4V5.5Z"
              stroke={bottomTab === 'request' ? ACCENT : (darkMode ? WHITE : TEXT)}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <Path
              d="M4.5 6L12 12L19.5 6"
              stroke={bottomTab === 'request' ? ACCENT : (darkMode ? WHITE : TEXT)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text
            style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'request' && styles.bottomNavLabelActive]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            Request Offer
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomNavItem, bottomTab === 'hot' && styles.bottomNavItemActive]}
          onPress={goToHotOffersTab}
          accessibilityLabel="Hot Offers"
        >
          <Text style={[styles.bottomNavPercentIcon, darkMode && styles.bottomNavPercentIconDark, bottomTab === 'hot' && styles.bottomNavPercentIconActive]}>%</Text>
          <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'hot' && styles.bottomNavLabelActive]}>
            Hot Offers
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomNavItem, bottomTab === 'home' && styles.bottomNavItemActive]}
          onPress={goToHomeTab}
          accessibilityLabel="Home"
        >
          <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
            <Path
              d="M3 10.5L12 3L21 10.5V21H14.5V14H9.5V21H3V10.5Z"
              stroke={bottomTab === 'home' ? ACCENT : (darkMode ? WHITE : TEXT)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'home' && styles.bottomNavLabelActive]}>
            Home
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.bottomNavItem,
            bottomTabRef.current === 'local' && styles.bottomNavItemActive,
            localOffersDisabled && styles.bottomNavItemDisabled,
          ]}
          onPress={goToLocalOffersTab}
          accessibilityLabel="Nearby Offers"
        >
          <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
            <Path
              d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5A8 8 0 1 1 20 10.5Z"
              stroke={localOffersDisabled ? '#b8b8b8' : bottomTabRef.current === 'local' ? ACCENT : (darkMode ? WHITE : TEXT)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M12 13.25A2.75 2.75 0 1 0 12 7.75A2.75 2.75 0 0 0 12 13.25Z"
              stroke={localOffersDisabled ? '#b8b8b8' : bottomTabRef.current === 'local' ? ACCENT : (darkMode ? WHITE : TEXT)}
              strokeWidth={2}
            />
          </Svg>
          <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTabRef.current === 'local' && styles.bottomNavLabelActive, localOffersDisabled && styles.bottomNavLabelDisabled]}>Nearby Offers</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomNavItem, bottomTab === 'search' && styles.bottomNavItemActive]}
          onPress={goToSearchTab}
          accessibilityLabel="Search"
        >
          <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
            <Path
              d="M11 18A7 7 0 1 0 11 4A7 7 0 0 0 11 18Z"
              stroke={bottomTab === 'search' ? ACCENT : (darkMode ? WHITE : TEXT)}
              strokeWidth={2}
            />
            <Path
              d="M16.5 16.5L21 21"
              stroke={bottomTab === 'search' ? ACCENT : (darkMode ? WHITE : TEXT)}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
          <Text style={[styles.bottomNavLabel, darkMode && styles.bottomNavLabelDark, bottomTab === 'search' && styles.bottomNavLabelActive]}>
            Search
          </Text>
        </TouchableOpacity>

      </View>

      <Modal
        visible={sharePostUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSharePostUrl(null)}
      >
        <View style={styles.shareOverlay}>
          <TouchableOpacity
            style={styles.shareBackdrop}
            activeOpacity={1}
            onPress={() => setSharePostUrl(null)}
          />
          <View style={[styles.sharePopup, darkMode && styles.favoritePopupDark]}>
            <Text style={[styles.sharePopupTitle, darkMode && styles.darkText]}>Share Offer</Text>

            <TouchableOpacity style={styles.shareOption} onPress={sharePost}>
              <Text style={[styles.shareOptionTitle, darkMode && styles.darkText]}>Share with</Text>
              <Text style={[styles.shareOptionText, darkMode && styles.darkMutedText]}>
                WhatsApp, Instagram, Facebook & Other Apps
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareOption}
              onPress={() => {
                if (sharePostUrl) copyPostLink(sharePostUrl);
                setSharePostUrl(null);
              }}
            >
              <Text style={[styles.shareOptionTitle, darkMode && styles.darkText]}>Click to Copy Link</Text>
              <Text style={[styles.shareOptionText, darkMode && styles.darkMutedText]}>
                The Offerhaikya post link
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareCancelButton}
              onPress={() => setSharePostUrl(null)}
            >
              <Text style={styles.shareCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={localOfferEmptyOpen}
        transparent
        animationType="fade"
        onRequestClose={closeLocalOfferEmptyPopup}
      >
        <View style={styles.localOfferEmptyOverlay}>
          <View style={styles.localOfferEmptyPopup}>
            <Text style={styles.localOfferEmptyTitle}>No offer found nearby</Text>
            <Text style={styles.localOfferEmptyText}>
              No nearby offers found in your area right now. Please check again later.
            </Text>
            <TouchableOpacity
              style={styles.registrationButton}
              onPress={closeLocalOfferEmptyPopup}
            >
              <Text style={styles.registrationButtonText}>Close ({localOfferEmptyCountdown})</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {nearbyPreloaderOpen ? (
        <View style={styles.nearbyPreloaderOverlay}>
          <View style={styles.nearbyPreloaderCircle}>
            <Image
              source={require('./assets/Offer.gif')}
              style={styles.nearbyPreloaderGif}
              resizeMode="contain"
            />
          </View>
        </View>
      ) : null}

      <Modal
        visible={locationPromptOpen}
        transparent
        animationType="fade"
        onRequestClose={postponeLocationPrompt}
      >
        <View style={styles.locationPromptOverlay}>
          <View style={styles.locationPromptPopup}>
            <Text style={styles.locationPromptTitle}>Offerhaikya needs your location</Text>
            <Text style={styles.locationPromptText}>
              Please turn on location to see the best local and trending offers near you.
            </Text>

            <TouchableOpacity
              style={styles.registrationButton}
              onPress={requestLocationPermission}
            >
              <Text style={styles.registrationButtonText}>Yes</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.registrationSkipButton}
              onPress={postponeLocationPrompt}
            >
              <Text style={styles.registrationSkipText}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={offerRequestOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!offerRequestSuccess) {
            setOfferRequestOpen(false);
          }
        }}
      >
        <View style={styles.offerRequestOverlay}>
          <TouchableOpacity
            style={styles.offerRequestBackdrop}
            activeOpacity={1}
            onPress={() => {
              if (!offerRequestSubmitting && !offerRequestSuccess) {
                setOfferRequestOpen(false);
              }
            }}
          />
          <View style={styles.offerRequestPopup}>
            <View style={styles.offerRequestHeader}>
              <Text style={styles.offerRequestTitle}>User Offers Requests</Text>
              <TouchableOpacity
                onPress={() => {
                  if (!offerRequestSubmitting && !offerRequestSuccess) {
                    setOfferRequestOpen(false);
                    setBottomTab(null);
                  }
                }}
                style={styles.offerRequestClose}
                disabled={offerRequestSubmitting || offerRequestSuccess}
              >
                <Text style={styles.offerRequestCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              value={offerRequestName}
              onChangeText={value => setOfferRequestName(value.replace(/[^A-Za-z ]/g, '').slice(0, 12))}
              placeholder="Name *"
              placeholderTextColor="#99969c"
              style={styles.registrationInput}
              autoCapitalize="words"
              maxLength={12}
              editable={!offerRequestSubmitting}
            />
            <View style={styles.phoneInputWrap}>
              <Text style={styles.phonePrefix}>+91</Text>
              <TextInput
                value={offerRequestContact}
                onChangeText={value => setOfferRequestContact(value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit phone number *"
                placeholderTextColor="#99969c"
                style={styles.phoneInput}
                keyboardType="phone-pad"
                maxLength={10}
                editable={!offerRequestSubmitting}
              />
            </View>
            <TextInput
              value={offerRequestText}
              onChangeText={value => setOfferRequestText(value.slice(0, 50))}
              placeholder="Offer request *"
              placeholderTextColor="#99969c"
              style={[styles.offerRequestInput, styles.offerRequestInputMultiline]}
              multiline
              numberOfLines={4}
              maxLength={50}
              textAlignVertical="top"
              editable={!offerRequestSubmitting && !offerRequestSuccess}
            />
            <Text style={styles.offerRequestCounter}>{offerRequestText.length}/50</Text>

            {offerRequestError ? <Text style={styles.registrationError}>{offerRequestError}</Text> : null}
            {offerRequestSuccess ? <Text style={styles.offerRequestSuccess}>Request sent ✓</Text> : null}

            <TouchableOpacity
              style={[
                styles.registrationButton,
                (offerRequestSubmitting || offerRequestSuccess) && styles.disabledButton,
              ]}
              onPress={submitOfferRequest}
              disabled={offerRequestSubmitting || offerRequestSuccess}
            >
              {offerRequestSubmitting ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : offerRequestSuccess ? (
                <Text style={styles.registrationButtonText}>Request sent ✓</Text>
              ) : (
                <Text style={styles.registrationButtonText}>Send Request</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    {notificationPopup}
    {favoritePopup}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  startupPreloader: {
    flex: 1,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  startupPreloaderLogo: {
    width: 230,
    height: 82,
    marginBottom: 16,
  },
  startupPreloaderGif: {
  width: 82,
  height: 82,
  marginBottom: 18,
},
  startupPreloaderProgressTrack: {
    width: '72%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#eeeeee',
    overflow: 'hidden',
  },
  startupPreloaderProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: ACCENT,
  },
  startupPreloaderStatus: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  safe: { flex: 1, backgroundColor: PAGE },
  darkSafe: { backgroundColor: '#000000' },
  pageWrap: { flex: 1, backgroundColor: PAGE },
  darkPage: { flex: 1, backgroundColor: '#000000' },
  contentDark: { backgroundColor: '#000000' },
  header: { height: 60, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dddddd' },
  headerDark: { backgroundColor: '#000000', borderBottomColor: '#2b2b2b' },
  headerIconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerActionButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { fontSize: 22, color: TEXT, textAlign: 'center', includeFontPadding: false },
  headerIconDark: { color: WHITE },
  headerLogo: { width: 140, height: 48, marginLeft: 8 },
  headerActions: { marginLeft: 'auto', marginRight: 4, flexDirection: 'row', alignItems: 'center', paddingLeft: 0 },
  listDark: { backgroundColor: '#000000' },
  detailListDark: { backgroundColor: '#000000' },
  menuOverlay: { ...StyleSheet.absoluteFill, zIndex: 100, flexDirection: 'row' },
  menuBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.42)' },
  menuPanel: { width: 300, maxWidth: '82%', height: '100%', backgroundColor: WHITE, elevation: 14, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 5, height: 0 } },
  menuHeader: { minHeight: 72, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  menuTitle: { fontSize: 20, fontWeight: '900', color: TEXT },
  menuSectionTitle: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, color: TEXT, fontSize: 13, fontWeight: '900' },
  menuCloseButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  menuCloseText: { color: TEXT, fontSize: 30, lineHeight: 30 },
  menuList: { paddingVertical: 8, paddingBottom: 28 },
  menuMainItem: { minHeight: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  menuMainItemText: { color: TEXT, fontSize: 16, fontWeight: '900' },
  menuMainArrow: { color: '#777', fontSize: 24, lineHeight: 24 },
  menuSubList: { backgroundColor: '#fafafa', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  menuSubItem: { minHeight: 46, paddingHorizontal: 30, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  menuSubItemText: { color: TEXT, fontSize: 14, fontWeight: '700' },
  menuItemActiveBg: { backgroundColor: '#fff3ed' },
  menuItemActive: { color: ACCENT },
  detailHeaderDark: { backgroundColor: '#000000', borderBottomColor: '#2b2b2b' },
  detailContentDark: { backgroundColor: '#000000' },
  content: { paddingBottom: 104, backgroundColor: PAGE },
  hero: { minHeight: 245, justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 28 },
  heroImage: { opacity: 1 },
  heroSmall: { color: WHITE, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, textAlign: 'center' },
  heroTitle: { color: WHITE, fontSize: 29, lineHeight: 35, fontWeight: '900', textAlign: 'center' },
  heroSubtitle: { color: '#eeeeff', fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  searchBox: { marginTop: 18, backgroundColor: WHITE, minHeight: 52, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 5, elevation: 3, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  searchIcon: { fontSize: 27, color: MUTED, marginRight: 8, marginTop: -3 },
  searchInput: { flex: 1, color: TEXT, fontSize: 15, paddingVertical: 12 },
  searchButton: { width: 42, height: 42, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  searchButtonText: { color: WHITE, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  searchDropdown: { marginTop: 6, backgroundColor: WHITE, borderRadius: 12, overflow: 'hidden', elevation: 6, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, maxHeight: 180 },
  searchSuggestionScroll: { maxHeight: 180 },
  searchDropdownLoading: { paddingVertical: 16, alignItems: 'center' },
  searchSuggestion: { minHeight: 58, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  searchSuggestionImage: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#eeeeee' },
  searchSuggestionTextWrap: { flex: 1, marginLeft: 10 },
  searchSuggestionTitle: { color: TEXT, fontSize: 14, fontWeight: '800' },
  searchSuggestionLabel: { color: MUTED, fontSize: 11, marginTop: 3 },
  searchNoResult: { padding: 16, color: MUTED, fontSize: 13 },
  tagStrip: { backgroundColor: ACCENT, position: 'relative' },
  chips: { paddingHorizontal: 14, paddingVertical: 11, paddingRight: 42, gap: 8 },
  chip: { paddingHorizontal: 5, paddingVertical: 8, backgroundColor: 'transparent' },
  activeChip: { backgroundColor: 'transparent' },
  chipText: { color: WHITE, fontSize: 14, fontWeight: '800' },
  activeChipText: { color: WHITE },
    tagPageHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 },
  tagPageBackButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tagPageBackText: { color: TEXT, fontSize: 34, lineHeight: 34 },
  tagPageTitle: { flex: 1, color: TEXT, fontSize: 20, fontWeight: '900', marginRight: 8 },
  sortButton: { minHeight: 36, maxWidth: 185, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: WHITE },
  sortButtonDark: { backgroundColor: '#222222', borderColor: '#444444' },
  sortButtonText: { color: TEXT, fontSize: 11, fontWeight: '900' },
  sortMenu: { position: 'absolute', top: 40, right: 0, minWidth: 150, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, backgroundColor: WHITE, overflow: 'hidden', elevation: 8, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, zIndex: 100 },
  sortMenuLatest: { minWidth: 165, position: 'relative', top: 0, right: 0, alignSelf: 'flex-end' },
  sortMenuDark: { backgroundColor: '#222222', borderColor: '#444444' },
  sortMenuItem: { minHeight: 42, paddingHorizontal: 12, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  sortMenuItemText: { color: TEXT, fontSize: 12, fontWeight: '700' },
  sortMenuItemTextActive: { color: ACCENT, fontWeight: '900' },
  tagPageDropdownButton: { minWidth: 72, height: 38, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: WHITE },
  tagPageDropdownText: { color: TEXT, fontSize: 13, fontWeight: '900' },
  tagPageDropdownArrow: { color: TEXT, fontSize: 17, lineHeight: 18, marginLeft: 5 },
  tagPageDropdownMenu: { marginHorizontal: 12, marginBottom: 10, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, backgroundColor: WHITE, overflow: 'hidden', elevation: 5, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  tagPageDropdownMenuDark: { backgroundColor: '#222222', borderColor: '#444444' },
  tagPageDropdownScroll: { maxHeight: 240 },
  tagPageDropdownItem: { minHeight: 44, paddingHorizontal: 13, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  tagPageDropdownItemDark: { borderBottomColor: '#333333' },
  tagPageDropdownItemActive: { backgroundColor: '#fff3ed' },
  tagPageDropdownItemText: { color: TEXT, fontSize: 13, fontWeight: '700' },
  tagPageDropdownItemTextActive: { color: ACCENT, fontWeight: '900' },
  tagPageLoading: { alignItems: 'center', paddingBottom: 10 },
  sectionRow: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: TEXT, fontSize: 20, fontWeight: '900' },
  pageText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', paddingHorizontal: 10, justifyContent: 'space-between' },

  card: { width: '47.5%', marginHorizontal: 6, marginBottom: 14, backgroundColor: WHITE, borderRadius: 8, overflow: 'hidden', position: 'relative', elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  cardImage: { width: '100%', height: 125, backgroundColor: '#eeeeee' },
  cardHeart: { position: 'absolute', top: 8, right: 8, zIndex: 3, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  cardShare: { position: 'absolute', top: 48, right: 8, zIndex: 3, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  cardDistance: { position: 'absolute', top: 88, right: 8, zIndex: 3, maxWidth: '62%', minHeight: 22, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)', flexDirection: 'row', alignItems: 'center', gap: 3 },
  cardDistanceText: { color: MUTED, fontSize: 9, fontWeight: '900' },
  cardExpiry: { position: 'absolute', top: 8, left: 8, zIndex: 3, maxWidth: '62%', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)' },
  cardExpiryText: { color: ACCENT, fontSize: 9, fontWeight: '900' },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailIconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  detailShareIcon: { width: 21, height: 21 },
  detailHeartText: { color: '#e31b23', fontSize: 25, lineHeight: 28 },
  cardHeartText: { color: '#e31b23', fontSize: 20, lineHeight: 22 },
  imageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: HERO },
  fallbackText: { color: WHITE, fontSize: 16, fontWeight: '900' },
  cardBody: { padding: 11 },
  cardDark: { backgroundColor: '#222222' },
  cardBodyDark: { backgroundColor: '#222222' },
  darkText: { color: WHITE },
  darkMutedText: { color: '#b8b8b8' },
  label: { color: ACCENT, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 5 },
  title: { color: TEXT, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  date: { color: MUTED, fontSize: 10, marginTop: 5 },
  excerpt: { color: '#66636a', fontSize: 11, lineHeight: 16, marginTop: 6 },
  readText: { color: ACCENT, fontSize: 11, fontWeight: '900', marginTop: 8 },
  disabledButton: { opacity: 0.35 },
  state: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 45 },
  stateText: { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 9 },
  errorTitle: { color: TEXT, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  retry: { marginTop: 16, backgroundColor: ACCENT, borderRadius: 9, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: WHITE, fontWeight: '800' },
  detailHeader: { height: 60, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dddddd' },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  backText: { color: TEXT, fontSize: 34, lineHeight: 34 },
  detailHeaderTitle: { flex: 1, color: TEXT, fontSize: 16, fontWeight: '800', marginRight: 10 },
  detailContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 50 },
  infoContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 110 },
  infoHeroImage: { width: '100%', height: 110, marginBottom: 14 },
  infoRecommendationSection: { marginTop: 22 },
  infoBottomRecommendations: { marginTop: 10, paddingTop: 8, marginHorizontal: -20 },
  detailImage: { width: '100%', height: 220, borderRadius: 14, backgroundColor: '#eeeeee', marginBottom: 16 },
  detailLabel: { color: ACCENT, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 2 },
  detailTitle: { color: TEXT, fontSize: 27, lineHeight: 34, fontWeight: '900', marginTop: 7 },
  detailDate: { color: MUTED, fontSize: 12, marginTop: 7 },
  detailBody: { color: '#4f4c52', fontSize: 15, lineHeight: 26, marginTop: 22, paddingBottom: 12 },
  mapSection: { marginTop: 18 },
  mapTitle: { color: TEXT, fontSize: 18, fontWeight: '900', marginBottom: 10 },
  mapView: { width: '100%', height: 220, borderRadius: 12, overflow: 'hidden' },
  mapButton: { marginTop: 10, backgroundColor: ACCENT, borderRadius: 9, paddingVertical: 11, alignItems: 'center' },
  mapButtonText: { color: WHITE, fontSize: 13, fontWeight: '900' },
  nearbyPage: { flex: 1, backgroundColor: PAGE },
  nearbyMapHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  nearbyMapTitle: { color: TEXT, fontSize: 20, fontWeight: '900' },
  nearbyMapSubtitle: { color: MUTED, fontSize: 11, marginTop: 3 },
  nearbyListContent: { padding: 12, paddingBottom: 30 },
  nearbyListCard: { backgroundColor: WHITE, borderRadius: 14, marginBottom: 10, padding: 10, flexDirection: 'row', elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  nearbyListCardDark: { backgroundColor: '#1c1c1c', borderRadius: 14, marginBottom: 10, padding: 10, flexDirection: 'row' },
  nearbyListImage: { width: 82, height: 82, borderRadius: 10, backgroundColor: '#eeeeee' },
  nearbyListInfo: { flex: 1, paddingLeft: 11, paddingRight: 2 },
  nearbyNoLocation: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, backgroundColor: PAGE },
  nearbyNoLocationIcon: { fontSize: 42, marginBottom: 10 },
  nearbyNoLocationTitle: { color: TEXT, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  nearbyNoLocationText: { color: MUTED, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7, marginBottom: 18 },
  nearbyOfferCard: { position: 'absolute', left: 12, right: 12, bottom: 14, zIndex: 8, backgroundColor: WHITE, borderRadius: 16, padding: 12, flexDirection: 'row', elevation: 8, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  nearbyOfferCardDark: { backgroundColor: '#1c1c1c' },
  nearbyOfferCardClose: { position: 'absolute', right: 5, top: 5, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  nearbyOfferCardCloseText: { color: TEXT, fontSize: 25, lineHeight: 26 },
  nearbyOfferImage: { width: 82, height: 82, borderRadius: 10, backgroundColor: '#eeeeee' },
  nearbyOfferInfo: { flex: 1, paddingLeft: 11, paddingRight: 28 },
  nearbyOfferLabel: { color: ACCENT, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  nearbyListTitle: { color: TEXT, fontSize: 14, lineHeight: 19, fontWeight: '900', marginTop: 3 },
  nearbyOfferDistance: { color: MUTED, fontSize: 11, marginTop: 4 },
  nearbyOfferActions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  nearbyOfferViewButton: { minHeight: 34, paddingHorizontal: 11, borderRadius: 8, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  nearbyOfferViewButtonText: { color: WHITE, fontSize: 11, fontWeight: '900' },
  nearbyOfferMapsButton: { minHeight: 34, paddingHorizontal: 9, borderRadius: 8, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  nearbyOfferMapsButtonText: { color: WHITE, fontSize: 10, fontWeight: '900' },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 76, backgroundColor: WHITE, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dddddd', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 8, paddingTop: 7, paddingBottom: 7, zIndex: 140, elevation: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } },
  bottomNavDark: { backgroundColor: '#151515', borderTopColor: '#303030' },
  bottomNavItem: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginHorizontal: 4 },
  bottomNavPercentIcon: { color: 'rgba(0,0,0,0.8)', fontSize: 23, lineHeight: 23, fontWeight: '900' },
  bottomNavPercentIconDark: { color: WHITE },
  bottomNavPercentIconActive: { color: ACCENT },
  infoBottomNavPercentIcon: { color: 'rgba(0,0,0,0.8)', fontSize: 23, lineHeight: 23, fontWeight: '900' },
  infoBottomNavPercentIconDark: { color: WHITE },
  infoBottomNavItem: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginHorizontal: 4, backgroundColor: 'transparent' },
  infoBottomNavLabel: { color: MUTED, fontSize: 11, fontWeight: '800', marginTop: 4 },
  infoBottomNavLabelDark: { color: WHITE },
  bottomNavItemActive: { backgroundColor: '#fff3ed' },
  bottomNavItemDisabled: { opacity: 0.5 },
  bottomNavLabelDisabled: { color: '#b8b8b8' },
  bottomNavLabel: { color: TEXT, fontSize: 11, fontWeight: '800', marginTop: 4 },
  bottomNavLabelActive: { color: ACCENT, fontWeight: '900' },
  bottomNavLabelDark: { color: '#eeeeee' },
  locationPromptOverlay: { ...StyleSheet.absoluteFill, zIndex: 280, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  // Nearby loading/slow-data fallback: show the Offer.gif over a 60% black full-screen background so the user gets clear loading feedback.
  nearbyPreloaderOverlay: { ...StyleSheet.absoluteFill, zIndex: 275, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  nearbyPreloaderCircle: { width: 118, height: 118, alignItems: 'center', justifyContent: 'center' },
  nearbyPreloaderGif: { width: 92, height: 92 },
  localOfferEmptyOverlay: { ...StyleSheet.absoluteFill, zIndex: 290, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  localOfferEmptyPopup: { width: '100%', backgroundColor: WHITE, borderRadius: 16, padding: 18 },
  localOfferEmptyTitle: { color: TEXT, fontSize: 21, fontWeight: '900', marginBottom: 7 },
  localOfferEmptyText: { color: MUTED, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  locationPromptPopup: { width: '100%', backgroundColor: WHITE, borderRadius: 16, padding: 18 },
  locationPromptTitle: { color: TEXT, fontSize: 21, fontWeight: '900', marginBottom: 7 },
  locationPromptText: { color: MUTED, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  offerRequestOverlay: { ...StyleSheet.absoluteFill, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  offerRequestBackdrop: { ...StyleSheet.absoluteFill },
  offerRequestPopup: { width: '100%', backgroundColor: WHITE, borderRadius: 16, padding: 18, zIndex: 2 },
  offerRequestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  offerRequestTitle: { color: TEXT, fontSize: 20, fontWeight: '900', flex: 1 },
  offerRequestClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  offerRequestCloseText: { color: TEXT, fontSize: 30, lineHeight: 30 },
  offerRequestInput: { minHeight: 48, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 12, color: TEXT, fontSize: 15, marginBottom: 11, backgroundColor: WHITE },
  offerRequestInputMultiline: { minHeight: 110 },
  offerRequestCounter: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: -6, marginBottom: 10 },
  offerRequestSuccess: { color: '#168a3a', fontSize: 13, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  favoriteOverlay: { ...StyleSheet.absoluteFill, zIndex: 150, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  shareOverlay: { ...StyleSheet.absoluteFill, zIndex: 310, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  shareBackdrop: { ...StyleSheet.absoluteFill },
  sharePopup: { width: '100%', backgroundColor: WHITE, borderRadius: 16, padding: 18 },
  sharePopupTitle: { color: TEXT, fontSize: 21, fontWeight: '900', marginBottom: 8 },
  shareOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  shareOptionTitle: { color: TEXT, fontSize: 16, fontWeight: '900' },
  shareOptionText: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 3 },
  shareCancelButton: { minHeight: 48, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  shareCancelText: { color: WHITE, fontSize: 14, fontWeight: '900' },
  favoriteOverlayBackdrop: { ...StyleSheet.absoluteFill },
  favoritePopup: { width: '100%', maxHeight: '62%', backgroundColor: WHITE, borderRadius: 16, padding: 12, zIndex: 2 },
  favoritePopupDark: { backgroundColor: '#222222' },
  favoritePopupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  favoritePopupTitle: { color: TEXT, fontSize: 20, fontWeight: '900' },
  favoritePopupCount: { color: MUTED, fontSize: 12, marginTop: 3 },
  favoriteClose: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  favoriteCloseText: { color: TEXT, fontSize: 30, lineHeight: 30 },
  favoriteEmpty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
  favoriteList: { paddingBottom: 4 },
  favoriteItem: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eeeeee', paddingVertical: 6 },
  favoriteItemDark: { borderBottomColor: '#333333' },
  favoriteItemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  favoriteItemImage: { width: 52, height: 52, borderRadius: 8, backgroundColor: '#eeeeee' },
  favoriteItemFallback: { color: WHITE, fontSize: 12, fontWeight: '900' },
  favoriteItemText: { flex: 1, marginLeft: 10, minWidth: 0 },
  favoriteItemTitle: { color: TEXT, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  favoriteItemLabel: { color: ACCENT, fontSize: 10, fontWeight: '800', marginTop: 4 },
  favoriteRemove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  favoriteRemoveText: { color: '#e31b23', fontSize: 24, lineHeight: 24 },
  notificationDeleteAllButton: { minHeight: 44, borderRadius: 10, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  notificationDeleteAllText: { color: WHITE, fontSize: 13, fontWeight: '900' },
  favoriteBadge: { position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#e31b23', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  favoriteBadgeText: { color: WHITE, fontSize: 9, fontWeight: '900' },
  profileOverlay: { ...StyleSheet.absoluteFill, zIndex: 210, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  profileBackdrop: { ...StyleSheet.absoluteFill },
  profilePopup: { width: '100%', maxHeight: '88%', backgroundColor: WHITE, borderRadius: 16, padding: 18 },
  profilePopupDark: { backgroundColor: '#111111' },
  profileHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 15 },
  profileTitle: { color: TEXT, fontSize: 21, fontWeight: '900', marginBottom: 4 },
  profileSubtitle: { color: MUTED, fontSize: 13 },
  profileHeaderCloseButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  profileCloseText: { color: TEXT, fontSize: 29, lineHeight: 30 },
  profileLoading: { minHeight: 280, alignItems: 'center', justifyContent: 'center' },
  profileLoadingText: { color: MUTED, fontSize: 13, marginTop: 10 },
  profileFormContent: { paddingBottom: 4 },
  profileFieldLabel: { color: TEXT, fontSize: 13, fontWeight: '900', marginBottom: 7 },
  profileInput: { minHeight: 48, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 13, color: TEXT, fontSize: 15, marginBottom: 12, backgroundColor: WHITE },
  profileInputDark: { backgroundColor: '#1c1c1c', borderColor: '#343434', color: WHITE },
  profilePhoneWrap: { minHeight: 48, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: WHITE },
  profilePhonePrefix: { color: TEXT, fontSize: 15, fontWeight: '800', marginRight: 8 },
  profilePhoneInput: { flex: 1, color: TEXT, fontSize: 15, paddingVertical: 0 },
  profileCategoryMenu: { borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, backgroundColor: WHITE, marginBottom: 12, overflow: 'hidden' },
  profileCategoryMenuDark: { backgroundColor: '#1c1c1c', borderColor: '#343434' },
  profileCategoryScroll: { maxHeight: 190 },
  profileCategoryItem: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  profileCheckbox: { width: 21, height: 21, borderWidth: 1.5, borderColor: '#bbbbbb', borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  profileCheckboxSelected: { backgroundColor: ACCENT, borderColor: ACCENT },
  profileCheck: { color: WHITE, fontSize: 14, fontWeight: '900', lineHeight: 16 },
  profileCategoryText: { flex: 1, color: TEXT, fontSize: 13 },
  profileCategoryTextSelected: { color: ACCENT, fontWeight: '800' },
  profileError: { color: '#d93025', fontSize: 12, fontWeight: '700', marginBottom: 10 },
  profileSaveButton: { minHeight: 48, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  profileUpdateButton: { minHeight: 48, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  profileUpdateButtonText: { color: WHITE, fontSize: 14, fontWeight: '900' },
  profileCloseButton: { minHeight: 48, borderRadius: 10, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  profileCloseButtonText: { color: WHITE, fontSize: 14, fontWeight: '900' },
  profileLinkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 2 },
  profileLinkItem: { minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  profileLinkText: { color: '#000000', fontSize: 12, fontWeight: '800' },
  profileLinkDeleteText: { color: '#d93025', fontSize: 12, fontWeight: '800' },
  profileLinkSeparator: { color: '#000000', fontSize: 12, fontWeight: '700' },

registrationOverlay: { ...StyleSheet.absoluteFill, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  registrationTestOverlay: { ...StyleSheet.absoluteFill, zIndex: 340, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  registrationPopup: { width: '100%', maxHeight: '88%', backgroundColor: WHITE, borderRadius: 16, padding: 18, position: 'relative' },
  registrationHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 3 },
  registrationCloseButton: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', marginTop: 0, marginRight: 0 },
  registrationCloseText: { color: WHITE, fontSize: 17, lineHeight: 19, fontWeight: '700' },
  registrationFormContent: { paddingBottom: 2 },
  registrationCategoryTitle: { color: TEXT, fontSize: 13, fontWeight: '900', marginBottom: 8 },
  registrationCategoryDropdown: { minHeight: 48, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: WHITE, marginBottom: 8 },
  registrationCategoryDropdownText: { flex: 1, color: MUTED, fontSize: 14 },
  registrationCategoryDropdownTextSelected: { color: TEXT, fontWeight: '700' },
  registrationCategoryDropdownArrow: { color: MUTED, fontSize: 20, marginLeft: 8 },
  registrationCategoryDropdownMenu: { borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, backgroundColor: WHITE, marginBottom: 12, overflow: 'hidden' },
  registrationCategoryDropdownScroll: { maxHeight: 210 },
  registrationCategoryDropdownItem: { minHeight: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  registrationCategoryCheckbox: { width: 21, height: 21, borderWidth: 1.5, borderColor: '#bbbbbb', borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  registrationCategoryCheckboxSelected: { backgroundColor: ACCENT, borderColor: ACCENT },
  registrationCategoryCheck: { color: WHITE, fontSize: 14, fontWeight: '900', lineHeight: 16 },
  registrationCategoryDropdownItemText: { flex: 1, color: TEXT, fontSize: 13 },
  registrationCategoryDropdownItemTextSelected: { color: ACCENT, fontWeight: '800' },
  registrationCategoryDoneButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: '#eeeeee' },
  registrationCategoryDoneText: { color: ACCENT, fontSize: 14, fontWeight: '900' },
  registrationTitle: { color: TEXT, fontSize: 21, fontWeight: '900', marginBottom: 5 },
  registrationSubtitle: { color: MUTED, fontSize: 13, lineHeight: 19, marginBottom: 15 },
  registrationInput: { minHeight: 48, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 13, color: TEXT, fontSize: 15, marginBottom: 11, backgroundColor: WHITE },
  phoneInputWrap: { minHeight: 48, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 11, backgroundColor: WHITE },
  phonePrefix: { color: TEXT, fontSize: 15, fontWeight: '800', marginRight: 8 },
  phoneInput: { flex: 1, color: TEXT, fontSize: 15, paddingVertical: 0 },
  passwordInputWrap: { minHeight: 48, borderWidth: 1, borderColor: '#dddddd', borderRadius: 10, paddingLeft: 13, paddingRight: 4, flexDirection: 'row', alignItems: 'center', marginBottom: 11, backgroundColor: WHITE },
  passwordInput: { flex: 1, color: TEXT, fontSize: 15, paddingVertical: 0 },
  passwordEyeButton: { minWidth: 54, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  passwordEyeText: { color: ACCENT, fontSize: 12, fontWeight: '900' },
  addOffersButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  addOffersText: { color: ACCENT, fontSize: 13, fontWeight: '900' },
  profileActionTextButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  profileActionText: { color: ACCENT, fontSize: 13, fontWeight: '800' },
  registrationError: { color: '#d93025', fontSize: 12, fontWeight: '700', marginBottom: 10 },
  registrationSuccess: { color: '#168a3a', fontSize: 13, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  registrationButton: { minHeight: 48, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  registrationButtonText: { color: WHITE, fontSize: 14, fontWeight: '900' },
  registrationLoginButton: { minHeight: 48, borderRadius: 10, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  registrationLoginButtonText: { color: WHITE, fontSize: 14, fontWeight: '900' },
  registrationAuthButtonRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  registrationAuthHalfButton: { flex: 1 },
  registrationSecondaryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 4 },
  registrationSecondaryHalfButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  registrationLinkText: { color: '#000000', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  registrationLinkSeparator: { color: '#000000', fontSize: 14, fontWeight: '700', paddingHorizontal: 2 },
  registrationSkipButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  registrationSkipText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  registrationWaitText: { color: MUTED, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  nativeAdContainer: {
    width: '100%',
    backgroundColor: WHITE,
    borderRadius: 12,
    marginVertical: 12,
    overflow: 'hidden',
  },
  nativeAdInner: {
    padding: 12,
  },
  nativeAdHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nativeAdIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  nativeAdHeadline: {
    flex: 1,
    color: TEXT,
    fontSize: 15,
    fontWeight: '900',
  },
  nativeAdLabel: {
    color: WHITE,
    backgroundColor: ACCENT,
    fontSize: 9,
    fontWeight: '900',
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 4,
  },
  nativeAdAdvertiser: {
    color: MUTED,
    fontSize: 11,
    marginTop: 5,
  },
  nativeAdBody: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 7,
  },
  nativeAdMedia: {
    width: '100%',
    aspectRatio: 1.9,
    marginTop: 10,
    borderRadius: 8,
  },
  nativeAdCta: {
    color: WHITE,
    backgroundColor: ACCENT,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginTop: 10,
  },
  bannerAdWrap: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 14,
  },
  loadMoreWrap: { alignItems: 'center', paddingVertical: 18 },
  loadMoreButton: { minHeight: 36, paddingHorizontal: 20, borderRadius: 8, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  loadMoreButtonText: { color: WHITE, fontSize: 12, fontWeight: '900' },
  footer: { alignItems: 'center', paddingTop: 12, paddingBottom: 10 },
  footerBrand: { color: TEXT, fontSize: 13, fontWeight: '900' },
  footerBrandDark: { color: WHITE },
  footerText: { color: MUTED, fontSize: 12, marginTop: 4 },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 10, paddingHorizontal: 10 },
  footerLink: { color: TEXT, fontSize: 12, fontWeight: '800' },
  socialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10 },
  socialIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  instagramLogo: { width: 19, height: 19, borderWidth: 2, borderColor: WHITE, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  instagramLens: { width: 8, height: 8, borderWidth: 2, borderColor: WHITE, borderRadius: 4 },
  instagramDot: { position: 'absolute', top: 3, right: 3, width: 3, height: 3, borderRadius: 2, backgroundColor: WHITE },
  youtubeLogo: { width: 21, height: 15, borderRadius: 4, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' },
  youtubePlay: { marginLeft: 2, width: 0, height: 0, borderTopWidth: 4, borderBottomWidth: 4, borderLeftWidth: 6, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: ACCENT },
  facebookLogo: { color: WHITE, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  linkedinLogo: { color: WHITE, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  xLogo: { color: WHITE, fontSize: 17, fontWeight: '900' },
  socialLogo: { width: 19, height: 19 },
});




