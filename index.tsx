import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const BLOG_URL = 'https://www.offerhaikya.com';
const FEED_URL = BLOG_URL + '/feeds/posts/default';
const ACCENT = '#ff5b01';
const HERO = '#6c6cfe';
const PAGE = '#e4e3e9';
const WHITE = '#ffffff';
const TEXT = '#202124';
const MUTED = '#77747a';

type Post = {
  id: string;
  title: string;
  url: string;
  date: string;
  label: string;
  image?: string;
  excerpt: string;
};

const stripHtml = (value = '') =>
  value
    .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, '')
    .replace(/<iframe[\\s\\S]*?<\\/iframe>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\s+/g, ' ')
    .trim();

const firstImage = (html = '') => {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1];
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
    const thumbnail = entry.media$thumbnail?.url;
    const image = thumbnail || firstImage(content);
    const labels = (entry.category || []).map((item: any) => item.term).filter(Boolean);

    return {
      id: entry.id?.$t || String(index),
      title: entry.title?.$t || 'Untitled post',
      url: alternate?.href || BLOG_URL,
      date: formatDate(entry.published?.$t || entry.updated?.$t || ''),
      label: labels[0] || 'Offers',
      image,
      excerpt: stripHtml(entry.summary?.$t || content).slice(0, 180),
    };
  });
};

const getFeed = async (query = '') => {
  const params = new URLSearchParams({
    alt: 'json',
    'max-results': '20',
  });
  if (query.trim().length >= 3) params.set('q', query.trim());

  const response = await fetch(FEED_URL + '?' + params.toString());
  if (!response.ok) throw new Error('Unable to load posts');
  return parseFeed(await response.json());
};

