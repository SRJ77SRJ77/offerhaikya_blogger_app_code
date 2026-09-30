import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  RefreshControl,
  ScrollView,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import RenderHTML from 'react-native-render-html';
import { useWindowDimensions } from 'react-native';

const BLOG_URL = 'https://www.offerhaikya.com';
const FEED_URL = BLOG_URL + '/feeds/posts/default';
const ACCENT = '#ff5b01';
const HERO = '#6c6cfe';
const PAGE = '#f3f4f6';
const WHITE = '#ffffff';
const TEXT = '#202124';
const MUTED = '#77747a';
const PAGE_SIZE = 20;

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
      image: highResImage(entry.media$thumbnail?.url) || firstImage(content),
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
  if (query.trim().length >= 3) params.set('q', query.trim());

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

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
    const timer = setTimeout(() => {
      setActiveLabel('All');
      if (query.trim().length === 0) loadPosts('', 1);
      else if (query.trim().length >= 3) loadPosts(query, 1);
    }, 450);
    return () => clearTimeout(timer);
  }, [query, loadPosts]);

  const labels = useMemo(() => {
    const values = posts.map(post => post.label).filter(Boolean);
    return ['All', ...Array.from(new Set(values))];
  }, [posts]);

  const visiblePosts = useMemo(
    () => activeLabel === 'All' ? posts : posts.filter(post => post.label === activeLabel),
    [posts, activeLabel],
  );

  const refresh = () => {
    setRefreshing(true);
    loadPosts(query.trim().length >= 3 ? query : '', page);
  };

  const openDetail = (post: Post) => {
    setMenuOpen(false);
    setDetail(post);
  };

  const goToPage = (nextPage: number) => {
    if (nextPage < 1) return;
    loadPosts(query.trim().length >= 3 ? query : '', nextPage);
  };

  if (detail) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={WHITE} />
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setDetail(null)} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.detailHeaderTitle} numberOfLines={1}>{detail.title}</Text>
        </View>
        <FlatList
          data={[detail]}
          keyExtractor={item => item.id}
          renderItem={() => (
            <View style={styles.detailContent}>
            <Text style={styles.detailLabel}>{detail.label}</Text>
            <Text style={styles.detailTitle}>{detail.title}</Text>
            <Text style={styles.detailDate}>{detail.date}</Text>
            <RenderHTML
              contentWidth={Math.max(320, width - 40)}
              source={{ html: detail.rawContent || `<p>${detail.content || detail.excerpt}</p>` }}
              tagsStyles={{
                body: { color: '#4f4c52', fontSize: 15, lineHeight: 26 },
                p: { marginTop: 0, marginBottom: 8, lineHeight: 24 },
                h1: { color: TEXT, fontSize: 27, lineHeight: 35, fontWeight: '900', marginTop: 10, marginBottom: 8 },
                h2: { color: TEXT, fontSize: 23, lineHeight: 31, fontWeight: '900', marginTop: 12, marginBottom: 7 },
                h3: { color: TEXT, fontSize: 19, lineHeight: 27, fontWeight: '800', marginTop: 10, marginBottom: 6 },
                li: { marginBottom: 3, lineHeight: 24 },
                a: { color: ACCENT },
                strong: { fontWeight: '900' },
                em: { fontStyle: 'italic' },
                table: { width: '100%' },
                th: { padding: 7, fontWeight: '900' },
                td: { padding: 7 },
              }}
            />
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 30 }}
        />
      </SafeAreaView>
    );
  }

  const renderPost = ({ item }: { item: Post }) => (
    <TouchableOpacity activeOpacity={0.92} style={styles.card} onPress={() => openDetail(item)}>
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.cardImage} />
      ) : (
        <View style={[styles.cardImage, styles.imageFallback]}>
          <Text style={styles.fallbackText}>OfferHaikya</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.label}>{item.label}</Text>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.date}>{item.date}</Text>
        <Text style={styles.excerpt} numberOfLines={3}>{item.excerpt}</Text>
        <Text style={styles.readText}>Read more ›</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={WHITE} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.menuButton} onPress={() => setMenuOpen(value => !value)}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <Image
          source={{ uri: 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png' }}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={styles.headerSpacer} />
      </View>

      {menuOpen && (
        <View style={styles.menuPanel}>
          <Text style={styles.menuTitle}>Categories</Text>
          {labels.map(label => (
            <TouchableOpacity
              key={label}
              style={styles.menuItem}
              onPress={() => {
                setActiveLabel(label);
                setMenuOpen(false);
              }}
            >
              <Text style={[styles.menuItemText, activeLabel === label && styles.menuItemActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={visiblePosts}
        keyExtractor={item => item.id}
        renderItem={renderPost}
        numColumns={2}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
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
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search offers..."
                  placeholderTextColor="#99969c"
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                <TouchableOpacity style={styles.searchButton} onPress={() => loadPosts(query.trim(), 1)}>
                  {searching ? <ActivityIndicator size="small" color={WHITE} /> : <Text style={styles.searchButtonText}>GO</Text>}
                </TouchableOpacity>
              </View>
            </ImageBackground>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {labels.map(item => (
                <TouchableOpacity
                  key={item}
                  onPress={() => setActiveLabel(item)}
                  style={[styles.chip, activeLabel === item && styles.activeChip]}
                >
                  <Text style={[styles.chipText, activeLabel === item && styles.activeChipText]}>{item}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Latest offers</Text>
              <Text style={styles.pageText}>Page {page}</Text>
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
                <Text style={styles.footerText}>Fresh offers. Simple browsing.</Text>
              </View>
            </>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE },
  header: { height: 60, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dddddd' },
  menuButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { fontSize: 22, color: TEXT },
  headerLogo: { position: 'absolute', left: '50%', width: 150, height: 48, marginLeft: -75 },
  headerSpacer: { width: 42 },
  menuPanel: { position: 'absolute', zIndex: 20, top: 60, left: 12, width: 230, backgroundColor: WHITE, borderRadius: 12, paddingVertical: 8, elevation: 8, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  menuTitle: { fontSize: 15, fontWeight: '900', color: TEXT, paddingHorizontal: 16, paddingVertical: 10 },
  menuItem: { paddingHorizontal: 16, paddingVertical: 11 },
  menuItemText: { color: TEXT, fontSize: 14, fontWeight: '700' },
  menuItemActive: { color: ACCENT },
  content: { paddingBottom: 30, backgroundColor: PAGE },
  hero: { minHeight: 245, justifyContent: 'flex-end', overflow: 'hidden', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 34 },
  heroImage: { opacity: 1 },
  heroSmall: { color: WHITE, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  heroTitle: { color: WHITE, fontSize: 29, lineHeight: 35, fontWeight: '900' },
  heroSubtitle: { color: '#eeeeff', fontSize: 14, lineHeight: 21, marginTop: 8 },
  searchBox: { marginTop: 18, backgroundColor: WHITE, minHeight: 52, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 5, elevation: 3, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  searchIcon: { fontSize: 27, color: MUTED, marginRight: 8, marginTop: -3 },
  searchInput: { flex: 1, color: TEXT, fontSize: 15, paddingVertical: 12 },
  searchButton: { width: 42, height: 42, borderRadius: 10, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  searchButtonText: { color: WHITE, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  chips: { paddingHorizontal: 16, paddingVertical: 15, gap: 8 },
  chip: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, backgroundColor: WHITE, borderWidth: 1, borderColor: '#dedde1' },
  activeChip: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { color: TEXT, fontSize: 13, fontWeight: '700' },
  activeChipText: { color: WHITE },
  sectionRow: { paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: TEXT, fontSize: 20, fontWeight: '900' },
  pageText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  row: { paddingHorizontal: 10, justifyContent: 'space-between' },
  card: { width: '47.5%', marginHorizontal: 6, marginBottom: 14, backgroundColor: WHITE, borderRadius: 14, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  cardImage: { width: '100%', height: 125, backgroundColor: '#eeeeee' },
  imageFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: HERO },
  fallbackText: { color: WHITE, fontSize: 16, fontWeight: '900' },
  cardBody: { padding: 11 },
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
  detailImage: { width: '100%', height: 220, borderRadius: 14, backgroundColor: '#eeeeee', marginBottom: 16 },
  detailLabel: { color: ACCENT, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 2 },
  detailTitle: { color: TEXT, fontSize: 27, lineHeight: 34, fontWeight: '900', marginTop: 7 },
  detailDate: { color: MUTED, fontSize: 12, marginTop: 7 },
  detailBody: { color: '#4f4c52', fontSize: 15, lineHeight: 26, marginTop: 22, paddingBottom: 12 },

  footer: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
  footerBrand: { color: TEXT, fontSize: 18, fontWeight: '900' },
  footerText: { color: MUTED, fontSize: 12, marginTop: 5 },
});
