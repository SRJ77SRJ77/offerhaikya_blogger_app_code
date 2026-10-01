import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  ImageBackground,
  Linking,
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
const DIRECT_TAGS = ['All', 'News', 'Amazon', 'Flipkart', 'Myntra', 'Meesho', 'Instamart', 'Blinkit', 'Zepto', 'BigBasket Now', 'Snapdeal', 'Shopsy', 'Offline Offers', 'Online Offers'];
const CATEGORY_ITEMS = ['Fashion', 'Electronics', 'Home & Kitchen', 'Beauty & Personal Care', 'Grocery & Food', 'Baby & Kids', 'Sports & Fitness', 'Automotive', 'Pet Supplies', 'Books & Education', 'Gaming', 'Travel & Luggage', 'Jewellery & Accessories', 'Tools & Industrial'];
const SPECIAL_DEAL_ITEMS = ['₹1 Deals', 'Loot Deals', 'Flash Sales', "Today's Deals", 'Clearance Sale', 'Buy 1 Get 1', 'Under ₹99', 'Under ₹499', '50%+ Off', 'Coupon Codes', 'Bank Offers', 'Freebies'];
const REGISTRATION_URL = 'https://script.google.com/macros/s/AKfycbx7Apdb0c9ygD-HnuNot8iKnCSAyEzM9UBKLGxjckOpuYNJbbXEHLapvXijaYm2c8Y-/exec';