export default function App() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState('');
  const [activeLabel, setActiveLabel] = useState('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const loadPosts = useCallback(async (search = '') => {
    try {
      setError('');
      if (!search) setLoading(true);
      else setSearching(true);
      const result = await getFeed(search);
      setPosts(result);
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
    const timer = setTimeout(() => {
      if (query.trim().length === 0) {
        loadPosts();
      } else if (query.trim().length >= 3) {
        loadPosts(query);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [query, loadPosts]);

  const labels = useMemo(() => {
    const values = posts.map(post => post.label).filter(Boolean);
    return ['All', ...Array.from(new Set(values))];
  }, [posts]);

  const visiblePosts = useMemo(
    () =>
      activeLabel === 'All'
        ? posts
        : posts.filter(post => post.label === activeLabel),
    [posts, activeLabel],
  );

  const refresh = () => {
    setRefreshing(true);
    loadPosts(query.trim().length >= 3 ? query : '');
  };

  const openPost = (url: string) => Linking.openURL(url);

  const renderPost = ({ item }: { item: Post }) => (
    <TouchableOpacity
      activeOpacity={0.92}
      style={styles.card}
      onPress={() => openPost(item.url)}
    >
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.cardImage} />
      ) : (
        <View style={[styles.cardImage, styles.imageFallback]}>
          <Text style={styles.fallbackText}>OfferHaikya</Text>
        </View>
      )}

      <View style={styles.cardBody}>
        <View style={styles.metaRow}>
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.date}>{item.date}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.excerpt} numberOfLines={3}>
          {item.excerpt}
        </Text>
        <View style={styles.readRow}>
          <Text style={styles.readText}>Read more</Text>
          <Text style={styles.arrow}>›</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={WHITE} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => Linking.openURL(BLOG_URL)}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.brand}>OfferHaikya</Text>
        <View style={styles.headerDot} />
      </View>

      <FlatList
        data={visiblePosts}
        keyExtractor={item => item.id}
        renderItem={renderPost}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListHeaderComponent={
          <>
            <View style={styles.hero}>
              <Text style={styles.heroSmall}>LATEST DEALS & OFFERS</Text>
              <Text style={styles.heroTitle}>Find the best offers</Text>
              <Text style={styles.heroSubtitle}>
                New offers from OfferHaikya, updated automatically.
              </Text>
            </View>

            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput
                value={query}
                onChangeText={text => {
                  setQuery(text);
                  setActiveLabel('All');
                }}
                placeholder="Search offers..."
                placeholderTextColor="#99969c"
                style={styles.searchInput}
                returnKeyType="search"
              />
              {searching && <ActivityIndicator size="small" color={ACCENT} />}
            </View>

            <FlatList
              data={labels}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={item => item}
              contentContainerStyle={styles.chips}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => setActiveLabel(item)}
                  style={[
                    styles.chip,
                    activeLabel === item && styles.activeChip,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      activeLabel === item && styles.activeChipText,
                    ]}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              )}
            />

            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Latest offers</Text>
              <TouchableOpacity onPress={() => loadPosts()}>
                <Text style={styles.refreshText}>Refresh</Text>
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.state}>
              <ActivityIndicator size="large" color={ACCENT} />
              <Text style={styles.stateText}>Loading latest offers...</Text>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text style={styles.errorTitle}>Something went wrong</Text>
              <Text style={styles.stateText}>{error}</Text>
              <TouchableOpacity style={styles.retry} onPress={() => loadPosts()}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.state}>
              <Text style={styles.errorTitle}>No offers found</Text>
              <Text style={styles.stateText}>
                Try another search or category.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          visiblePosts.length > 0 ? (
            <View style={styles.footer}>
              <Text style={styles.footerBrand}>OfferHaikya</Text>
              <Text style={styles.footerText}>Fresh offers. Simple browsing.</Text>
              <TouchableOpacity onPress={() => Linking.openURL(BLOG_URL)}>
                <Text style={styles.websiteText}>Open website ›</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: PAGE,
  },
  header: {
    height: 60,
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dddddd',
  },
  menuButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    fontSize: 22,
    color: TEXT,
  },
  brand: {
    flex: 1,
    textAlign: 'center',
    marginRight: 42,
    fontSize: 20,
    fontWeight: '800',
    color: TEXT,
  },
  headerDot: {
    position: 'absolute',
    right: 18,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  content: {
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: HERO,
    paddingHorizontal: 22,
    paddingTop: 30,
    paddingBottom: 32,
  },
  heroSmall: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  heroSubtitle: {
    color: '#eeeeff',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  searchBox: {
    marginHorizontal: 16,
    marginTop: -22,
    backgroundColor: WHITE,
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  searchIcon: {
    fontSize: 27,
    color: MUTED,
    marginRight: 8,
    marginTop: -3,
  },
  searchInput: {
    flex: 1,
    color: TEXT,
    fontSize: 15,
    paddingVertical: 12,
  },
  chips: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: '#dedde1',
  },
  activeChip: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  chipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: '700',
  },
  activeChipText: {
    color: WHITE,
  },
  sectionRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 20,
    fontWeight: '900',
  },
  refreshText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '800',
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 15,
    backgroundColor: WHITE,
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  cardImage: {
    width: '100%',
    height: 175,
    backgroundColor: '#eeeeee',
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HERO,
  },
  fallbackText: {
    color: WHITE,
    fontSize: 22,
    fontWeight: '900',
  },
  cardBody: {
    padding: 16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
  },
  label: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  date: {
    color: MUTED,
    fontSize: 11,
  },
  title: {
    color: TEXT,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },
  excerpt: {
    color: '#66636a',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
  },
  readRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 11,
  },
  readText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '900',
  },
  arrow: {
    color: ACCENT,
    fontSize: 22,
    lineHeight: 17,
    marginLeft: 5,
  },
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingVertical: 45,
  },
  stateText: {
    color: MUTED,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 9,
  },
  errorTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  retry: {
    marginTop: 16,
    backgroundColor: ACCENT,
    borderRadius: 9,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: {
    color: WHITE,
    fontWeight: '800',
  },
  footer: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 10,
  },
  footerBrand: {
    color: TEXT,
    fontSize: 18,
    fontWeight: '900',
  },
  footerText: {
    color: MUTED,
    fontSize: 12,
    marginTop: 5,
  },
  websiteText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 10,
  },
});
