import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Animated,
  Easing,
  FlatList,
  Image,
  ImageBackground,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ToastAndroid,
  Share,
} from 'react-native';
import RenderHTML from 'react-native-render-html';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import Svg, { Path } from 'react-native-svg';
import MapView, { Marker } from 'react-native-maps';
import { useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BLOG_URL = 'https://www.offerhaikya.com';
const FEED_URL = BLOG_URL + '/feeds/posts/default';
const ACCENT = '#ff5b01';
const HERO = '#6c6cfe';
const PAGE = '#f3f4f6';
const WHITE = '#ffffff';
const TEXT = '#202124';
const MUTED = '#77747a';
const PAGE_SIZE = 20;
const NEARBY_RADIUS_KM = 200;
const MAIN_AUTO_SYNC_INTERVAL_MS = 60 * 1000;
const METADATA_AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const FEED_CACHE_TTL_MS = 60 * 1000;
const NEARBY_CACHE_TTL_MS = 5 * 60 * 1000;
const NEARBY_NEW_POST_CHECK_INTERVAL_MS = 60 * 1000;
const LOCATION_RETRY_MS = 5 * 60 * 1000;
const DIRECT_TAGS = ['All', 'News', 'Amazon', 'Flipkart', 'Myntra', 'Meesho', 'Instamart', 'Blinkit', 'Zepto', 'BigBasket Now', 'Snapdeal', 'Shopsy', 'Offline Offers', 'Online Offers'];
const CATEGORY_ITEMS = ['Fashion', 'Electronics', 'Home & Kitchen', 'Beauty & Personal Care', 'Grocery & Food', 'Baby & Kids', 'Sports & Fitness', 'Automotive', 'Pet Supplies', 'Books & Education', 'Gaming', 'Travel & Luggage', 'Jewellery & Accessories', 'Tools & Industrial'];
const SPECIAL_DEAL_ITEMS = ['₹1 Deals', 'Loot Deals', 'Flash Sales', "Today's Deals", 'Clearance Sale', 'Buy 1 Get 1', 'Under ₹99', 'Under ₹499', '50%+ Off', 'Coupon Codes', 'Bank Offers', 'Freebies'];
const REGISTRATION_URL = 'https://script.google.com/macros/s/AKfycbwkNldloiCIk07pl02WmcfPSLnbp8gMol-YWfgdpo9wON_ekNL5M9ve0m0hOm2mL_Wv/exec';

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
};

const feedCache = new Map<string, { posts: Post[]; savedAt: number }>();

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
      label: labels[0] || 'Offers',
      labels,
      image: highResImage(firstImage(content) || entry.media$thumbnail?.url),
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
      content: stripHtml(content),
      rawContent: content,
    };
  });
};

const getFeedCacheKey = (query = '', startIndex = 1) =>
  query.trim().toLowerCase() + '::' + startIndex;

