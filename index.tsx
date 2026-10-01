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
} from 'react-native';
import RenderHTML from 'react-native-render-html';
import * as Location from 'expo-location';
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
const NEARBY_RADIUS_KM = 500;
const AUTO_SYNC_INTERVAL_MS = 30000;
const LOCATION_RETRY_MS = 5 * 60 * 1000;
const DIRECT_TAGS = ['All', 'News', 'Amazon', 'Flipkart', 'Myntra', 'Meesho', 'Instamart', 'Blinkit', 'Zepto', 'BigBasket Now', 'Snapdeal', 'Shopsy', 'Offline Offers', 'Online Offers'];
const CATEGORY_ITEMS = ['Fashion', 'Electronics', 'Home & Kitchen', 'Beauty & Personal Care', 'Grocery & Food', 'Baby & Kids', 'Sports & Fitness', 'Automotive', 'Pet Supplies', 'Books & Education', 'Gaming', 'Travel & Luggage', 'Jewellery & Accessories', 'Tools & Industrial'];
const SPECIAL_DEAL_ITEMS = ['₹1 Deals', 'Loot Deals', 'Flash Sales', "Today's Deals", 'Clearance Sale', 'Buy 1 Get 1', 'Under ₹99', 'Under ₹499', '50%+ Off', 'Coupon Codes', 'Bank Offers', 'Freebies'];
const REGISTRATION_URL = 'https://script.google.com/macros/s/AKfycbwCAekTZ2DAZSo7xiKdqQJD_lWzPyEA4aP2QYVCh0Jpn3BHLxJlXFp08P82BXdrAN2v/exec';

type Post = {
  id: string;
  title: string;
  url: string;
  date: string;
  label: string;
  labels: string[];
  image?: string;
  excerpt: string;
  content: string;
  rawContent: string;
};

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
    .replace(/\/s\d+(-c)?\//i, '/s1600/')
    .replace(/=w\d+(-h\d+)?(-p)?/i, '=s1600')
    .replace(/\/w\d+(-h\d+)?\//i, '/s1600/');
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
      label: labels[0] || 'Offers',
      labels,
      image: firstImage(content) || highResImage(entry.media$thumbnail?.url),
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
      content: stripHtml(content),
      rawContent: content,
    };
  });
};