type Post = {
  id: string;
  title: string;
  url: string;
  date: string;
  label: string;
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
        body: JSON.stringify({ name, contact: '91' + contact }),
      });

      if (!response.ok) throw new Error('Registration failed');

      setRegistrationSuccess(true);
      setRegistrationCompleted(true);
      setRegistrationName('');
      setRegistrationContact('');
      setRegistrationOpen(false);
    } catch {
      setRegistrationError('');
    } finally {
      setRegistrationSubmitting(false);
    }  };

  const renderPost = ({ item }: { item: Post }) => (
    <TouchableOpacity activeOpacity={0.92} style={[styles.card, darkMode && styles.cardDark]} onPress={() => openDetail(item)}>
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
  if (infoPage) {
    const infoData = {
      about: {
        title: 'About Us',
        image: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png',
        html: `
          <h1>About Us</h1>
          <h2>About Offer Hai Kya</h2>
          <p>Hi, I’m Swastik Jain and yes, Offer Hai Kya? is my daily question too. Ever since I started finding crazy offers online and offline — whether it’s Amazon flash sales, ₹1 loot deals, Meesho coupons, or stock clearance discounts — my friends had one thing to say: “Bhai… Offer Hai Kya?”</p>
          <p>So I thought why not make it easier for everyone? That’s how OfferHaiKya.com was born: a place where you can find the best offers, deals, vouchers, coupons, price drops, stock clearance discounts, and much more — all in one place.</p>
          <h3>🎯 What We Do</h3>
          <ul>
            <li>Post daily deals from Amazon, Flipkart, Meesho &amp; more</li>
            <li>Share exclusive coupons &amp; price drops</li>
            <li>Cover offline store offers &amp; stock clearance updates</li>
            <li>Help you shop smart and save big</li>
            <li>Post Daily Local Offers</li>
          </ul>
          <h3>📲 Got a Deal You Found?</h3>
          <p>Share it with us — we love discovering and spreading real offers.</p>
          <p><strong>📞 Contact:</strong> 72043 87277</p>
          <p><strong>📧 Email:</strong> offerhaikya@gmail.com</p>
          <p><strong>📍 Based in India:</strong> Sharing offers nationwide.</p>
        `,
      },
      contact: {
        title: 'Contact Us',
        image: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png',
        html: `
          <h1>Contact Us</h1>
          <p>Have a deal, offer, coupon, price drop, stock clearance update, or anything useful to share? We would love to hear from you.</p>
          <h2>Get in touch</h2>
          <p><strong>📞 Phone:</strong> 72043 87277</p>
          <p><strong>📧 Email:</strong> offerhaikya@gmail.com</p>
          <p><strong>🌐 Website:</strong> OfferHaiKya.com</p>
          <p>For deal submissions, local offers, corrections, or general enquiries, contact OfferHaikya using the details above.</p>
          <h2>Share a Deal</h2>
          <p>If you have found a useful online or offline offer, send us the details so we can review and share it with the OfferHaikya community.</p>
        `,
      },
      privacy: {
        title: 'Privacy Policy',
        image: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png',
        html: `
          <h1>Privacy Policy</h1>
          <p>At OfferHaiKya.com, we respect your privacy and are committed to protecting your personal information.</p>
          <p>We may collect your name, email, and basic details to provide you with better offers, send updates, and improve your experience.</p>
          <p>We also use cookies, analytics tools, and Google AdSense to enhance the site and show relevant ads. Your data may be shared with trusted third-party services for support or deals, but we never sell your information.</p>
          <p>By using this site, you agree to our use of cookies and data as per this policy.</p>
          <p>For any concerns, feel free to contact us at offerhaikya@gmail.com or 7204387277.</p>
        `,
      },
      terms: {
        title: 'Terms and Condition',
        image: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png',
        html: `
          <h1>Terms and Condition</h1>
          <h3>Effective Date: July 2025</h3>
          <p><strong>Last Updated: September 22, 2026</strong></p>
          <p>Welcome to OfferHaiKya.com. By accessing or using our website, services, forms, offers, notifications, or communication channels, you agree to these Terms &amp; Conditions.</p>
          <h2>1. About OfferHaiKya</h2>
          <p>OfferHaiKya.com is an offers and deals discovery platform that helps users discover online and offline deals, discounts, coupons, promotions, and special offers from brands, dealers, merchants, stores, and other businesses.</p>
          <h2>2. Offers &amp; Deal Information</h2>
          <p>We make reasonable efforts to provide accurate and useful information about offers and deals. However, offers may expire or change without notice. Prices, discounts, stock, availability, locations, and terms may change at any time. Users should verify important offer details with the merchant before making a purchase.</p>
          <h2>3. Third-Party Links &amp; Affiliate Disclosure</h2>
          <p>Some links may redirect you to third-party websites, stores, brands, dealers, merchants, or service providers. We may participate in affiliate programs and may earn a commission when users make eligible purchases through certain links.</p>
          <h2>4. Use of AI-Generated Content &amp; Images</h2>
          <p>OfferHaiKya may use AI tools to create, edit, enhance, or assist in producing images, graphics, promotional creatives, written content, descriptions, titles, and other website content. AI-assisted content may occasionally contain errors or inaccuracies.</p>
          <h2>5. User Data &amp; Personalized Offers</h2>
          <p>We may collect information such as your name, email address, phone number, WhatsApp number, location information, preferences, interactions with our website, and other information you voluntarily provide, subject to our Privacy Policy.</p>
          <h2>6. Marketing &amp; Communications</h2>
          <p>If you provide contact information or consent to communications, we may contact you through email, SMS, WhatsApp, phone calls, website notifications, or other supported channels.</p>
          <h2>7. User Conduct</h2>
          <p>You agree not to use OfferHaiKya for illegal activities, submit false or fraudulent information, spam users or merchants, attempt unauthorized access, upload harmful files, scrape our content without permission, abuse offers, or impersonate another person or organization.</p>
          <h2>8. Local Offers &amp; Merchant Information</h2>
          <p>OfferHaiKya may publish offers from local shops, dealers, restaurants, service providers, brands, and other businesses. Users should confirm important details directly with the merchant.</p>
          <h2>9. User-Submitted Content</h2>
          <p>If you submit reviews, comments, photos, offers, business information, or other content, you confirm that you have the right to submit it and grant OfferHaiKya permission to use, display, reproduce, modify, and distribute it for operating and promoting the platform.</p>
          <h2>10. Copyright &amp; Intellectual Property</h2>
          <p>The OfferHaiKya name, logo, website design, original articles, graphics, and other original materials are protected by applicable intellectual-property laws.</p>
          <h2>11. Advertising</h2>
          <p>OfferHaiKya may display advertisements from third-party advertising networks, brands, merchants, and other partners.</p>
          <h2>12. No Guarantee</h2>
          <p>OfferHaiKya provides deal and offer information on an “as available” basis. We do not guarantee that every deal will remain active, every discount will be available, a merchant will honor an advertised offer, products will remain in stock, or prices will remain unchanged.</p>
          <h2>13. Limitation of Liability</h2>
          <p>To the extent permitted by applicable law, OfferHaiKya will not be responsible for losses, damages, or disputes arising from transactions, products, services, offers, or interactions between users and third-party merchants, brands, dealers, or websites.</p>
          <h2>14. Privacy</h2>
          <p>Your privacy is important to us. Please read our Privacy Policy to understand how we collect, use, store, and share information.</p>
          <h2>15. Changes to These Terms</h2>
          <p>We may modify these Terms &amp; Conditions from time to time. The updated version will be published on the website with a revised “Last Updated” date.</p>
          <h2>16. Contact Us</h2>
          <p><strong>📧 Email:</strong> offerhaikya@gmail.com</p>
          <p><strong>📱 WhatsApp:</strong> 7204387277</p>
          <p><strong>🌐 Official Website:</strong> OfferHaiKya.com</p>
        `,
      },
    }[infoPage];

    return (
      <SafeAreaView style={[styles.safe, darkMode && styles.darkSafe]}>
        <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} backgroundColor={darkMode ? '#000000' : WHITE} />
        <View style={[styles.detailHeader, darkMode && styles.detailHeaderDark]}>
          <TouchableOpacity onPress={() => { closeMenu(); setMenuOpen(false); setInfoPage(null); }} style={styles.backButton}>
            <Text style={[styles.backText, darkMode && styles.headerIconDark]}>‹</Text>
          </TouchableOpacity>
          <Text style={[styles.detailHeaderTitle, darkMode && styles.darkText]} numberOfLines={1}>{infoData.title}</Text>
          <TouchableOpacity style={styles.headerIconButton} onPress={() => setDarkMode(value => !value)}>
            <Text style={[styles.headerIcon, darkMode && styles.headerIconDark]}>{darkMode ? '☀' : '☾'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.infoContent, darkMode && styles.detailContentDark]}>
          <Image source={{ uri: infoData.image }} style={styles.infoHeroImage} resizeMode="contain" />
          <RenderHTML
            contentWidth={Math.max(320, width - 40)}
            source={{ html: infoData.html }}
            tagsStyles={{
              body: { color: darkMode ? '#eeeeee' : '#4f4c52', fontSize: 15, lineHeight: 26 },
              h1: { color: darkMode ? WHITE : TEXT, fontSize: 29, lineHeight: 36, fontWeight: '900', marginTop: 0, marginBottom: 12 },
              h2: { color: darkMode ? WHITE : TEXT, fontSize: 23, lineHeight: 31, fontWeight: '900', marginTop: 18, marginBottom: 8 },
              h3: { color: darkMode ? WHITE : TEXT, fontSize: 19, lineHeight: 27, fontWeight: '800', marginTop: 16, marginBottom: 7 },
              p: { marginTop: 0, marginBottom: 10, lineHeight: 25, color: darkMode ? '#eeeeee' : '#4f4c52' },
              li: { marginBottom: 5, lineHeight: 25 },
              strong: { fontWeight: '900' },
            }}
          />
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
        <Image
          source={{ uri: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png' }}
          style={styles.headerLogo}
          resizeMode="contain"
        />
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
                  {CATEGORY_ITEMS.map(label => (
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

              <TouchableOpacity style={styles.menuMainItem} onPress={() => openInfoPage('about')}>
                <Text style={styles.menuMainItemText}>About Us</Text>
                <Text style={styles.menuMainArrow}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuMainItem} onPress={() => openInfoPage('contact')}>
                <Text style={styles.menuMainItemText}>Contact Us</Text>
                <Text style={styles.menuMainArrow}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuMainItem} onPress={() => openInfoPage('privacy')}>
                <Text style={styles.menuMainItemText}>Privacy Policy</Text>
                <Text style={styles.menuMainArrow}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuMainItem} onPress={() => openInfoPage('terms')}>
                <Text style={styles.menuMainItemText}>Terms and Condition</Text>
                <Text style={styles.menuMainArrow}>›</Text>
              </TouchableOpacity>
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
            {[...DIRECT_TAGS, ...DIRECT_TAGS].map((item, index) => (
              <TouchableOpacity
                key={item + '-' + index}
                onPress={() => {
                  pauseTagAutoScroll();
                  setActiveLabel(item);
                  loadPosts(item === 'All' ? '' : item, 1);                }}
                style={[styles.chip, activeLabel === item && styles.activeChip]}
              >
                <Text style={styles.chipText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

      <FlatList
        style={darkMode ? styles.listDark : undefined}
        extraData={darkMode}
        data={visiblePosts}
        keyExtractor={item => item.id}
        renderItem={renderPost}
        numColumns={2}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, darkMode && styles.contentDark]}
        ListHeaderComponentStyle={darkMode ? styles.contentDark : undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
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
                    suggestions.map(item => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.searchSuggestion}
                        onPress={() => {
                          setQuery('');
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
                    ))
                  ) : (
                    <Text style={styles.searchNoResult}>No matching offers</Text>
                  )}
                </View>
              )}
            </ImageBackground>



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
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.youtube.com/@offerhaikya')} accessibilityLabel="YouTube">
                    <View style={styles.youtubeLogo}><View style={styles.youtubePlay} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.facebook.com/offerhaikya/')} accessibilityLabel="Facebook">
                    <Text style={styles.facebookLogo}>f</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://www.linkedin.com/company/offerhaikya/')} accessibilityLabel="LinkedIn">
                    <Text style={styles.linkedinLogo}>in</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.socialIcon} onPress={() => Linking.openURL('https://x.com/offerhaikya')} accessibilityLabel="X">
                    <Text style={styles.xLogo}>𝕏</Text>
                  </TouchableOpacity>
                </View>            <View style={styles.footerLinks}>
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
  headerLogo: { width: 170, height: 54, marginLeft: 10 },
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
  content: { paddingBottom: 30, backgroundColor: PAGE },
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
  searchDropdown: { marginTop: 6, backgroundColor: WHITE, borderRadius: 12, overflow: 'hidden', elevation: 6, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, maxHeight: 360 },
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
  sectionTitle: { color: TEXT, fontSize: 20, fontWeight: '900' },
  pageText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  row: { paddingHorizontal: 10, justifyContent: 'space-between' },
  card: { width: '47.5%', marginHorizontal: 6, marginBottom: 14, backgroundColor: WHITE, borderRadius: 8, overflow: 'hidden', position: 'relative', elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  cardImage: { width: '100%', height: 125, backgroundColor: '#eeeeee' },
  cardHeart: { position: 'absolute', top: 8, right: 8, zIndex: 3, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
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
  infoContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 50 },
  infoHeroImage: { width: '100%', height: 110, marginBottom: 14 },
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
  favoriteOverlay: { ...StyleSheet.absoluteFill, zIndex: 150, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
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
  registrationPopup: { width: '100%', backgroundColor: WHITE, borderRadius: 16, padding: 18 },
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