const fetchFeedFromNetwork = async (query = '', startIndex = 1) => {
  const params = new URLSearchParams({
    alt: 'json',
    'max-results': String(PAGE_SIZE),
    'start-index': String(startIndex),
  });

  if (query.trim().length >= 1) {
    params.set('q', query.trim());
  }

  const response = await fetch(FEED_URL + '?' + params.toString());
  if (!response.ok) throw new Error('Unable to load posts');

  const posts = parseFeed(await response.json());
  feedCache.set(getFeedCacheKey(query, startIndex), {
    posts,
    savedAt: Date.now(),
  });

  return posts;
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

const getAllPostsForNearby = async () => {
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

export default function App() {
  const { width } = useWindowDimensions();
  const [posts, setPosts] = useState<Post[]>([]);
  const [hotOffersPosts, setHotOffersPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState('');
  const [activeLabel, setActiveLabel] = useState('All');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Post | null>(null);
  const [favorites, setFavorites] = useState<Post[]>([]);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCategoriesOpen, setMenuCategoriesOpen] = useState(false);
  const [menuSpecialDealsOpen, setMenuSpecialDealsOpen] = useState(false);
  const [infoPage, setInfoPage] = useState<'about' | 'contact' | 'privacy' | 'terms' | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Post[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [error, setError] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [registrationName, setRegistrationName] = useState('');
  const [registrationContact, setRegistrationContact] = useState('');
  const [registrationEmail, setRegistrationEmail] = useState('');
  const [registrationCategories, setRegistrationCategories] = useState<string[]>([]);
  const [registrationCategoriesOpen, setRegistrationCategoriesOpen] = useState(false);
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const [registrationError, setRegistrationError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registrationCompleted, setRegistrationCompleted] = useState(false);
  const registrationNameRef = useRef('');
  const registrationContactRef = useRef('');
  const registrationEmailRef = useRef('');
  const registrationCategoriesRef = useRef<string[]>([]);
  const [skipCountdown, setSkipCountdown] = useState(5);
  const [bloggerInfoData, setBloggerInfoData] = useState<{ title: string; html: string } | null>(null);
  const [infoPagePosts, setInfoPagePosts] = useState<Post[]>([]);
  const [infoPagePostsLoading, setInfoPagePostsLoading] = useState(false);
  const [detailPagePosts, setDetailPagePosts] = useState<Post[]>([]);
  const [detailPagePostsLoading, setDetailPagePostsLoading] = useState(false);
  const [bloggerCategories, setBloggerCategories] = useState<string[]>([]);
  const [bloggerTags, setBloggerTags] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [nearbyPosts, setNearbyPosts] = useState<Post[]>([]);
  const [nearbyPreloaderOpen, setNearbyPreloaderOpen] = useState(false);
  const [nearbyPreloaderProgress, setNearbyPreloaderProgress] = useState(0);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);
  const [locationServicesEnabled, setLocationServicesEnabled] = useState(true);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const locationAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationAutoStartedRef = useRef(false);
  const locationPromptSnoozeUntilRef = useRef(0);
  const locationPermissionRequestActiveRef = useRef(false);
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
  const [localOffersDisabled, setLocalOffersDisabled] = useState(false);
  const [localOfferEmptyOpen, setLocalOfferEmptyOpen] = useState(false);
  const [localOfferEmptyCountdown, setLocalOfferEmptyCountdown] = useState(5);
  const mainListRef = useRef<FlatList<Post>>(null);
  const nearbyCacheRef = useRef<{ key: string; savedAt: number; posts: Post[] } | null>(null);
  const nearbyPreloaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyPreloaderFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyPreloaderOpenRef = useRef(false);
  const nearbyPreloaderTimedOutRef = useRef(false);
  const nearbyPreloaderSpin = useRef(new Animated.Value(0)).current;
  const [locationTerms, setLocationTerms] = useState<string[]>([]);
  const searchInputRef = useRef<TextInput>(null);
  const tagScrollRef = useRef<ScrollView>(null);
  const tagOffsetRef = useRef(0);
  const tagContentWidthRef = useRef(0);
  const tagPauseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagPausedRef = useRef(false);
  const menuAnim = useRef(new Animated.Value(-320)).current;
  const bottomTabResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const loadPosts = useCallback(async (search = '', pageNumber = 1) => {
    try {
      setError('');
      if (!search) setLoading(true);
      else setSearching(true);
      const startIndex = (pageNumber - 1) * PAGE_SIZE + 1;
      const cached = getCachedFeed(search, startIndex);

      if (cached) {
        setPosts(cached);
        setPage(pageNumber);
        setLoading(false);
        setSearching(false);
        setRefreshing(false);

        void fetchFeedFromNetwork(search, startIndex).catch(() => {});

        if (cached.length === PAGE_SIZE) {
          void prefetchFeed(search, pageNumber + 1);
        }
        return;
      }

      const result = await fetchFeedFromNetwork(search, startIndex);
      setPosts(result);
      setPage(pageNumber);

      if (result.length === PAGE_SIZE) {
        void prefetchFeed(search, pageNumber + 1);
      }
    } catch {
      setError('Could not load the latest offers. Please try again.');
    } finally {
      setLoading(false);
      setSearching(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (registrationOpen) return;

    let cancelled = false;

    const locationAliases: Record<string, string[]> = {
      belagavi: ['belagavi', 'belgaum', 'belgaon', 'belagavi district', 'belgaum district'],
      belgaum: ['belagavi', 'belgaum', 'belgaon', 'belagavi district', 'belgaum district'],
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

    const matchesNearbyOffer = (
      post: Post,
      coords: { latitude: number; longitude: number },
      detectedLocationTerms: string[],
    ) => {
      const normalizedLabels = post.labels.map(label => normalizeLocationText(label));
      const hasLocalOfferTag = normalizedLabels.some(label =>
        label.includes('local offers')
        || label.includes('stores')
        || label.includes('offline offer'),
      );

      if (!hasLocalOfferTag) return false;

      const contentText = normalizeLocationText(post.content || post.rawContent || '');
      const titleText = normalizeLocationText(post.title);
      const tagText = normalizedLabels.join(' ');
      const offerText = [titleText, contentText, tagText].join(' ');

      const locationMatch = detectedLocationTerms.some(term => {
        const normalizedTerm = normalizeLocationText(term);
        if (!normalizedTerm) return false;
        return offerText.includes(normalizedTerm);
      });

      const postLocation = extractMapCoordinates(post.rawContent);
      const distanceMatch = postLocation
        ? distanceKm(coords, postLocation) <= NEARBY_RADIUS_KM
        : false;

      return locationMatch || distanceMatch;
    };

    const loadNearbyOffers = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          if (!cancelled) {
            setUserLocation(null);
            setLocationLabel('');
            setLocationTerms([]);
            setNearbyPosts([]);
            setLocalOffersDisabled(false);
          }
          return;
        }

        // Do not call the location API while device Location Services are OFF.
        // This prevents Android from showing its own location prompt repeatedly.
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!cancelled) setLocationServicesEnabled(servicesEnabled);
        if (!servicesEnabled) {
          if (!cancelled) {
            setUserLocation(null);
            setLocationLabel('');
            setLocationTerms([]);
            setNearbyPosts([]);
            setLocalOffersDisabled(false);
          }
          return;
        }

        const current = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
          requiredAccuracy: 5000,
        }) || await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (cancelled) return;

        const coords = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
        setUserLocation(coords);

        let detectedLocationTerms: string[] = [];
        let detectedLocationLabel = '';

        try {
          const places = await Location.reverseGeocodeAsync(coords);
          const place = places?.[0];
          detectedLocationLabel = place?.district || place?.city || place?.subregion || place?.region || '';
          detectedLocationTerms = buildLocationTerms(place);

          if (detectedLocationLabel && /belagavi|belgaum|belgaon/i.test(detectedLocationLabel)) {
            detectedLocationTerms = Array.from(new Set([
              ...detectedLocationTerms,
              'belagavi',
              'belgaum',
              'belgaon',
              'belagavi district',
              'belgaum district',
            ]));
          }

          if (!cancelled) {
            setLocationLabel(detectedLocationLabel);
            setLocationTerms(detectedLocationTerms);
          }
        } catch {
          if (!cancelled) {
            setLocationLabel('');
            setLocationTerms([]);
          }
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
          }
          finishNearbyPreloader();
          return;
        }

        const allPosts = await getAllPostsForNearby();

        const matches = allPosts.filter(post =>
          matchesNearbyOffer(post, coords, detectedLocationTerms)
        );

        nearbyCacheRef.current = {
          key: nearbyCacheKey,
          savedAt: Date.now(),
          posts: matches,
        };

        if (!cancelled) {
          setNearbyPosts(matches);
          setLocalOffersDisabled(matches.length === 0);
          if (bottomTab === 'local') {
            if (matches.length === 0) {
              setLocalOfferEmptyCountdown(5);
              setLocalOfferEmptyOpen(true);
            } else {
              setLocalOfferEmptyOpen(false);
            }
          }
        }

        finishNearbyPreloader();
      } catch {
        if (!cancelled) {
          setNearbyPosts([]);
          setLocalOffersDisabled(true);
          if (bottomTab === 'local') {
            setLocalOfferEmptyCountdown(5);
            setLocalOfferEmptyOpen(true);
          }
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
      value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

    const matchesNearbyOfferForPolling = (
      post: Post,
      coords: { latitude: number; longitude: number },
      detectedLocationTerms: string[],
    ) => {
      const normalizedLabels = post.labels.map(label => normalizeLocationTextForPolling(label));
      const hasLocalOfferTag = normalizedLabels.some(label =>
        label.includes('local offers')
        || label.includes('stores')
        || label.includes('offline offer'),
      );

      if (!hasLocalOfferTag) return false;

      const contentText = normalizeLocationTextForPolling(post.content || post.rawContent || '');
      const titleText = normalizeLocationTextForPolling(post.title);
      const tagText = normalizedLabels.join(' ');
      const offerText = [titleText, contentText, tagText].join(' ');

      const locationMatch = detectedLocationTerms.some(term => {
        const normalizedTerm = normalizeLocationTextForPolling(term);
        if (!normalizedTerm) return false;
        return offerText.includes(normalizedTerm);
      });

      const postLocation = extractMapCoordinates(post.rawContent);
      const distanceMatch = postLocation
        ? distanceKm(coords, postLocation) <= NEARBY_RADIUS_KM
        : false;

      return locationMatch || distanceMatch;
    };

    const checkForNewNearbyPosts = async () => {
      try {
        const latestPosts = await fetchFeedFromNetwork('', 1);
        if (cancelled) return;

        const currentNearbyPosts = nearbyCacheRef.current?.posts || nearbyPosts;
        const existingIds = new Set(currentNearbyPosts.map(post => post.id));

        const newMatches = latestPosts.filter(post => {
          if (existingIds.has(post.id)) return false;

          return matchesNearbyOfferForPolling(post, userLocation, locationTerms);
        });

        if (!newMatches.length || cancelled) return;

        setNearbyPosts(current => {
          const ids = new Set(current.map(post => post.id));
          const additions = newMatches.filter(post => !ids.has(post.id));
          if (!additions.length) return current;

          const merged = [...additions, ...current];
          const cached = nearbyCacheRef.current;

          if (cached) {
            nearbyCacheRef.current = {
              ...cached,
              posts: merged,
            };
          }

          setLocalOffersDisabled(false);
          setLocalOfferEmptyOpen(false);
          return merged;
        });
      } catch {
        // New-post polling is best-effort and must never interrupt the UI.
      }
    };

    const interval = setInterval(
      checkForNewNearbyPosts,
      NEARBY_NEW_POST_CHECK_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [registrationOpen, userLocation, locationTerms, nearbyPosts]);

  useEffect((): void | (() => void) => {
    if (registrationOpen || locationAutoStartedRef.current) {
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

          if (!wasLocationReady) {
            startNearbyPreloader();
            setLocationRefreshKey(value => value + 1);
          }
          return;
        }

        locationReadyRef.current = false;

        // User chose "No": stay silent for 5 minutes.
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

    showLocationPromptIfNeeded();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        showLocationPromptIfNeeded();
      }
    });

    // Keep checking silently while the app remains open so turning Location
    // OFF is detected without requiring the user to leave and reopen the app.
    const locationCheckInterval = setInterval(
      showLocationPromptIfNeeded,
      1000
    );

    return () => {
      if (locationAutoTimerRef.current) {
        clearTimeout(locationAutoTimerRef.current);
        locationAutoTimerRef.current = null;
      }
      clearInterval(locationCheckInterval);
      subscription.remove();
    };
  }, [registrationOpen, startNearbyPreloader]);

  useEffect(() => {
    let cancelled = false;

    const syncBloggerCategories = async () => {
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

        if (!cancelled) {
          setBloggerCategories(categories);
          setBloggerTags(categories);
        }
      } catch {
        // Keep fallback categories/tags when Blogger is temporarily unavailable.
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

    const syncNow = () => {
      const activeSearch = query.trim().length >= 1 ? query.trim() : '';
      loadPosts(activeSearch, page);
    };

    const interval = setInterval(syncNow, MAIN_AUTO_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') syncNow();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [registrationOpen, query, page, loadPosts]);

  useEffect(() => {
    if (!registrationOpen || registrationCompleted) return;
    setSkipCountdown(5);
    const timer = setInterval(() => {
      setSkipCountdown(current => {
        if (current <= 1) {
          clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [registrationOpen, registrationCompleted]);

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

      if (normalizedQuery.length < 2) {
        setSuggestions([]);
        return;
      }

      const scoreSuggestion = (post: Post) => {
        const title = post.title.toLowerCase();
        const label = post.label.toLowerCase();
        const labels = post.labels.join(' ').toLowerCase();
        const content = post.content.toLowerCase();

        let score = 0;

        if (title === normalizedQuery) score += 1000;
        if (title.startsWith(normalizedQuery)) score += 500;
        if (title.includes(normalizedQuery)) score += 300;
        if (label === normalizedQuery) score += 250;
        if (label.includes(normalizedQuery)) score += 180;
        if (labels.includes(normalizedQuery)) score += 140;
        if (content.includes(normalizedQuery)) score += 80;

        const words = normalizedQuery.split(' ').filter(Boolean);
        const matchedWords = words.filter(word =>
          title.includes(word) ||
          label.includes(word) ||
          labels.includes(word) ||
          content.includes(word)
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

        if (combined.length < 6) {
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
    }, 250);

    return () => clearTimeout(timer);
  }, [query, posts, loadPosts]);

  const pauseTagAutoScroll = useCallback(() => {
    tagPausedRef.current = true;
    if (tagPauseRef.current) clearTimeout(tagPauseRef.current);
    tagPauseRef.current = setTimeout(() => {
      tagPausedRef.current = false;
    }, 4500);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (tagPausedRef.current || !tagContentWidthRef.current) return;
      const loopWidth = tagContentWidthRef.current / 2;
      let next = tagOffsetRef.current + 1;
      if (next >= loopWidth) next = 0;
      tagOffsetRef.current = next;
      tagScrollRef.current?.scrollTo({ x: next, animated: false });
    }, 28);
    return () => {
      clearInterval(timer);
      if (tagPauseRef.current) clearTimeout(tagPauseRef.current);
    };
  }, []);

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
      setRefreshing(false);
    }
  };

  const toggleFavorite = (post: Post) => {
    setFavorites(current => current.some(item => item.id === post.id)
      ? current.filter(item => item.id !== post.id)
      : [...current, post]);
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
        title: 'Share OfferHaikya post',
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

  const refresh = () => {
    setRefreshing(true);
    loadPosts(query.trim().length >= 3 ? query : '', page);
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

  const goToPage = (nextPage: number) => {
    if (nextPage < 1) return;
    loadPosts(query.trim().length >= 3 ? query : '', nextPage);
  };

  const submitRegistration = async () => {
    const registrationData = {
      type: 'registration',
      name: registrationName.trim(),
      contact: registrationContact.trim() ? '91' + registrationContact.trim() : '',
      email: registrationEmail.trim().toLowerCase(),
      interestedCategories: registrationCategories.join(', '),
      submittedAt: new Date().toISOString(),
    };

    if (!/^[A-Za-z ]{3,12}$/.test(registrationData.name)) {
      setRegistrationError('Name must be 3-12 letters.');
      return;
    }

    if (
      registrationData.contact &&
      !/^91\d{10}$/.test(registrationData.contact)
    ) {
      setRegistrationError('Enter a valid 10-digit Indian phone number.');
      return;
    }

    if (
      registrationData.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registrationData.email)
    ) {
      setRegistrationError('Enter a valid email address.');
      return;
    }

    if (!registrationData.contact && !registrationData.email) {
      setRegistrationError('Please enter a phone number or email address.');
      return;
    }

    if (!registrationData.interestedCategories) {
      setRegistrationError('Please select at least one interested category.');
      return;
    }

    try {
      setRegistrationSubmitting(true);
      setRegistrationSuccess(false);
      setRegistrationError('');

      const registrationUrl =
        REGISTRATION_URL +
        '?type=' + encodeURIComponent(registrationData.type) +
        '&name=' + encodeURIComponent(registrationData.name) +
        '&contact=' + encodeURIComponent(registrationData.contact) +
        '&email=' + encodeURIComponent(registrationData.email) +
        '&interestedCategories=' + encodeURIComponent(registrationData.interestedCategories);

      const response = await fetch(registrationUrl, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Registration failed');
      }

      const responseData = await response.json();

      if (!responseData?.success) {
        throw new Error(
          responseData?.error || 'Registration failed'
        );
      }

      setRegistrationSubmitting(false);
      setRegistrationSuccess(true);
      setRegistrationCompleted(true);

      setTimeout(() => {
        setRegistrationOpen(false);
        setRegistrationSuccess(false);
        setRegistrationName('');
        setRegistrationContact('');
        setRegistrationEmail('');
        setRegistrationCategories([]);
        setRegistrationCategoriesOpen(false);
      }, 1600);
    } catch {
      setRegistrationError('Could not submit registration. Please try again.');
      setRegistrationSubmitting(false);
    }
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
          await IntentLauncher.startActivityAsync(
            IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS
          );
        } else {
          setLocationRefreshKey(value => value + 1);
        }
        return;
      }

      // If device Location is OFF, guide the user to Settings instead of
      // repeatedly triggering the OS permission dialog.
      if (!servicesEnabled) {
        await Linking.openSettings();
        return;
      }

      if (currentPermission.canAskAgain === false) {
        await Linking.openSettings();
        return;
      }

      locationPermissionRequestActiveRef.current = true;

      const permission = await Location.requestForegroundPermissionsAsync();

      locationPermissionRequestActiveRef.current = false;

      if (permission.status === 'granted') {
        locationPromptSnoozeUntilRef.current = 0;
        startNearbyPreloader();
        setLocationRefreshKey(value => value + 1);
      } else {
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

  const goToHomeTab = () => {
    closeMenu();
    setDetail(null);
    setInfoPage(null);
    activateBottomTabFor5Sec('home');
    setActiveLabel('All');
    setQuery('');
    setSuggestions([]);
    setPage(1);
    loadPosts('', 1);
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

  const goToLocalOffersTab = async () => {
    if (localOffersDisabled) return;

    closeMenu();
    setDetail(null);
    setInfoPage(null);
    activateBottomTabFor5Sec('local');
    setActiveLabel('All');
    setQuery('');
    setSuggestions([]);
    setPage(1);
    loadPosts('', 1);
    mainListRef.current?.scrollToOffset({ offset: 0, animated: true });

    try {
      const permission = await Location.getForegroundPermissionsAsync();
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (permission.status === 'granted' && servicesEnabled) {
        setLocationRefreshKey(value => value + 1);
      } else if (permission.canAskAgain !== false || !servicesEnabled) {
        setLocationPromptOpen(true);
      }
    } catch {
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
    setLocalOfferEmptyCountdown(5);
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
      const response = await fetch(REGISTRATION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          type: 'offer_request',
          name,
          contact: '91' + contact,
          offerRequest: request,
          submittedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error('Request failed');

      setOfferRequestSubmitting(false);
      setOfferRequestSuccess(true);

      setTimeout(() => {
        setOfferRequestOpen(false);
        setOfferRequestSuccess(false);
        setOfferRequestName('');
        setOfferRequestContact('');
        setOfferRequestText('');
      }, 900);
    } catch {
      setOfferRequestError('Could not send the request. Please try again.');
      setOfferRequestSubmitting(false);
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
            <Text style={styles.fallbackText}>OfferHaikya</Text>
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
    if (!localOfferEmptyOpen) return;

    setLocalOfferEmptyCountdown(5);
    const timer = setInterval(() => {
      setLocalOfferEmptyCountdown(current => {
        if (current <= 1) {
          clearInterval(timer);
          setLocalOfferEmptyOpen(false);
          return 5;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [localOfferEmptyOpen]);

  useEffect(() => {
    if (!infoPage) {
      setBloggerInfoData(null);
      setInfoPagePosts([]);
      setInfoPagePostsLoading(false);
      return;
    }

    let cancelled = false;

    const loadInfoPagePosts = async () => {
      try {
        if (!cancelled) setInfoPagePostsLoading(true);
        const latestPosts = await getFeed('', 1);
        if (!cancelled) setInfoPagePosts(latestPosts);
      } catch {
        if (!cancelled) setInfoPagePosts([]);
      } finally {
        if (!cancelled) setInfoPagePostsLoading(false);
      }
    };

    loadInfoPagePosts();
    const slugs: Record<string, string> = {
      about: 'about-us',
      contact: 'contact-us',
      privacy: 'privacy-policy',
      terms: 'terms-and-condition',
    };

    const loadBloggerInfoPage = async () => {
      try {
        const response = await fetch(BLOG_URL + '/p/' + slugs[infoPage] + '.html');
        if (!response.ok) throw new Error('Unable to load Blogger page');
        const html = await response.text();
        const bodyMatch = html.match(/<div[^>]*class=["'][^"']*post-body[^"']*["'][^>]*>([\s\S]*?)(?:<div[^>]*class=["'][^"']*post-footer|<\/article|<\/main)/i);
        const pageHtml = (bodyMatch?.[1] || '').trim();
        if (!pageHtml) return;
        const cleanPageHtml = pageHtml.replace(/<img\b[^>]*>/gi, '');
        if (!cancelled) {
          setBloggerInfoData({
            title: infoPage === 'about' ? 'About Us' : infoPage === 'contact' ? 'Contact Us' : infoPage === 'privacy' ? 'Privacy Policy' : 'Terms and Condition',
            html: cleanPageHtml,
          });
        }
      } catch {
        if (!cancelled) setBloggerInfoData(null);
      }
    };

    loadBloggerInfoPage();

    const interval = setInterval(loadBloggerInfoPage, METADATA_AUTO_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') loadBloggerInfoPage();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, [infoPage]);

  useEffect(() => {
    if (!detail) {
      setDetailPagePosts([]);
      setDetailPagePostsLoading(false);
      return;
    }

    let cancelled = false;

    const loadDetailPagePosts = async () => {
      try {
        if (!cancelled) setDetailPagePostsLoading(true);
        const latestPosts = await getFeed('', 1);
        if (!cancelled) setDetailPagePosts(latestPosts);
      } catch {
        if (!cancelled) setDetailPagePosts([]);
      } finally {
        if (!cancelled) setDetailPagePostsLoading(false);
      }
    };

    loadDetailPagePosts();

    return () => {
      cancelled = true;
    };
  }, [detail]);

  if (infoPage) {
    const infoTitles = {
      about: 'About Us',
      contact: 'Contact Us',
      privacy: 'Privacy Policy',
      terms: 'Terms and Condition',
    };
    const infoPostsSource = infoPagePosts.length > 0 ? infoPagePosts : posts;
    const suggestedInfoPosts = infoPostsSource.slice(0, 4);
    const latestBlogPosts = infoPostsSource.slice(0, 8);

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
              tagsStyles={{
                body: { color: darkMode ? '#eeeeee' : '#4f4c52', fontSize: 15, lineHeight: 26 },
                p: { marginTop: 0, marginBottom: 8, lineHeight: 24, color: darkMode ? '#eeeeee' : '#4f4c52' },
                h1: { color: darkMode ? WHITE : TEXT, fontSize: 27, lineHeight: 35, fontWeight: '900', marginTop: 8, marginBottom: 8 },
                h2: { color: darkMode ? WHITE : TEXT, fontSize: 23, lineHeight: 31, fontWeight: '900', marginTop: 12, marginBottom: 7 },
                h3: { color: darkMode ? WHITE : TEXT, fontSize: 19, lineHeight: 27, fontWeight: '900', marginTop: 10, marginBottom: 6 },
                li: { color: darkMode ? '#eeeeee' : '#4f4c52', fontSize: 15, lineHeight: 24 },
                a: { color: ACCENT },
              }}
            />
          ) : (
            <View style={styles.state}>
              <ActivityIndicator size="large" color={ACCENT} />
              <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>Loading page...</Text>
            </View>
          )}

          <View style={styles.infoBottomRecommendations}>
<View style={styles.infoRecommendationSection}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Suggested Posts</Text>
              <Text style={[styles.pageText, darkMode && styles.darkMutedText]}>For you</Text>
            </View>

            {infoPagePostsLoading && infoPostsSource.length === 0 ? (
              <View style={styles.state}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>Loading suggested posts...</Text>
              </View>
            ) : infoPostsSource.length > 0 ? (
              <View>
                {Array.from({ length: Math.ceil(suggestedInfoPosts.length / 2) }).map((_, rowIndex) => (
                  <View style={styles.row} key={'suggested-row-' + rowIndex}>
                    {suggestedInfoPosts.slice(rowIndex * 2, rowIndex * 2 + 2).map(item => renderPost({ item }))}
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.state}>
                <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>No suggested posts available right now.</Text>
              </View>
            )}
          </View>

          <View style={styles.infoRecommendationSection}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Latest Posts</Text>
              <Text style={[styles.pageText, darkMode && styles.darkMutedText]}>Latest</Text>
            </View>

            {infoPagePostsLoading && infoPostsSource.length === 0 ? (
              <View style={styles.state}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={[styles.stateText, darkMode && styles.darkMutedText]}>Loading latest posts...</Text>
              </View>
            ) : infoPostsSource.length > 0 ? (
              <View>
                {Array.from({ length: Math.ceil(latestBlogPosts.length / 2) }).map((_, rowIndex) => (
                  <View style={styles.row} key={'latest-blog-row-' + rowIndex}>
                    {latestBlogPosts.slice(rowIndex * 2, rowIndex * 2 + 2).map(item => renderPost({ item }))}
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
        </ScrollView>

        <View style={[styles.bottomNav, darkMode && styles.bottomNavDark]}>
          <TouchableOpacity
            style={styles.infoBottomNavItem}
            onPress={goToHomeTab}
            accessibilityLabel="Home"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M3 10.5L12 3L21 10.5V21H14.5V14H9.5V21H3V10.5Z"
                stroke={localOffersDisabled ? '#b8b8b8' : MUTED}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={[styles.infoBottomNavLabel, darkMode && styles.bottomNavLabelDark]}>
              Home
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.infoBottomNavItem, localOffersDisabled && styles.bottomNavItemDisabled]}
            onPress={goToLocalOffersTab}
            disabled={localOffersDisabled}
            accessibilityLabel="Local offers"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5A8 8 0 1 1 20 10.5Z"
                stroke={localOffersDisabled ? '#b8b8b8' : MUTED}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M12 13.25A2.75 2.75 0 1 0 12 7.75A2.75 2.75 0 0 0 12 13.25Z"
                stroke={MUTED}
                strokeWidth={2}
              />
            </Svg>
            <Text style={[styles.infoBottomNavLabel, localOffersDisabled && styles.bottomNavLabelDisabled, darkMode && styles.bottomNavLabelDark]}>
              Local Offers
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomNavItem, bottomTab === 'hot' && styles.bottomNavItemActive]}
            onPress={goToHotOffersTab}
            accessibilityLabel="Hot Offers"
          >
            <Text style={[styles.bottomNavPercentIcon, bottomTab === 'hot' && styles.bottomNavPercentIconActive]}>%</Text>
            <Text style={[styles.bottomNavLabel, bottomTab === 'hot' && styles.bottomNavLabelActive, darkMode && styles.bottomNavLabelDark]}>
              Hot Offers
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.infoBottomNavItem}
            onPress={openOfferRequestTab}
            accessibilityLabel="Request offer"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 5.5H20V18.5H4V5.5Z"
                stroke={MUTED}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <Path
                d="M4.5 6L12 12L19.5 6"
                stroke={MUTED}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text
              style={[styles.infoBottomNavLabel, darkMode && styles.bottomNavLabelDark]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              Request Offer
            </Text>
          </TouchableOpacity>


          <TouchableOpacity
            style={styles.infoBottomNavItem}
            onPress={goToSearchTab}
            accessibilityLabel="Search"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M11 18A7 7 0 1 0 11 4A7 7 0 0 0 11 18Z"
                stroke={TEXT}
                strokeWidth={2}
              />
              <Path
                d="M16.5 16.5L21 21"
                stroke={TEXT}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            <Text style={styles.infoBottomNavLabel}>Search</Text>
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
              <TouchableOpacity
                style={styles.detailShareRow}
                onPress={() => openShareOptions(detail.url)}
                accessibilityLabel="Share post"
              >
                <Text style={styles.detailShareText}>Share</Text>
              </TouchableOpacity>
            </View>
            <RenderHTML
              ignoredDomTags={['iframe']}
              contentWidth={Math.max(320, width - 40)}
              source={{ html: detail.rawContent || `<p>${detail.content || detail.excerpt}</p>` }}
              tagsStyles={{
                body: { color: darkMode ? '#eeeeee' : '#4f4c52', fontSize: 15, lineHeight: 26 },
                p: { marginTop: 0, marginBottom: 8, lineHeight: 24, color: darkMode ? '#eeeeee' : '#4f4c52' },
                h1: { color: darkMode ? WHITE : TEXT, fontSize: 27, lineHeight: 35, fontWeight: '900', marginTop: 10, marginBottom: 8 },
                h2: { color: darkMode ? WHITE : TEXT, fontSize: 23, lineHeight: 31, fontWeight: '900', marginTop: 12, marginBottom: 7 },
                h3: { color: darkMode ? WHITE : TEXT, fontSize: 19, lineHeight: 27, fontWeight: '800', marginTop: 10, marginBottom: 6 },
                li: { marginBottom: 3, lineHeight: 24 },
                a: { color: ACCENT },
                strong: { fontWeight: '900' },
                em: { fontStyle: 'italic' },
                table: { width: '100%' },
                th: { padding: 7, fontWeight: '900' },
                td: { padding: 7 },
              }}
            />
            {mapCoordinates ? (
              <View style={styles.mapSection}>
                <Text style={[styles.mapTitle, darkMode && styles.darkText]}>Location</Text>
                <MapView
                  style={styles.mapView}
                  initialRegion={{
                    ...mapCoordinates,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                >
                  <Marker coordinate={mapCoordinates} title="OfferHaikya location" />
                </MapView>
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
        contentContainerStyle={{ paddingBottom: 104 }}
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
            style={[
              styles.bottomNavItem,
              bottomTab === 'local' && styles.bottomNavItemActive,
              localOffersDisabled && styles.bottomNavItemDisabled,
            ]}
            onPress={goToLocalOffersTab}
            disabled={localOffersDisabled}
            accessibilityLabel="Local offers"
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path
                d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5A8 8 0 1 1 20 10.5Z"
                stroke={localOffersDisabled ? '#b8b8b8' : bottomTab === 'local' ? ACCENT : TEXT}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M12 13.25A2.75 2.75 0 1 0 12 7.75A2.75 2.75 0 0 0 12 13.25Z"
                stroke={localOffersDisabled ? '#b8b8b8' : bottomTab === 'local' ? ACCENT : TEXT}
                strokeWidth={2}
              />
            </Svg>
            <Text style={[styles.bottomNavLabel, bottomTab === 'local' && styles.bottomNavLabelActive, localOffersDisabled && styles.bottomNavLabelDisabled, darkMode && styles.bottomNavLabelDark]}>
              Local Offers
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

        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, darkMode && styles.darkSafe]}>
      {registrationOpen && (
        <View style={styles.registrationOverlay}>
          <View style={styles.registrationPopup}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.registrationFormContent}
            >
              <Text style={styles.registrationTitle}>Welcome to OfferHaikya 👋</Text>
              <Text style={styles.registrationSubtitle}>
                Enter your details and choose your interests.
              </Text>

              <TextInput
                value={registrationName}
              onChangeText={value => {
                const nameValue = value.replace(/[^A-Za-z ]/g, '').slice(0, 12);
                registrationNameRef.current = nameValue;
                setRegistrationName(nameValue);
              }}
              placeholder="Name *"
              placeholderTextColor="#99969c"
              style={styles.registrationInput}
              autoCapitalize="words"
              maxLength={12}
              editable={!registrationSubmitting}
            />
            <View style={styles.phoneInputWrap}>
              <Text style={styles.phonePrefix}>+91</Text>
              <TextInput
                value={registrationContact}
                onChangeText={value => {
                  const digits = value.replace(/\D/g, '').slice(0, 10);
                  registrationContactRef.current = digits;
                  setRegistrationContact(digits);
                }}
                placeholder="10-digit phone number *"
                placeholderTextColor="#99969c"
                style={styles.phoneInput}
                keyboardType="phone-pad"
                maxLength={10}
                editable={!registrationSubmitting}
              />
            </View>

            <Text style={{ color: MUTED, fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: -3, marginBottom: 8 }}>
              OR
            </Text>

            <TextInput
              value={registrationEmail}
              onChangeText={value => {
                const emailValue = value.slice(0, 80);
                registrationEmailRef.current = emailValue;
                setRegistrationEmail(emailValue);
              }}
              placeholder="Email Address"
              placeholderTextColor="#99969c"
              style={styles.registrationInput}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={80}
              editable={!registrationSubmitting}
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
                  showsVerticalScrollIndicator={true}
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

            {registrationError ? (
              <Text style={styles.registrationError}>{registrationError}</Text>
            ) : null}
            {registrationSuccess ? (
              <Text style={styles.registrationSuccess}>Form received successfully ✓</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.registrationButton, registrationSubmitting && styles.disabledButton]}
              onPress={submitRegistration}
              disabled={registrationSubmitting || registrationSuccess}
            >
              {registrationSubmitting ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : (
                <Text style={styles.registrationButtonText}>Continue</Text>
              )}
            </TouchableOpacity>
              {skipCountdown > 0 ? (
                <Text style={styles.registrationWaitText}>Skip in {skipCountdown}…</Text>
              ) : (
                <TouchableOpacity
                  style={styles.registrationSkipButton}
                  onPress={() => setRegistrationOpen(false)}
                  disabled={registrationSubmitting}
                >
                  <Text style={styles.registrationSkipText}>Skip for now</Text>
                </TouchableOpacity>
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
            setPage(1);
            loadPosts('', 1);
          }}
          accessibilityLabel="Go to home"
        >
          <Image
            source={{ uri: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png' }}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => setDarkMode(value => !value)}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>{darkMode ? '☀' : '☾'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => setWishlistOpen(true)}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>♡</Text>
            {favorites.length > 0 ? (
              <View style={styles.favoriteBadge}>
                <Text style={styles.favoriteBadgeText}>{favorites.length}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => searchInputRef.current?.focus()}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>⌕</Text>
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
                  {(bloggerCategories.length > 0 ? bloggerCategories : CATEGORY_ITEMS).map(label => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.menuSubItem, activeLabel === label && styles.menuItemActiveBg]}
                      onPress={() => {
                        setActiveLabel(label);
                        loadPosts(label, 1);
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
                  {SPECIAL_DEAL_ITEMS.map(label => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.menuSubItem, activeLabel === label && styles.menuItemActiveBg]}
                      onPress={() => {
                        setActiveLabel(label);
                        loadPosts(label, 1);
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

      <View style={darkMode ? styles.darkPage : styles.pageWrap}>
        <View style={styles.tagStrip}>
          <ScrollView
            ref={tagScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            onContentSizeChange={width => { tagContentWidthRef.current = width; }}
            onScroll={event => { tagOffsetRef.current = event.nativeEvent.contentOffset.x; }}
            onTouchStart={pauseTagAutoScroll}
            onMomentumScrollBegin={pauseTagAutoScroll}
            onScrollBeginDrag={pauseTagAutoScroll}
            scrollEventThrottle={16}
          >
            {[(bloggerTags.length > 0 ? bloggerTags : DIRECT_TAGS), (bloggerTags.length > 0 ? bloggerTags : DIRECT_TAGS)].flat().map((item, index) => (
              <TouchableOpacity
                key={item + '-' + index}
                onPress={() => {
                  pauseTagAutoScroll();
                  setActiveLabel(item);
                  loadPosts(item === 'All' ? '' : item, 1);
                }}
                style={[styles.chip, activeLabel === item && styles.activeChip]}
              >
                <Text style={styles.chipText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

      <FlatList
        ref={mainListRef}
        style={darkMode ? styles.listDark : undefined}
        extraData={darkMode}
        data={visiblePosts}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        renderItem={renderPost}
        numColumns={2}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, darkMode && styles.contentDark]}
        ListHeaderComponentStyle={darkMode ? styles.contentDark : undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          const activeSearch = query.trim().length >= 3 ? query.trim() : '';
          if (posts.length === PAGE_SIZE) {
            void prefetchFeed(activeSearch, page + 1);
          }
        }}
        ListHeaderComponent={
          <>
            <ImageBackground
              source={{ uri: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/5e10e76c-d5d4-40e6-9033-bf9720055ddf.jpg' }}
              style={styles.hero}
              imageStyle={styles.heroImage}
            >
              <Text style={styles.heroSmall}>LATEST DEALS & OFFERS</Text>
              <Text style={styles.heroTitle}>Find the best offers</Text>
              <Text style={styles.heroSubtitle}>New offers from OfferHaikya, updated automatically.</Text>
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
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>
                    Nearby Offers{locationLabel ? ' · ' + locationLabel : ''}
                  </Text>
                  {!locationServicesEnabled ? (
                    <TouchableOpacity
                      style={styles.nearbyRefreshButton}
                      onPress={() => setLocationPromptOpen(true)}
                      accessibilityLabel="Refresh Nearby location"
                    >
                      <Text style={[styles.nearbyRefreshText, darkMode && styles.darkText]}>↻</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View>
                  {Array.from({ length: Math.ceil(nearbyPosts.length / 2) }).map((_, rowIndex) => (
                    <View style={styles.row} key={'nearby-row-' + rowIndex}>
                      {nearbyPosts.slice(rowIndex * 2, rowIndex * 2 + 2).map(item => renderPost({ item }))}
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Latest Offers</Text>
              <Text style={[styles.pageText, darkMode && styles.darkMutedText]}>Page {page}</Text>
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
              <View style={styles.pagination}>
                <TouchableOpacity disabled={page === 1} onPress={() => goToPage(page - 1)} style={[styles.pageButton, page === 1 && styles.disabledButton]}>
                  <Text style={styles.pageButtonText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.pageNumber}>{page}</Text>
                <TouchableOpacity onPress={() => goToPage(page + 1)} style={styles.pageButton}>
                  <Text style={styles.pageButtonText}>›</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.footer}>
                <Text style={styles.footerBrand}>OfferHaikya</Text>
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
                  <TouchableOpacity onPress={() => openInfoPage('terms')}><Text style={[styles.footerLink, darkMode && styles.darkText]}>Terms and Condition</Text></TouchableOpacity>
                </View>
              </View>
            </>
          ) : null
        }
      />
      </View>
      <View style={[styles.bottomNav, darkMode && styles.bottomNavDark]}>
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
          style={[styles.bottomNavItem, bottomTab === 'local' && styles.bottomNavItemActive]}
          onPress={goToLocalOffersTab}
          accessibilityLabel="Local offers"
        >
          <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
            <Path
              d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5A8 8 0 1 1 20 10.5Z"
              stroke={bottomTab === 'local' ? ACCENT : TEXT}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M12 13.25A2.75 2.75 0 1 0 12 7.75A2.75 2.75 0 0 0 12 13.25Z"
              stroke={bottomTab === 'local' ? ACCENT : TEXT}
              strokeWidth={2}
            />
          </Svg>
          <Text style={[styles.bottomNavLabel, bottomTab === 'local' && styles.bottomNavLabelActive, darkMode && styles.bottomNavLabelDark]}>
            Local Offers
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomNavItem, bottomTab === 'hot' && styles.bottomNavItemActive]}
          onPress={goToHotOffersTab}
          accessibilityLabel="Hot Offers"
        >
          <Text style={[styles.bottomNavPercentIcon, bottomTab === 'hot' && styles.bottomNavPercentIconActive]}>%</Text>
          <Text style={[styles.bottomNavLabel, bottomTab === 'hot' && styles.bottomNavLabelActive, darkMode && styles.bottomNavLabelDark]}>
            Hot Offers
          </Text>
        </TouchableOpacity>

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
              No local offers found in your nearby area right now. Please check again later.
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
            <Text style={styles.locationPromptTitle}>OfferHaikya needs your location</Text>
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

    {favoritePopup}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE },
  darkSafe: { backgroundColor: '#000000' },
  pageWrap: { flex: 1, backgroundColor: PAGE },
  darkPage: { flex: 1, backgroundColor: '#000000' },
  contentDark: { backgroundColor: '#000000' },
  header: { height: 60, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dddddd' },
  headerDark: { backgroundColor: '#000000', borderBottomColor: '#2b2b2b' },
  headerIconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { fontSize: 22, color: TEXT },
  headerIconDark: { color: WHITE },
  headerLogo: { width: 170, height: 54, marginLeft: 25 },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' },
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
    sectionRow: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nearbyRefreshButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  nearbyRefreshText: { color: ACCENT, fontSize: 27, lineHeight: 30, fontWeight: '900' },
  sectionTitle: { color: TEXT, fontSize: 20, fontWeight: '900' },
  pageText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', paddingHorizontal: 10, justifyContent: 'space-between' },

  card: { width: '47.5%', marginHorizontal: 6, marginBottom: 14, backgroundColor: WHITE, borderRadius: 8, overflow: 'hidden', position: 'relative', elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  cardImage: { width: '100%', height: 125, backgroundColor: '#eeeeee' },
  cardHeart: { position: 'absolute', top: 8, right: 8, zIndex: 3, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  cardShare: { position: 'absolute', top: 48, right: 8, zIndex: 3, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  cardExpiry: { position: 'absolute', top: 8, left: 8, zIndex: 3, maxWidth: '62%', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)' },
  cardExpiryText: { color: ACCENT, fontSize: 9, fontWeight: '900' },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailShareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingLeft: 8 },
  detailShareText: { color: ACCENT, fontSize: 16, fontWeight: '900' },
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
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 18 },
  pageButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.35 },
  pageButtonText: { color: WHITE, fontSize: 24, fontWeight: '900' },
  pageNumber: { color: TEXT, fontSize: 15, fontWeight: '900' },
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
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 76, backgroundColor: WHITE, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dddddd', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 8, paddingTop: 7, paddingBottom: 7, zIndex: 140, elevation: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } },
  bottomNavDark: { backgroundColor: '#151515', borderTopColor: '#303030' },
  bottomNavItem: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginHorizontal: 4 },
  bottomNavPercentIcon: { color: TEXT, fontSize: 23, lineHeight: 23, fontWeight: '900' },
  bottomNavPercentIconActive: { color: ACCENT },
  infoBottomNavPercentIcon: { color: MUTED, fontSize: 23, lineHeight: 23, fontWeight: '900' },
  infoBottomNavItem: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginHorizontal: 4, backgroundColor: 'transparent' },
  infoBottomNavLabel: { color: MUTED, fontSize: 11, fontWeight: '800', marginTop: 4 },
  bottomNavItemActive: { backgroundColor: '#fff3ed' },
  bottomNavItemDisabled: { opacity: 0.5 },
  bottomNavLabelDisabled: { color: '#b8b8b8' },
  bottomNavLabel: { color: TEXT, fontSize: 11, fontWeight: '800', marginTop: 4 },
  bottomNavLabelActive: { color: ACCENT, fontWeight: '900' },
  bottomNavLabelDark: { color: '#eeeeee' },
  locationPromptOverlay: { ...StyleSheet.absoluteFill, zIndex: 280, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  nearbyPreloaderOverlay: { ...StyleSheet.absoluteFill, zIndex: 275, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  nearbyPreloaderCircle: { width: 118, height: 118, borderRadius: 59, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
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
  shareCancelButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  shareCancelText: { color: ACCENT, fontSize: 14, fontWeight: '900' },
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
  favoriteBadge: { position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#e31b23', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  favoriteBadgeText: { color: WHITE, fontSize: 9, fontWeight: '900' },
  registrationOverlay: { ...StyleSheet.absoluteFill, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  registrationTestOverlay: { ...StyleSheet.absoluteFill, zIndex: 340, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  registrationPopup: { width: '100%', maxHeight: '88%', backgroundColor: WHITE, borderRadius: 16, padding: 18 },
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
  registrationError: { color: '#d93025', fontSize: 12, fontWeight: '700', marginBottom: 10 },
  registrationSuccess: { color: '#168a3a', fontSize: 13, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  registrationButton: { minHeight: 48, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  registrationButtonText: { color: WHITE, fontSize: 14, fontWeight: '900' },
  registrationSkipButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  registrationSkipText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  registrationWaitText: { color: MUTED, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  footer: { alignItems: 'center', paddingVertical: 24 },
  footerBrand: { color: TEXT, fontSize: 16, fontWeight: '900' },
  footerText: { color: MUTED, fontSize: 12, marginTop: 4 },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 16, paddingHorizontal: 10 },
  footerLink: { color: TEXT, fontSize: 12, fontWeight: '800' },
  socialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 16 },
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