const getFeed = async (query = '', startIndex = 1) => {
  const params = new URLSearchParams({
    alt: 'json',
    'max-results': String(PAGE_SIZE),
    'start-index': String(startIndex),
  });
  if (query.trim().length >= 1) params.set('q', query.trim());

  const response = await fetch(FEED_URL + '?' + params.toString());
  if (!response.ok) throw new Error('Unable to load posts');
  return parseFeed(await response.json());
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
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const [registrationError, setRegistrationError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registrationCompleted, setRegistrationCompleted] = useState(false);
  const [skipCountdown, setSkipCountdown] = useState(5);
  const [bloggerInfoData, setBloggerInfoData] = useState<{ title: string; html: string } | null>(null);
  const [bloggerCategories, setBloggerCategories] = useState<string[]>([]);
  const [bloggerTags, setBloggerTags] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [nearbyPosts, setNearbyPosts] = useState<Post[]>([]);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const locationAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationAutoStartedRef = useRef(false);
  const [offerRequestOpen, setOfferRequestOpen] = useState(false);
  const [offerRequestName, setOfferRequestName] = useState('');
  const [offerRequestContact, setOfferRequestContact] = useState('');
  const [offerRequestText, setOfferRequestText] = useState('');
  const [offerRequestSubmitting, setOfferRequestSubmitting] = useState(false);
  const [offerRequestSuccess, setOfferRequestSuccess] = useState(false);
  const [offerRequestError, setOfferRequestError] = useState('');
  const mainListRef = useRef<FlatList<Post>>(null);
  const [locationTerms, setLocationTerms] = useState<string[]>([]);
  const searchInputRef = useRef<TextInput>(null);
  const tagScrollRef = useRef<ScrollView>(null);
  const tagOffsetRef = useRef(0);
  const tagContentWidthRef = useRef(0);
  const tagPauseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagPausedRef = useRef(false);
  const menuAnim = useRef(new Animated.Value(-320)).current;

  const loadPosts = useCallback(async (search = '', pageNumber = 1) => {
    try {
      setError('');
      if (!search) setLoading(true);
      else setSearching(true);
      const result = await getFeed(search, (pageNumber - 1) * PAGE_SIZE + 1);
      setPosts(result);
      setPage(pageNumber);
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
        place?.city,
        place?.district,
        place?.subregion,
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

    const loadNearbyOffers = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          if (!cancelled) {
            setUserLocation(null);
            setLocationLabel('');
            setLocationTerms([]);
            setNearbyPosts([]);
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

        const allPosts = await getAllPostsForNearby();

        const matches = allPosts
          .map(post => {
            const normalizedLabels = post.labels.map(label => normalizeLocationText(label));
            const isLocalOffer = normalizedLabels.some(label =>
              label === 'offline offers'
              || label === 'offline offer'
              || label === 'local offers'
              || label === 'local offer'
              || label === 'local store',
            );

            if (!isLocalOffer) return null;

            const titleText = normalizeLocationText(post.title);
            const tagText = normalizedLabels.join(' ');

            const locationMatch = detectedLocationTerms.some(term => {
              const normalizedTerm = normalizeLocationText(term);
              if (!normalizedTerm) return false;

              const matchesTitle = titleText.includes(normalizedTerm);
              const matchesTags = tagText.includes(normalizedTerm);
              return matchesTitle || matchesTags;
            });

            const postLocation = extractMapCoordinates(post.rawContent);
            const distanceMatch = postLocation ? distanceKm(coords, postLocation) <= NEARBY_RADIUS_KM : false;

            if (!locationMatch && !distanceMatch) return null;

            return post;
          })
          .filter((post): post is Post => Boolean(post));

        if (!cancelled) setNearbyPosts(matches);
      } catch {
        if (!cancelled) setNearbyPosts([]);
      }
    };

    loadNearbyOffers();
    return () => { cancelled = true; };
  }, [registrationOpen, posts, locationRefreshKey]);

  useEffect(() => {
    if (registrationOpen || locationAutoStartedRef.current) return;

    locationAutoStartedRef.current = true;

    const showLocationPromptIfNeeded = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        const servicesEnabled = await Location.hasServicesEnabledAsync();

        // Everything is ready: do not ask.
        if (permission.status === 'granted' && servicesEnabled) return;

        // If the OS will no longer show a permission request and access is not
        // granted, stay quiet until the user explicitly uses the location button.
        if (permission.status !== 'granted' && permission.canAskAgain === false) return;

        // Ask once for this app session. A 5-minute retry is created only when
        // the user chooses No or the system permission request is denied.
        setLocationPromptOpen(true);
      } catch {
        // Stay silent if location services or permission state cannot be checked.
      }
    };

    showLocationPromptIfNeeded();

    return () => {
      if (locationAutoTimerRef.current) {
        clearTimeout(locationAutoTimerRef.current);
        locationAutoTimerRef.current = null;
      }
    };
  }, [registrationOpen]);

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

    const interval = setInterval(syncBloggerCategories, AUTO_SYNC_INTERVAL_MS);
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

    const interval = setInterval(syncNow, AUTO_SYNC_INTERVAL_MS);
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
    const timer = setTimeout(async () => {
      setActiveLabel('All');
      if (!text) {
        setSuggestions([]);
        loadPosts('', 1);
        return;
      }

      try {
        setSuggestionLoading(true);
        const result = await getFeed(text, 1);
        setSuggestions(result.slice(0, 6));
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestionLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, loadPosts]);

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
    () => activeLabel === 'All' ? posts : posts.filter(post => post.label === activeLabel),
    [posts, activeLabel],
  );

  const toggleFavorite = (post: Post) => {
    setFavorites(current => current.some(item => item.id === post.id)
      ? current.filter(item => item.id !== post.id)
      : [...current, post]);
  };

  const isFavorite = (post: Post) => favorites.some(item => item.id === post.id);

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
    const name = registrationName.trim();
    const contact = registrationContact.trim();

    if (!/^[A-Za-z ]{3,12}$/.test(name)) {
      setRegistrationError('Name must be 3-12 letters.');
      return;
    }

    if (!/^\d{10}$/.test(contact)) {
      setRegistrationError('Enter a valid 10-digit Indian phone number.');
      return;
    }

    try {
      setRegistrationSubmitting(true);
      setRegistrationError('');
      const response = await fetch(REGISTRATION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          type: 'registration',
          name,
          contact: '91' + contact,
          submittedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error('Registration failed');

      setRegistrationSuccess(true);
      setRegistrationCompleted(true);
      setRegistrationName('');
      setRegistrationContact('');
      setRegistrationError('');

      // Keep the popup visible long enough for the user to see the success message.
      setTimeout(() => {
        setRegistrationOpen(false);
        setRegistrationSuccess(false);
      }, 1600);
    } catch {
      setRegistrationError('Could not submit registration. Please try again.');
    } finally {
      setRegistrationSubmitting(false);
    }  };

  const scheduleLocationPromptRetry = () => {
    if (locationAutoTimerRef.current) {
      clearTimeout(locationAutoTimerRef.current);
    }

    locationAutoTimerRef.current = setTimeout(async () => {
      locationAutoTimerRef.current = null;

      try {
        const permission = await Location.getForegroundPermissionsAsync();
        const servicesEnabled = await Location.hasServicesEnabledAsync();

        if (permission.status === 'granted' && servicesEnabled) return;
        if (permission.status !== 'granted' && permission.canAskAgain === false) return;

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

    try {
      const currentPermission = await Location.getForegroundPermissionsAsync();
      const servicesEnabled = await Location.hasServicesEnabledAsync();

      if (currentPermission.status === 'granted') {
        if (!servicesEnabled) {
          await Linking.openSettings();
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

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status === 'granted') {
        setLocationRefreshKey(value => value + 1);
      } else {
        scheduleLocationPromptRetry();
      }
    } catch {
      scheduleLocationPromptRetry();
    }
  };

  const postponeLocationPrompt = () => {
    setLocationPromptOpen(false);
    scheduleLocationPromptRetry();
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
    <TouchableOpacity key={item.id} activeOpacity={0.92} style={[styles.card, darkMode && styles.cardDark]} onPress={() => openDetail(item)}>
      <TouchableOpacity style={styles.cardHeart} onPress={() => toggleFavorite(item)}>
        <Text style={styles.cardHeartText}>{isFavorite(item) ? '♥' : '♡'}</Text>
      </TouchableOpacity>
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
    if (!infoPage) {
      setBloggerInfoData(null);
      return;
    }

    let cancelled = false;
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

    const interval = setInterval(loadBloggerInfoPage, AUTO_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') loadBloggerInfoPage();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, [infoPage]);

  if (infoPage) {
    const infoTitles = {
      about: 'About Us',
      contact: 'Contact Us',
      privacy: 'Privacy Policy',
      terms: 'Terms and Condition',
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
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (detail) {
    const mapCoordinates = extractMapCoordinates(detail.rawContent);
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
            <Text style={[styles.detailDate, darkMode && styles.darkMutedText]}>{detail.date}</Text>
            <RenderHTML
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
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 30 }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, darkMode && styles.darkSafe]}>
      {registrationOpen && (
        <View style={styles.registrationOverlay}>
          <View style={styles.registrationPopup}>
            <Text style={styles.registrationTitle}>Welcome to OfferHaikya 👋</Text>
            <Text style={styles.registrationSubtitle}>
              Enter your details to continue.
            </Text>

            <TextInput
              value={registrationName}
              onChangeText={value => setRegistrationName(value.replace(/[^A-Za-z ]/g, '').slice(0, 12))}
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
                onChangeText={value => setRegistrationContact(value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit phone number *"
                placeholderTextColor="#99969c"
                style={styles.phoneInput}
                keyboardType="phone-pad"
                maxLength={10}
                editable={!registrationSubmitting}
              />
            </View>

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