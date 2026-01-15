import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  ListRenderItemInfo,
  Alert,
  Modal,
  TouchableWithoutFeedback,
  Animated,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  PanResponder,
  RefreshControl,
  Share,
  Easing,
  Linking,

  // ✅ EK: Native -> RN event dinlemek için
  DeviceEventEmitter,
} from 'react-native';
import Video from 'react-native-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../store/useAuth';
import { useFeed } from '../store/useFeed';
import type { Post } from '../data/feed';
import { useTranslation } from 'react-i18next';

// ✅ API error user message helper
import { getUserMessage, API_BASE_URL } from '../config/api';

// ✅ Focus Network (Akıştaki butonda istek sayısı için)
import { useFocusNetwork } from '../store/useFocusNetwork';

// 🔴 UploadScreen'den serbest paylaşım bayrağı
import { markNextUploadAsFree } from './UploadScreen';

// 🔴 Viral logo (damga)
const VIRAL_LOGO = require('../assets/viral/logo.png');

// 🔵 Dış paylaşım ikonları
const ICON_INSTAGRAM = require('../assets/icons/instagram.png');
const ICON_FACEBOOK = require('../assets/icons/facebook.png');
const ICON_X = require('../assets/icons/x.png');
const ICON_TIKTOK = require('../assets/icons/tiktok.png');
const ICON_LINKEDIN = require('../assets/icons/linkedin.png');
const ICON_NEXTSOSYAL = require('../assets/icons/nextsosyal.png');

// 🌐 Bağlı hesaplarla paylaşım paneli
import SharePanel from '../components/SharePanel';

type Props = {
  go: (screen: 'Feed' | 'Upload' | 'Tasks' | 'FocusNetwork') => void;
};

// 💬 Yorum tipi – kalıcı olacak
type Comment = {
  id: string;
  postId: string;
  author: string;
  text: string;
  ts: number;
  likes: number;
  parentId?: string | null;
};

// 🔔 Bildirim tipi – kalıcı
type Notification = {
  id: string;
  text: string;
  ts: number;
  read: boolean;
  postId?: string | null;
};

// Akış filtre tipi
type FeedFilter = 'all' | 'mine' | 'task' | 'video' | 'external';

// ✅ Native share payload tipi (MainActivity’den geliyor)
type ShareIntentPayload = {
  action?: string;
  mimeType?: string | null;
  text?: string | null;
  uri?: string | null;
  uris?: string[] | null;
};

// ================================
// ✅ CAP / CLEANUP LIMITLERİ
// ================================
const MAX_NOTIFICATIONS = 200; // bildirim çok şişmesin
const MAX_COMMENTS_PER_POST = 300; // tek post altında yorum şişmesin
const MAX_CREATED_AT_ENTRIES = 800; // createdAt map şişmesin
const MAX_LOCAL_REPOSTS = 50;
const MAX_EXTERNAL_POSTS = 50;

// 👍 Animasyonlu beğeni butonu (gönderi için)
const AnimatedLikeButton: React.FC<{
  likes: number;
  onPress: () => void;
}> = ({ likes, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;

  // 🔥 Uçan küçük Viral logosu için local animasyon
  const flyValue = useRef(new Animated.Value(0)).current;
  const [showFly, setShowFly] = useState(false);

  const handlePress = () => {
    Animated.sequence([
      Animated.spring(scale, {
        toValue: 1.15,
        useNativeDriver: true,
        friction: 3,
        tension: 150,
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 3,
        tension: 150,
      }),
    ]).start();

    setShowFly(true);
    flyValue.setValue(0);
    Animated.timing(flyValue, {
      toValue: 1,
      duration: 700,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShowFly(false);
    });

    onPress();
  };

  const translateY = flyValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -40],
  });

  const opacity = flyValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <View style={{ position: 'relative', alignItems: 'center' }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable style={({ pressed }) => [styles.likeBtn, pressed && styles.likeBtnPressed]} onPress={handlePress}>
          <Text style={styles.likeText}>👍 {Number.isFinite(likes) ? likes : 0}</Text>
        </Pressable>
      </Animated.View>

      {showFly && (
        <Animated.Image
          source={VIRAL_LOGO}
          resizeMode="contain"
          style={{
            position: 'absolute',
            bottom: 28,
            width: 20,
            height: 20,
            borderRadius: 10,
            opacity,
            transform: [{ translateY }],
          }}
        />
      )}
    </View>
  );
};

// Platform label'dan (Facebook, Instagram, X...) basit bir tip üretelim
const normalizePlatform = (label: string) => {
  const l = label.toLowerCase();
  if (l.includes('instagram')) return 'instagram';
  if (l === 'x' || l.includes('twitter')) return 'x';
  if (l.includes('facebook')) return 'facebook';
  if (l.includes('linkedin')) return 'linkedin';
  if (l.includes('tiktok')) return 'tiktok';
  if (l.includes('next')) return 'nextsosyal';
  return 'generic';
};

// 🔹 Dış paylaşım için ikon seçici
const getPlatformIcon = (label: string) => {
  const t = normalizePlatform(label);
  switch (t) {
    case 'instagram':
      return ICON_INSTAGRAM;
    case 'x':
      return ICON_X;
    case 'facebook':
      return ICON_FACEBOOK;
    case 'linkedin':
      return ICON_LINKEDIN;
    case 'tiktok':
      return ICON_TIKTOK;
    case 'nextsosyal':
      return ICON_NEXTSOSYAL;
    default:
      return VIRAL_LOGO;
  }
};

const COMMENTS_KEY = '@feed_comments_v1';
const COMMENTS_DISABLED_KEY = '@feed_comments_disabled_v1';
const NOTIFICATIONS_KEY = '@feed_notifications_v1';
const CREATED_AT_KEY = '@feed_created_at_v1';
const FOCUS_INCOMING_SEEN_KEY = '@focus_network_incoming_seen_v1';
const PENDING_SHARE_KEY = 'viral.pendingShareToFeed';
const EXTERNAL_POSTS_KEY = '@feed_external_posts_v1';
const LOCAL_REPOSTS_KEY = '@feed_local_reposts_v1';

// ✅ useAuth içinden userId’yi sağlam çöz
function resolveUserId(auth: any): number | null {
  const candidates = [
    auth?.user?.id,
    auth?.userId,
    auth?.me?.id,
    auth?.currentUser?.id,
    auth?.profile?.id,
    auth?.session?.user?.id,
  ];

  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
    if (typeof c === 'string') {
      const n = Number(c.trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

// ✅ basit URL yakalama
function extractFirstUrl(text: string): string | null {
  try {
    const m = text.match(/https?:\/\/[^\s]+/i);
    return m && m[0] ? m[0] : null;
  } catch {
    return null;
  }
}

// ✅ Tek aktif video (repost embed dahil) için state
type ActiveVideoState = {
  instanceId: string; // video instance anahtarı (repost embed için farklı)
  listItemId: string; // FlatList satır id (viewability bununla kapanır)
  uri: string;
  paused: boolean; // (kalsın) ama artık overlay yok
};

export default function FeedScreen({ go }: Props) {
  const { t } = useTranslation();

  const auth = useAuth() as any;
  const { userId, profile } = auth || {};

  const [feedError, setFeedError] = useState<string>('');

  const [externalPosts, setExternalPosts] = useState<Post[]>([]);
  const [localReposts, setLocalReposts] = useState<Post[]>([]);

  const [resolvedFullName, setResolvedFullName] = useState<string>('');
  const [resolvedHandle, setResolvedHandle] = useState<string>('');
  const [resolvedAvatarUri, setResolvedAvatarUri] = useState<string>('');

  const { incomingRequests, hydrateAll: hydrateFocusNetworkAll } = useFocusNetwork();

  const resolvedUserId: number | null = useMemo(() => resolveUserId(auth), [auth]);

  const pendingFocusRequestsCount = useMemo(() => {
    if (!Array.isArray(incomingRequests)) return 0;
    return incomingRequests.length;
  }, [incomingRequests]);

  const [focusSeenCount, setFocusSeenCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const loadSeen = async () => {
      try {
        const raw = await AsyncStorage.getItem(FOCUS_INCOMING_SEEN_KEY);
        const n = raw != null ? Number(raw) : 0;
        if (!cancelled) setFocusSeenCount(Number.isFinite(n) ? Math.max(0, n) : 0);
      } catch {
        if (!cancelled) setFocusSeenCount(0);
      }
    };
    loadSeen();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    hydrateFocusNetworkAll({ userId: resolvedUserId });
    if (!resolvedUserId) return;

    const tmr = setInterval(() => {
      hydrateFocusNetworkAll({ userId: resolvedUserId });
    }, 9000);

    return () => clearInterval(tmr);
  }, [resolvedUserId, hydrateFocusNetworkAll]);

  const hasNewFocusRequests = pendingFocusRequestsCount > focusSeenCount;

  const badgePulse = useRef(new Animated.Value(0)).current;
  const badgePop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!hasNewFocusRequests) {
      badgePulse.stopAnimation();
      badgePulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(badgePulse, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(badgePulse, {
          toValue: 0,
          duration: 460,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [hasNewFocusRequests, badgePulse]);

  const lastPendingRef = useRef<number>(0);
  useEffect(() => {
    const prev = lastPendingRef.current;
    lastPendingRef.current = pendingFocusRequestsCount;

    if (pendingFocusRequestsCount > prev) {
      badgePop.setValue(1);
      Animated.sequence([
        Animated.spring(badgePop, {
          toValue: 1.22,
          useNativeDriver: true,
          friction: 4,
          tension: 160,
        }),
        Animated.spring(badgePop, {
          toValue: 1,
          useNativeDriver: true,
          friction: 4,
          tension: 160,
        }),
      ]).start();
    }
  }, [pendingFocusRequestsCount, badgePop]);

  const pulseScale = badgePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });

  const pulseOpacity = badgePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.72],
  });

  const combinedScale = Animated.multiply(pulseScale, badgePop);

  const markFocusRequestsSeen = async () => {
    try {
      const n = pendingFocusRequestsCount;
      setFocusSeenCount(n);
      await AsyncStorage.setItem(FOCUS_INCOMING_SEEN_KEY, String(n));
    } catch {
      // ignore
    }
  };

 // ✅ profile -> storage fallback
  useEffect(() => {
    let cancelled = false;

    const tryResolveFromStorage = async () => {
      const pFull = profile?.fullName != null ? String(profile.fullName).trim() : '';
      const pHandle = profile?.handle != null ? String(profile.handle).trim() : '';
      const pAvatar = profile?.avatarUri != null ? String(profile.avatarUri).trim() : '';

      if ((pFull || pHandle) && pAvatar) {
        if (!cancelled) {
          setResolvedFullName(pFull);
          setResolvedHandle(pHandle);
          setResolvedAvatarUri(pAvatar);
        }
        return;
      }

      const candidateKeys = [
        '@auth_profile_v1',
        '@auth_profile',
        '@profile_v1',
        '@profile',
        '@me_v1',
        '@me',
        '@user_profile_v1',
        '@user_profile',
      ];

      for (const key of candidateKeys) {
        try {
          const raw = await AsyncStorage.getItem(key);
          if (!raw) continue;

          const parsed: any = JSON.parse(raw);

          const full =
            (parsed?.fullName != null ? String(parsed.fullName).trim() : '') ||
            (parsed?.profile?.fullName != null ? String(parsed.profile.fullName).trim() : '') ||
            '';

          const handle =
            (parsed?.handle != null ? String(parsed.handle).trim() : '') ||
            (parsed?.profile?.handle != null ? String(parsed.profile.handle).trim() : '') ||
            '';

          const avatar =
            (parsed?.avatarUri != null ? String(parsed.avatarUri).trim() : '') ||
            (parsed?.profile?.avatarUri != null ? String(parsed.profile.avatarUri).trim() : '') ||
            '';

          if (full || handle || avatar) {
            if (!cancelled) {
              setResolvedFullName(pFull || full);
              setResolvedHandle(pHandle || handle);
              setResolvedAvatarUri(pAvatar || avatar);
            }
            return;
          }
        } catch {
          // ignore
        }
      }

      if (!cancelled) {
        setResolvedFullName(pFull || '');
        setResolvedHandle(pHandle || '');
        setResolvedAvatarUri(pAvatar || '');
      }
    };

    tryResolveFromStorage();

    return () => {
      cancelled = true;
    };
  }, [profile?.fullName, profile?.handle, profile?.avatarUri]);

  const fullNameStr =
    (profile?.fullName != null ? String(profile.fullName).trim() : '') || (resolvedFullName ? resolvedFullName : '');

  const handleStr =
    (profile?.handle != null ? String(profile.handle).trim() : '') || (resolvedHandle ? resolvedHandle : '');

  const displayName: string =
    (fullNameStr ? fullNameStr : '') ||
    (handleStr ? `@${handleStr.replace(/^@/, '')}` : '') ||
    (userId ? String(userId).trim() : '') ||
    t('feed.guestName', 'misafir');

  const firstName = displayName.startsWith('@') ? displayName : displayName.split(' ').filter(Boolean)[0] || displayName;

  const myAvatarUri: string | null =
    ((profile?.avatarUri != null ? String(profile.avatarUri).trim() : '') ||
      (resolvedAvatarUri ? resolvedAvatarUri : '') ||
      '') ||
    null;

  const { posts: storePosts, likePost, hydrate, hydrated, archivePost, removePost, markPostShared, repostPost } = useFeed();

  const allPosts: Post[] = useMemo(() => {
    const s = Array.isArray(storePosts) ? storePosts : [];
    return [...localReposts, ...externalPosts, ...s];
  }, [storePosts, externalPosts, localReposts]);

  const isExternalLocal = (p: Post) => {
    const anyP: any = p as any;
    return anyP?._localExternal === true || anyP?.source === 'external';
  };

  const safeLike = (p: Post) => {
    if (isExternalLocal(p)) {
      setExternalPosts(prev => prev.map(x => (x.id === p.id ? { ...x, likes: (Number(x.likes) || 0) + 1 } : x)));
      return;
    }
    try {
      likePost(p.id);
    } catch (e) {
      console.warn('[Feed] likePost hata:', e);
      Alert.alert(t('common.error', 'Hata'), getUserMessage(e));
    }
  };

  const safeRemove = (p: Post) => {
    if (isExternalLocal(p)) {
      setExternalPosts(prev => prev.filter(x => x.id !== p.id));
      return;
    }
    try {
      removePost(p.id);
    } catch (e) {
      console.warn('[Feed] removePost hata:', e);
      Alert.alert(t('common.error', 'Hata'), getUserMessage(e));
    }
  };

  const safeArchive = (p: Post) => {
    if (isExternalLocal(p)) {
      setExternalPosts(prev => prev.filter(x => x.id !== p.id));
      return;
    }
    try {
      archivePost(p.id);
    } catch (e) {
      console.warn('[Feed] archivePost hata:', e);
      Alert.alert(t('common.error', 'Hata'), getUserMessage(e));
    }
  };

  // ✅ repost: local repost üret + backend’e bildir
  const safeRepost = (p: Post) => {
    if (isExternalLocal(p)) {
      Alert.alert(
        t('feed.repost.notAvailableTitle', 'Tekrar paylaşım'),
        t('feed.repost.notAvailableMsg', 'Bu paylaşım dış kaynaktan geldiği için tekrar paylaşım kapalı.'),
      );
      return;
    }

    try {
      const now = Date.now();
      const localId = `repost_${now}_${Math.random().toString(16).slice(2)}`;
      const anyP: any = p as any;

      const localRepost: any = {
        id: localId,
        repostOfId: p.id,

        author: displayName,

        title: anyP.title,
        body: anyP.body,
        note: anyP.note,
        videoUri: anyP.videoUri,

        isTaskCard: typeof anyP.isTaskCard === 'boolean' ? anyP.isTaskCard : true,
        likes: 0,
        archived: false,

        createdAt: now,
        lastSharedAt: now,

        _localRepost: true,
      };

      setLocalReposts(prev => {
        const base = Array.isArray(prev) ? prev : [];
        const next = [localRepost as Post, ...base];
        return next.slice(0, MAX_LOCAL_REPOSTS);
      });
    } catch (e) {
      console.warn('[Feed] local repost üretilemedi:', e);
    }

    try {
      repostPost(p.id);
    } catch (e) {
      console.warn('[Feed] repostPost hata:', e);
      Alert.alert(t('common.error', 'Hata'), getUserMessage(e));
    }
  };

  const safeHydrate = async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setFeedError('');
      await Promise.resolve(hydrate());
    } catch (e) {
      console.warn('[Feed] hydrate hata:', e);
      const msg = getUserMessage(e, t('feed.errors.loadFailed', 'Akış yüklenemedi. Lütfen tekrar dene.'));
      setFeedError(msg);
    }
  };

  const apiBase = useMemo(() => String(API_BASE_URL || '').replace(/\/+$/, ''), []);
  const resolveAvatarUri = (raw: any): string | null => {
    try {
      const pick = (v: any) => (v != null ? String(v).trim() : '');
      const candidates = [
        pick(raw?.authorAvatarUri),
        pick(raw?.authorAvatarUrl),
        pick(raw?.authorAvatar),
        pick(raw?.authorPhotoUrl),
        pick(raw?.authorImage),
        pick(raw?.author?.avatarUri),
        pick(raw?.author?.avatarUrl),
        pick(raw?.author?.photoUrl),
        pick(raw?.author?.imageUrl),
        pick(raw?.avatarUri),
        pick(raw?.avatarUrl),
        pick(raw?.avatar),
        pick(raw?.user?.avatarUri),
        pick(raw?.user?.avatarUrl),
        pick(raw?.user?.photoUrl),
        pick(raw?.ownerAvatarUri),
        pick(raw?.profilePhoto),
        pick(raw?.photoUrl),
        pick(raw?.photo),
      ].filter(Boolean);

      const uri = candidates[0] || '';
      if (!uri) return null;

      if (/^data:image\//i.test(uri)) return uri;
      if (/^https?:\/\//i.test(uri)) return uri;
      if (/^\/\//.test(uri)) return `https:${uri}`;

      if (uri.startsWith('/')) {
        if (apiBase && /^https?:\/\//i.test(apiBase)) return `${apiBase}${uri}`;
        return uri;
      }

      if (!uri.includes('://') && !uri.startsWith('file:')) {
        if (apiBase && /^https?:\/\//i.test(apiBase)) return `${apiBase}/${uri.replace(/^\/+/, '')}`;
      }

      return uri;
    } catch {
      return null;
    }
  };

  // ✅ Share intent -> external post üret
  const ingestSharePayload = async (payload: ShareIntentPayload, source: 'event' | 'storage') => {
    try {
      const mime = payload?.mimeType || null;
      const text = payload?.text || null;
      const uri = payload?.uri || null;
      const uris = payload?.uris || null;

      const hasAnything =
        !!(text && String(text).trim()) || !!(uri && String(uri).trim()) || (Array.isArray(uris) && uris.length > 0);
      if (!hasAnything) return;

      const now = Date.now();
      const id = `ext_${now}_${Math.random().toString(16).slice(2)}`;

      const urlFromText = text ? extractFirstUrl(String(text)) : null;

      const isVideo =
        (mime && String(mime).toLowerCase().startsWith('video/')) || (!!uri && String(uri).toLowerCase().includes('.mp4'));

      const primaryUri = uri || (Array.isArray(uris) && uris.length > 0 ? uris[0] : null);

      const title = isVideo
        ? t('feed.external.videoTitle', 'Paylaşılan Video')
        : urlFromText
        ? t('feed.external.linkTitle', 'Paylaşılan Bağlantı')
        : t('feed.external.genericTitle', 'Dış Paylaşım');

      const body = urlFromText ? urlFromText : text ? String(text).trim() : primaryUri ? String(primaryUri).trim() : '';

      const externalPost: any = {
        id,
        title,
        body: body ? body : undefined,
        note: body ? body : undefined,
        author: displayName,
        likes: 0,
        isTaskCard: false,
        time: t('feed.time.justNow', 'az önce'),
        archived: false,

        source: 'external',
        kind: 'external',
        external: true,

        _localExternal: true,
      };

      if (isVideo && primaryUri) {
        externalPost.videoUri = String(primaryUri);
      }

      setExternalPosts(prev => {
        const base = Array.isArray(prev) ? prev : [];
        const next = [externalPost as Post, ...base];

        const seen = new Set<string>();
        const deduped = next.filter(p => {
          const pid = (p as any)?.id ? String((p as any).id) : '';
          if (!pid) return false;
          if (seen.has(pid)) return false;
          seen.add(pid);
          return true;
        });

        return deduped.slice(0, MAX_EXTERNAL_POSTS);
      });

      if (source === 'storage') {
        await AsyncStorage.removeItem(PENDING_SHARE_KEY);
      }
    } catch (e) {
      console.warn('[Feed] ingestSharePayload hata:', e);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const readPending = async () => {
      try {
        const raw = await AsyncStorage.getItem(PENDING_SHARE_KEY);
        if (!raw) return;
        if (cancelled) return;

        let parsed: any = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }

        if (parsed && typeof parsed === 'object') {
          await ingestSharePayload(parsed as ShareIntentPayload, 'storage');
        } else {
          await AsyncStorage.removeItem(PENDING_SHARE_KEY);
        }
      } catch (e) {
        console.warn('[Feed] pending share read hata:', e);
      }
    };
    readPending();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadExternalPosts = async () => {
      try {
        const raw = await AsyncStorage.getItem(EXTERNAL_POSTS_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const cleaned = parsed
          .filter(x => x && typeof x === 'object')
          .map((x: any) => ({
            ...x,
            source: 'external',
            kind: 'external',
            external: true,
            _localExternal: true,
            likes: typeof x.likes === 'number' ? x.likes : 0,
          }))
          .slice(0, MAX_EXTERNAL_POSTS);

        if (!cancelled) setExternalPosts(cleaned as Post[]);
      } catch (e) {
        console.warn('[Feed] external posts load hata:', e);
      }
    };

    loadExternalPosts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLocalReposts = async () => {
      try {
        const raw = await AsyncStorage.getItem(LOCAL_REPOSTS_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const cleaned = parsed.filter(x => x && typeof x === 'object' && x.id).slice(0, MAX_LOCAL_REPOSTS);

        if (!cancelled) setLocalReposts(cleaned as Post[]);
      } catch (e) {
        console.warn('[Feed] local repost load hata:', e);
      }
    };

    loadLocalReposts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const saveExternal = async () => {
      try {
        const capped = Array.isArray(externalPosts) ? externalPosts.slice(0, MAX_EXTERNAL_POSTS) : [];
        await AsyncStorage.setItem(EXTERNAL_POSTS_KEY, JSON.stringify(capped));
      } catch (e) {
        console.warn('[Feed] external posts save hata:', e);
      }
    };
    saveExternal();
  }, [externalPosts]);

  useEffect(() => {
    const saveLocalReposts = async () => {
      try {
        const capped = Array.isArray(localReposts) ? localReposts.slice(0, MAX_LOCAL_REPOSTS) : [];
        await AsyncStorage.setItem(LOCAL_REPOSTS_KEY, JSON.stringify(capped));
      } catch (e) {
        console.warn('[Feed] local repost save hata:', e);
      }
    };
    saveLocalReposts();
  }, [localReposts]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('viral_share_intent', async (payload: any) => {
      try {
        await AsyncStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(payload || {}));
      } catch {
        // ignore
      }
      await ingestSharePayload(payload as ShareIntentPayload, 'event');
      try {
        await AsyncStorage.removeItem(PENDING_SHARE_KEY);
      } catch {
        // ignore
      }
    });

    return () => {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    };
  }, [displayName]);

  const listRef = useRef<any>(null);
  const pendingScrollPostIdRef = useRef<string | null>(null);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);

  const visiblePosts = (Array.isArray(allPosts) ? allPosts : []).filter(p => !(p as any).archived);

  const dedupedVisiblePosts = useMemo(() => {
    const seen = new Set<string>();

    return visiblePosts.filter(p => {
      const isFreeVideo = !p.isTaskCard && !!(p as any).videoUri;
      const key = isFreeVideo ? `freeVideo:${p.id}|${String((p as any).videoUri)}` : `post:${p.id}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [visiblePosts]);

  const [filter, setFilter] = useState<FeedFilter>('all');

  const filteredPosts = dedupedVisiblePosts.filter(p => {
    const anyP: any = p;
    const isTask = !!p.isTaskCard;
    const isFreeVideo = !p.isTaskCard && !!anyP.videoUri;
    const isExternal = anyP.source === 'external' || anyP.kind === 'external' || anyP.external === true;

    const isMine =
      anyP.ownerId === userId ||
      anyP.userId === userId ||
      anyP.authorId === userId ||
      (p.author && (p.author === displayName || (fullNameStr && p.author === fullNameStr)));

    switch (filter) {
      case 'mine':
        return isMine;
      case 'task':
        return isTask;
      case 'video':
        return isFreeVideo;
      case 'external':
        return isExternal;
      default:
        return true;
    }
  });

  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const [sharePost, setSharePost] = useState<Post | null>(null);
  const [shareVisible, setShareVisible] = useState(false);
  const [selectedSharePlatform, setSelectedSharePlatform] = useState<string | null>(null);

  const [sharePanelVisible, setSharePanelVisible] = useState(false);
  const [sharePanelPost, setSharePanelPost] = useState<Post | null>(null);

  // ✅ ESKİ (dokunmadım): modal video state’leri dursun
  const [videoPost, setVideoPost] = useState<Post | null>(null);
  const [videoVisible, setVideoVisible] = useState(false);

  // ✅ YENİ: Tek aktif video (instance + list satırı)
  const [activeVideo, setActiveVideo] = useState<ActiveVideoState | null>(null);

  // ✅ activeVideo için ref (viewability callback stale olmasın)
  const activeVideoRef = useRef<ActiveVideoState | null>(null);

  useEffect(() => {
    activeVideoRef.current = activeVideo;
  }, [activeVideo]);

  // ✅ görünürlük takip: listeden çıkınca aktif video kapansın
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const av = activeVideoRef.current;
    if (!av?.listItemId) return;

    const stillVisible = viewableItems?.some((v: any) => {
      const it = v?.item;
      const id = String(it?.id ?? it?._id ?? '');
      const isViewable = v?.isViewable !== false; // çoğu zaman true gelir
      return id === av.listItemId && isViewable;
    });

    if (!stillVisible) setActiveVideo(null);
  }).current;

  const [commentsByPost, setCommentsByPost] = useState<Record<string, Comment[]>>({});
  const [commentsHydrated, setCommentsHydrated] = useState(false);

  const [commentsDisabledByPost, setCommentsDisabledByPost] = useState<Record<string, boolean>>({});
  const [commentsDisabledHydrated, setCommentsDisabledHydrated] = useState(false);

  const [commentsPost, setCommentsPost] = useState<Post | null>(null);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsHydrated, setNotificationsHydrated] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);

  const unreadNotificationCount = notifications.filter(n => !n.read).length;

  const [createdAtByPost, setCreatedAtByPost] = useState<Record<string, number>>({});
  const [createdAtHydrated, setCreatedAtHydrated] = useState(false);

  const [refreshMessageVisible, setRefreshMessageVisible] = useState(false);

  const modalDisplayName = selectedPost ? (selectedPost as any).author || displayName : displayName;
  const modalAvatarInitial = modalDisplayName && modalDisplayName.length > 0 ? modalDisplayName[0].toUpperCase() : 'U';

  const anySelected: any = selectedPost as any;
  const safeModalAvatarUri: string | null =
    (anySelected?.author?.avatarUri != null ? String(anySelected.author.avatarUri).trim() : '') ||
    (anySelected?.authorAvatarUri != null ? String(anySelected.authorAvatarUri).trim() : '') ||
    (anySelected?.avatarUri != null ? String(anySelected.avatarUri).trim() : '') ||
    (anySelected?.avatar != null ? String(anySelected.avatar).trim() : '') ||
    null;

  useEffect(() => {
    if (!hydrated) {
      safeHydrate({ silent: true });
    }
  }, [hydrated]);

  // 💾 Yorumları AsyncStorage'dan yükle
  useEffect(() => {
    const loadComments = async () => {
      try {
        const raw = await AsyncStorage.getItem(COMMENTS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, Comment[]>;
          const normalized: Record<string, Comment[]> = {};
          Object.keys(parsed).forEach(postId => {
            const arr = Array.isArray(parsed[postId]) ? parsed[postId] : [];
            normalized[postId] = arr
              .map(c => ({
                ...c,
                likes: typeof c.likes === 'number' ? c.likes : 0,
                parentId: c.parentId ?? null,
              }))
              .slice(0, MAX_COMMENTS_PER_POST);
          });
          setCommentsByPost(normalized);
        }
      } catch (e) {
        console.warn('[Feed] yorumlar yüklenemedi:', e);
      } finally {
        setCommentsHydrated(true);
      }
    };
    loadComments();
  }, []);

  // 💾 Yorumları her değiştiğinde AsyncStorage'a yaz (cap)
  useEffect(() => {
    if (!commentsHydrated) return;
    const saveComments = async () => {
      try {
        const capped: Record<string, Comment[]> = {};
        Object.keys(commentsByPost || {}).forEach(pid => {
          const arr = Array.isArray(commentsByPost[pid]) ? commentsByPost[pid] : [];
          capped[pid] = arr.slice(-MAX_COMMENTS_PER_POST); // en yenileri tut
        });
        await AsyncStorage.setItem(COMMENTS_KEY, JSON.stringify(capped));
      } catch (e) {
        console.warn('[Feed] yorumlar kaydedilemedi:', e);
      }
    };
    saveComments();
  }, [commentsByPost, commentsHydrated]);

  useEffect(() => {
    const loadDisabled = async () => {
      try {
        const raw = await AsyncStorage.getItem(COMMENTS_DISABLED_KEY);
        if (raw) {
          setCommentsDisabledByPost(JSON.parse(raw));
        }
      } catch (e) {
        console.warn('[Feed] yorum kilit durumu yüklenemedi:', e);
      } finally {
        setCommentsDisabledHydrated(true);
      }
    };
    loadDisabled();
  }, []);

  useEffect(() => {
    if (!commentsDisabledHydrated) return;
    const saveDisabled = async () => {
      try {
        await AsyncStorage.setItem(COMMENTS_DISABLED_KEY, JSON.stringify(commentsDisabledByPost));
      } catch (e) {
        console.warn('[Feed] yorum kilit durumu kaydedilemedi:', e);
      }
    };
    saveDisabled();
  }, [commentsDisabledByPost, commentsDisabledHydrated]);

  // 💾 Bildirimleri yükle
  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const raw = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setNotifications(parsed.slice(0, MAX_NOTIFICATIONS));
          }
        }
      } catch (e) {
        console.warn('[Feed] bildirimler yüklenemedi:', e);
      } finally {
        setNotificationsHydrated(true);
      }
    };
    loadNotifications();
  }, []);

  // 💾 Bildirimleri kaydet (cap)
  useEffect(() => {
    if (!notificationsHydrated) return;
    const save = async () => {
      try {
        const capped = Array.isArray(notifications) ? notifications.slice(0, MAX_NOTIFICATIONS) : [];
        await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(capped));
      } catch (e) {
        console.warn('[Feed] bildirimler kaydedilemedi:', e);
      }
    };
    save();
  }, [notifications, notificationsHydrated]);

  // ⏱ createdAt yükle
  useEffect(() => {
    const loadCreatedAt = async () => {
      try {
        const raw = await AsyncStorage.getItem(CREATED_AT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setCreatedAtByPost(parsed as Record<string, number>);
          }
        }
      } catch (e) {
        console.warn('[Feed] createdAt yüklenemedi:', e);
      } finally {
        setCreatedAtHydrated(true);
      }
    };
    loadCreatedAt();
  }, []);

  // ✅ TEK NOKTADAN TÜM VİDEOLARI KAPAT (inline + modal)
  const stopAllVideos = () => {
    setActiveVideo(null);
    // ✅ modal video da açık kalıp ikinci video gibi davranmasın
    setVideoVisible(false);
    setVideoPost(null);
  };

  // Yeni görünen gönderilere timestamp at + cleanup
  useEffect(() => {
    if (!createdAtHydrated) return;

    setCreatedAtByPost(prev => {
      const now = Date.now();
      const updated: Record<string, number> = { ...prev };
      let changed = false;

      dedupedVisiblePosts.forEach(p => {
        const existing = updated[p.id];
        if (typeof existing !== 'number' || Number.isNaN(existing)) {
          updated[p.id] = now;
          changed = true;
        }
      });

      // ✅ cleanup: görünmeyen eski key’leri çok birikmesin
      const keys = Object.keys(updated);
      if (keys.length > MAX_CREATED_AT_ENTRIES) {
        // en yeni timestamp’leri tut
        const sortedKeys = keys
          .map(k => ({ k, v: typeof updated[k] === 'number' ? updated[k] : 0 }))
          .sort((a, b) => b.v - a.v)
          .slice(0, MAX_CREATED_AT_ENTRIES)
          .map(x => x.k);

        const next: Record<string, number> = {};
        sortedKeys.forEach(k => {
          next[k] = updated[k];
        });

        AsyncStorage.setItem(CREATED_AT_KEY, JSON.stringify(next)).catch(e =>
          console.warn('[Feed] createdAt kaydedilemedi:', e),
        );
        return next;
      }

      if (changed) {
        AsyncStorage.setItem(CREATED_AT_KEY, JSON.stringify(updated)).catch(e =>
          console.warn('[Feed] createdAt kaydedilemedi:', e),
        );
        return updated;
      }

      return prev;
    });
  }, [dedupedVisiblePosts, createdAtHydrated]);

  // Bildirim oluştur (cap)
  const addNotification = (text: string, postId?: string | null) => {
    setNotifications(prev => {
      const next = [
        {
          id: String(Date.now()) + Math.random().toString(16).slice(2),
          text,
          ts: Date.now(),
          read: false,
          postId: postId ?? null,
        },
        ...(Array.isArray(prev) ? prev : []),
      ];
      return next.slice(0, MAX_NOTIFICATIONS);
    });
  };

  const getTimeLabel = (post: Post) => {
    const raw = createdAtByPost[post.id];
    if (typeof raw !== 'number' || Number.isNaN(raw) || !Number.isFinite(raw)) {
      return (post as any).time || t('feed.time.justNow', 'az önce');
    }

    const ts = raw;
    const now = Date.now();
    const diffMs = now - ts;
    if (diffMs < 0) return (post as any).time || t('feed.time.justNow', 'az önce');

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return t('feed.time.justNow', 'az önce');

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
      return t('feed.time.minutesAgo', {
        defaultValue: '{{count}} dk önce',
        count: minutes,
      });

    const hours = Math.floor(minutes / 60);
    if (hours < 24)
      return t('feed.time.hoursAgo', {
        defaultValue: '{{count}} saat önce',
        count: hours,
      });

    const days = Math.floor(hours / 24);
    if (days === 1) return t('feed.time.yesterday', 'dün');
    if (days < 7)
      return t('feed.time.daysAgo', {
        defaultValue: '{{count}} gün önce',
        count: days,
      });

    return new Date(ts).toLocaleDateString();
  };

  const getPostSortTs = (p: any): number => {
    try {
      const pick = (v: any) => (v != null ? String(v).trim() : '');
      const candidates = [pick(p?.createdAt), pick(p?.updatedAt), pick(p?.time), pick(p?.lastSharedAt)];

      for (const v of candidates) {
        if (!v) continue;

        const asNum = Number(v);
        if (Number.isFinite(asNum) && asNum > 1000000000) return asNum;

        const tms = new Date(v).getTime();
        if (Number.isFinite(tms) && tms > 0) return tms;
      }

      const id = p?.id != null ? String(p.id) : '';
      const m = id.match(/^ext_(\d{10,13})_/);
      if (m?.[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
      }

      const localTs = createdAtByPost[id];
      if (typeof localTs === 'number' && Number.isFinite(localTs) && localTs > 0) return localTs;

      return 0;
    } catch {
      return 0;
    }
  };

  const sortedFilteredPosts = useMemo(() => {
    const arr = Array.isArray(filteredPosts) ? [...filteredPosts] : [];
    arr.sort((a, b) => getPostSortTs(b as any) - getPostSortTs(a as any));
    return arr;
  }, [filteredPosts, createdAtByPost]);

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const goToOriginalPost = (originalId: string) => {
    pendingScrollPostIdRef.current = originalId;

    if (filter !== 'all') {
      setFilter('all');
      return;
    }

    if (listRef.current) {
      const idx = sortedFilteredPosts.findIndex(p => p.id === originalId);
      if (idx >= 0) {
        try {
          listRef.current.scrollToIndex({ index: idx, animated: true });
          setHighlightedPostId(originalId);
          pendingScrollPostIdRef.current = null;

          setTimeout(() => {
            setHighlightedPostId(prev => (prev === originalId ? null : prev));
          }, 1200);
        } catch (e) {
          console.warn('[Feed] goToOriginalPost scroll hata:', e);
        }
      }
    }
  };

  const handleNotificationPress = (n: Notification) => {
    setNotifications(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)));
    setNotificationsVisible(false);

    if (!n.postId) return;

    pendingScrollPostIdRef.current = n.postId;
    setFilter('all');
  };

  useEffect(() => {
    const targetId = pendingScrollPostIdRef.current;
    if (!targetId || !listRef.current) return;

    const idx = sortedFilteredPosts.findIndex(p => p.id === targetId);
    if (idx < 0) return;

    try {
      listRef.current.scrollToIndex({ index: idx, animated: true });
      setHighlightedPostId(targetId);
      pendingScrollPostIdRef.current = null;

      setTimeout(() => {
        setHighlightedPostId(prev => (prev === targetId ? null : prev));
      }, 1200);
    } catch (e) {
      console.warn('[Feed] scrollToIndex hata:', e);
    }
  }, [sortedFilteredPosts, filter]);

  const toggleCommentsDisabledForPost = (postId: string) => {
    const post = (Array.isArray(allPosts) ? allPosts : []).find(p => p.id === postId);
    const nextDisabled = !commentsDisabledByPost[postId];

    setCommentsDisabledByPost(prev => ({ ...prev, [postId]: nextDisabled }));
    setReplyTo(null);
    setCommentInput('');

    if (post) {
      const titleForNotification = (post as any).title || (post as any).note || t('feed.post.genericTitle', 'Gönderi');
      addNotification(
        t('feed.notifications.commentsToggle', {
          defaultValue: '“{{title}}” gönderisinde yorumları {{state}}.',
          title: titleForNotification,
          state: nextDisabled ? t('feed.notifications.stateClosed', 'kapattın') : t('feed.notifications.stateOpened', 'açtın'),
        }),
        post.id,
      );
    }
  };

  const openShareModal = (post: Post) => {
  if (!(post as any).shareTargets || (post as any).shareTargets.length === 0) return;
  // ✅ paylaşım öncesi video kapat (RAM rahatlasın)
  stopAllVideos();

  setSharePost(post);
  setSelectedSharePlatform((post as any).shareTargets[0]);
  setShareVisible(true);
};

const closeShareModal = () => setShareVisible(false);

const handleConfirmShare = async () => {
  if (!sharePost || !selectedSharePlatform) return;

  // ✅ paylaşım öncesi video kapat (RAM rahatlasın)
  stopAllVideos();

  // ✅ Önce gerçek paylaşım dene (Share sheet)
  // Not: local/external ayrımı paylaşımı engellemesin; sadece video url local ise share sheet’e url eklemiyoruz.
  try {
    await handleShareToPlatform(sharePost, selectedSharePlatform);
  } catch (e) {
    // handleShareToPlatform zaten alert basıyor; burada sadece güvenli kapat
    setShareVisible(false);
    return;
  }

  // ✅ Paylaşım başarılı/iptal edilmediyse simülasyon yerine gerçek işaretleme yap
  try {
    markPostShared(sharePost.id, [selectedSharePlatform]);
  } catch (e) {
    console.warn('[Feed] markPostShared hata:', e);
  }

  const titleForNotification = (sharePost as any).title || (sharePost as any).note || t('feed.post.genericTitle', 'Gönderi');

  addNotification(
    t('feed.notifications.shared', {
      defaultValue: '“{{title}}” gönderisini {{platform}} üzerinde paylaştın.',
      title: titleForNotification,
      platform: selectedSharePlatform,
    }),
    sharePost.id,
  );

  // İstersen success alert kalsın (simülasyon değil)
  Alert.alert(
    t('feed.share.successTitle', 'Paylaşım'),
    t('feed.share.successMessage', {
      defaultValue: '{{platform}} için paylaşım menüsü açıldı.',
      platform: selectedSharePlatform,
    }),
  );

  setShareVisible(false);
};

const handlePostLongPress = (post: Post) => {
  if (isExternalLocal(post)) {
    Alert.alert(
      t('feed.postActions.title', 'Gönderi işlemleri'),
      t('feed.postActions.message', 'Bu gönderi için ne yapmak istersin?'),
      [
        { text: t('feed.postActions.delete', 'Kartı sil'), style: 'destructive', onPress: () => safeRemove(post) },
        { text: t('common.cancel', 'İptal'), style: 'cancel' },
      ],
    );
    return;
  }

  Alert.alert(t('feed.postActions.title', 'Gönderi işlemleri'), t('feed.postActions.message', 'Bu gönderi için ne yapmak istersin?'), [
    { text: t('feed.postActions.archive', 'Kartı arşivle'), onPress: () => safeArchive(post) },
    { text: t('feed.postActions.delete', 'Kartı sil'), style: 'destructive', onPress: () => safeRemove(post) },
    { text: t('common.cancel', 'İptal'), style: 'cancel' },
  ]);
};

const handleFreeVideoActions = (post: Post) => {
  Alert.alert(t('feed.freeVideo.title', 'Video'), t('feed.freeVideo.message', 'Bu videoyla ne yapmak istersin?'), [
    { text: t('feed.freeVideo.delete', 'Videoyu sil'), style: 'destructive', onPress: () => safeRemove(post) },
    { text: t('common.cancel', 'İptal'), style: 'cancel' },
  ]);
};

const handleOpenDetail = (post: Post) => {
  // ✅ detay açarken video kapat
  stopAllVideos();

  setSelectedPost(post);
  setDetailVisible(true);
};

const handleCloseDetail = () => setDetailVisible(false);

const openComments = (post: Post) => {
  const disabled = commentsDisabledByPost[post.id];
  if (disabled) {
    Alert.alert(t('feed.comments.disabledTitle', 'Yorumlar kapalı'), t('feed.comments.disabledMessage', 'Bu gönderide yorumlar kapalı.'));
    return;
  }

  // ✅ yorum açarken video kapat
  stopAllVideos();

  setCommentsPost(post);
  setCommentsVisible(true);
  setReplyTo(null);
  setCommentInput('');
};

const closeComments = () => {
  setCommentsVisible(false);
  setCommentsPost(null);
  setReplyTo(null);
  setCommentInput('');
};

const handleSendComment = () => {
  const text = commentInput.trim();
  if (!text || !commentsPost) return;

  const titleForNotification = (commentsPost as any).title || (commentsPost as any).note || t('feed.post.genericTitle', 'Gönderi');

  setCommentsByPost(prev => {
    const prevList = Array.isArray(prev[commentsPost.id]) ? prev[commentsPost.id] : [];
    const newComment: Comment = {
      id: String(Date.now()) + Math.random().toString(16).slice(2),
      postId: commentsPost.id,
      author: displayName,
      text,
      ts: Date.now(),
      likes: 0,
      parentId: replyTo ? replyTo.id : null,
    };
    const nextList = [...prevList, newComment].slice(-MAX_COMMENTS_PER_POST);
    return { ...prev, [commentsPost.id]: nextList };
  });

  addNotification(
    t('feed.notifications.addedComment', { defaultValue: '“{{title}}” gönderisine bir yorum ekledin.', title: titleForNotification }),
    commentsPost.id,
  );

  setCommentInput('');
  setReplyTo(null);
};

const handleLikeComment = (comment: Comment) => {
  setCommentsByPost(prev => {
    const list = Array.isArray(prev[comment.postId]) ? prev[comment.postId] : [];
    return { ...prev, [comment.postId]: list.map(c => (c.id === comment.id ? { ...c, likes: (c.likes || 0) + 1 } : c)) };
  });
};

const handleDeleteComment = (target: Comment) => {
  setCommentsByPost(prev => {
    const list = Array.isArray(prev[target.postId]) ? prev[target.postId] : [];
    const toDelete = new Set<string>([target.id]);

    let changed = true;
    while (changed) {
      changed = false;
      for (const c of list) {
        if (c.parentId && toDelete.has(c.parentId) && !toDelete.has(c.id)) {
          toDelete.add(c.id);
          changed = true;
        }
      }
    }

    const remaining = list.filter(c => !toDelete.has(c.id));
    return { ...prev, [target.postId]: remaining };
  });

  if (replyTo && replyTo.id === target.id) setReplyTo(null);
};

const handleShareToPlatform = async (post: Post, platformLabel: string) => {
  try {
    // ✅ dışa paylaşım öncesi video kapat (RAM rahatlasın)
    stopAllVideos();

    const mainText = (post as any).note || (post as any).body || (post as any).title || t('feed.share.defaultText', 'Shared from Viral');
    const viralPromo = '\n\nCreated on Viral 🎯\n\nDiscover Viral:\nhttps://viral.app';

    const message = t('feed.share.shareText', {
      defaultValue: '{{platform}} share:\n{{text}}',
      platform: platformLabel,
      text: mainText + viralPromo,
    });

    // ✅ videoUri local ise url verme (Share sheet gene açılır)
    const rawUrl = typeof (post as any).videoUri === 'string' ? (post as any).videoUri : undefined;
    const url = rawUrl && !isExternalLocal(post) ? rawUrl : undefined;

    await Share.share(url ? { message, url } : { message });
  } catch (e) {
    console.warn('[Share] paylaşım hatası veya iptal:', e);
    Alert.alert(t('feed.share.errorTitle', 'Paylaşım'), t('feed.share.errorMessage', 'Paylaşım iptal edildi veya bir hata oluştu.'));
    throw e;
  }
};

const handleRepost = (post: Post) => safeRepost(post);

const openSharePanelForPost = (post: Post) => {
  // ✅ panel açarken video kapat
  stopAllVideos();

  setSharePanelPost(post);
  setSharePanelVisible(true);
};

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    // ✅ yenilerken video kapat
    stopAllVideos();

    setRefreshing(true);
    try {
      await safeHydrate({ silent: true });
      hydrateFocusNetworkAll({ userId: resolvedUserId });

      try {
        const raw = await AsyncStorage.getItem(PENDING_SHARE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          await ingestSharePayload(parsed as ShareIntentPayload, 'storage');
        }
      } catch {
        // ignore
      }
    } catch (e) {
      console.warn('[Feed] refresh hata:', e);
      setFeedError(getUserMessage(e, t('feed.errors.loadFailed', 'Akış yüklenemedi. Lütfen tekrar dene.')));
    } finally {
      setTimeout(() => {
        setRefreshing(false);
        setRefreshMessageVisible(true);
        setTimeout(() => setRefreshMessageVisible(false), 2500);
      }, 600);
    }
  };

  // ✅ tek video açma yardımcıları (repost embed dahil)
  const openInlineVideo = (instanceId: string, listItemId: string, uri: string) => {
    // ✅ inline açılırken modal video varsa da kapansın
    setVideoVisible(false);
    setVideoPost(null);

    setActiveVideo(prev => {
      if (prev?.instanceId === instanceId) return null; // aynı video -> kapat
      // ✅ overlay yok: aktif olunca direkt oynasın, tek video kuralı zaten sağlar
      return { instanceId, listItemId, uri, paused: false };
    });
  };

  // (kalsın, ileride lazım olabilir)
  const startInlineVideo = (instanceId: string) => {
    setActiveVideo(prev => {
      if (!prev || prev.instanceId !== instanceId) return prev;
      return { ...prev, paused: false };
    });
  };

  const stopInlineVideo = () => {
    // ✅ inline kapatırken modal video da açık kalmasın (çifte oynatma riskini kes)
    stopAllVideos();
  };

  // 🔥 Tüm gönderiler için ortak kart render fonksiyonu
  const renderFullPostCard = (
    base: Post,
    options?: {
      isHighlighted?: boolean;
      embedded?: boolean;
      onPressCard?: () => void;

      // ✅ EK: repost embedded video çakışmasın diye instanceId + listItemId
      instanceId?: string;
      listItemId?: string;
    },
  ) => {
    const anyBase: any = base;

    const isFreeVideoPost = !base.isTaskCard && !!anyBase.videoUri;
    const isHighlighted = options?.isHighlighted ?? false;
    const embedded = options?.embedded ?? false;

    const cardTitleText = anyBase.title || anyBase.note || t('feed.post.genericTitle', 'Paylaşım');

    const cardDisplayName = anyBase.author || displayName;
    const avatarInitial = (cardDisplayName[0] || displayName[0] || 'U').toUpperCase();

    const isMinePost =
      anyBase.ownerId === userId ||
      anyBase.userId === userId ||
      anyBase.authorId === userId ||
      (anyBase.author && (anyBase.author === displayName || (fullNameStr && anyBase.author === fullNameStr)));

    const likeCount =
      (typeof anyBase.likes === 'number' && Number.isFinite(anyBase.likes) ? anyBase.likes : undefined) ??
      (typeof (base as any).likes === 'number' && Number.isFinite((base as any).likes) ? (base as any).likes : 0);

    const commentsForPost = commentsByPost[base.id] || [];
    const commentCount = commentsForPost.length;
    const commentsDisabled = !!commentsDisabledByPost[base.id];

    const reshareCount =
      (typeof anyBase.reshareCount === 'number' && Number.isFinite(anyBase.reshareCount) ? anyBase.reshareCount : undefined) ??
      (typeof anyBase.repostCount === 'number' && Number.isFinite(anyBase.repostCount) ? anyBase.repostCount : 0) ??
      0;

    const sharedTargets =
      anyBase.lastSharedTargets && anyBase.lastSharedTargets.length > 0
        ? anyBase.lastSharedTargets
        : anyBase.shareTargets && anyBase.shareTargets.length > 0
        ? anyBase.shareTargets
        : [];

    const taskSharedTargets = base.isTaskCard && sharedTargets.length > 0 ? sharedTargets : [];

    const cardAvatarUri: string | null =
      (isMinePost ? (myAvatarUri != null ? String(myAvatarUri).trim() : '') : '') || resolveAvatarUri(anyBase) || null;

    const postId = String((base as any)?.id ?? '');
    const listItemId = String(options?.listItemId ?? postId);
    const instanceId = String(options?.instanceId ?? postId);

    const videoUri = typeof anyBase?.videoUri === 'string' ? String(anyBase.videoUri) : '';

    const isThisVideoActive = !!videoUri && activeVideo?.instanceId === instanceId;
    const isThisVideoPaused = !isThisVideoActive || !!activeVideo?.paused;

    // ✅ SERBEST VİDEO PAYLAŞIM CARDI (INLINE)
    if (isFreeVideoPost) {
      return (
        <Pressable
          style={[styles.card, isHighlighted && styles.cardHighlighted, embedded && styles.embeddedCard]}
          onLongPress={() => handlePostLongPress(base)}
        >
          <View style={styles.freeVideoHeaderRow}>
            <View style={styles.authorRow}>
              {cardAvatarUri ? (
                <Image source={{ uri: cardAvatarUri }} style={styles.authorAvatar} />
              ) : (
                <View style={styles.authorAvatarFallback}>
                  <Text style={styles.authorAvatarInitial}>{avatarInitial}</Text>
                </View>
              )}
              <View>
                <Text style={styles.authorName} numberOfLines={1}>
                  {cardDisplayName}
                </Text>
                <Text style={styles.freeVideoTimeText}>{getTimeLabel(base)}</Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.freeVideoMenuBtn, pressed && styles.freeVideoMenuBtnPressed]}
              onPress={() => handleFreeVideoActions(base)}
            >
              <Text style={styles.freeVideoMenuIcon}>⋯</Text>
            </Pressable>
          </View>

          {isExternalLocal(base) && (
            <Text style={{ color: '#AAB0C5', fontSize: 11, marginBottom: 4 }}>{t('feed.external.badge', 'Dış paylaşım')}</Text>
          )}

          {anyBase.note ? <Text style={styles.freeVideoCaption}>{anyBase.note}</Text> : null}

          {/* ✅ Video INLINE: HER ZAMAN MOUNT — ilk frame gelir */}
          <Pressable
            style={styles.freeVideoPlayerWrapper}
            onPress={() => {
              if (!videoUri) return;
              openInlineVideo(instanceId, listItemId, videoUri);
            }}
          >
            {/* ✅ aktif değilken video alanı tıklanamaz (native play ile ikinci video başlamasın) */}
            <View style={styles.freeVideoPlayer} pointerEvents={isThisVideoActive ? 'auto' : 'none'}>
              <Video
                source={{ uri: videoUri }}
                style={{ width: '100%', height: '100%' }}
                // ✅ sadece aktif videoda kontrol olsun (aktif değilken kullanıcı play'e basamasın)
                controls={isThisVideoActive}
                resizeMode="contain"
                // ✅ sadece aktif video oynasın, aktif değilse kesin pause
                paused={!isThisVideoActive || isThisVideoPaused}
                repeat={false}
                playInBackground={false}
                playWhenInactive={false}
                useTextureView={true} // ✅ Android siyah ekran fix
                onError={e => {
                  console.warn('[Feed] inline video error:', e);
                  stopInlineVideo();
                }}
                onEnd={() => stopInlineVideo()}
              />
            </View>

            <View style={styles.videoWatermark}>
              <Image source={VIRAL_LOGO} style={styles.videoWatermarkLogo} />
            </View>
          </Pressable>

          <View style={styles.row}>
            <View style={styles.freeVideoShareLeft}>
              {sharedTargets.length > 0 && (
                <View style={styles.sharedPlatformsRow}>
                  {sharedTargets.map((label: string) => (
                    <Pressable
                      key={label}
                      onPress={() => {
                        // ✅ sadece inline değil, modal video da kapansın
                        stopAllVideos();
                        handleShareToPlatform(base, label);
                      }}
                    >
                      <Image source={getPlatformIcon(label)} style={styles.sharedPlatformIcon} resizeMode="contain" />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.actions}>
              {commentsDisabled ? (
                <View style={styles.commentsOffPill}>
                  <Text style={styles.commentsOffText}>{t('feed.comments.offLabel', 'Yorumlar kapalı')}</Text>
                </View>
              ) : (
                <Pressable style={({ pressed }) => [styles.commentBtn, pressed && styles.commentBtnPressed]} onPress={() => openComments(base)}>
                  <Text style={styles.commentBtnText}>💬 {commentCount}</Text>
                </Pressable>
              )}

              <Pressable style={({ pressed }) => [styles.shareTriggerBtn, pressed && styles.shareTriggerBtnPressed]} onPress={() => openSharePanelForPost(base)}>
                <Text style={styles.shareTriggerText}>🌐</Text>
              </Pressable>

              {isExternalLocal(base) &&
                (() => {
                  const contentText =
                    (anyBase.body != null ? String(anyBase.body) : '').trim() ||
                    (anyBase.note != null ? String(anyBase.note) : '').trim() ||
                    (anyBase.text != null ? String(anyBase.text) : '').trim() ||
                    (anyBase.content != null ? String(anyBase.content) : '').trim() ||
                    '';

                  const linkText =
                    (anyBase.url != null ? String(anyBase.url) : '').trim() ||
                    (anyBase.link != null ? String(anyBase.link) : '').trim() ||
                    (contentText ? extractFirstUrl(contentText) : null) ||
                    '';

                  if (!linkText) return null;

                  return (
                    <Pressable
                      style={({ pressed }) => [styles.externalLinkBtn, pressed && styles.shareTriggerBtnPressed, { marginRight: 6 }]}
                      onPress={(e: any) => {
                        e?.stopPropagation?.();
                        try {
                          Linking.openURL(linkText);
                        } catch {}
                      }}
                    >
                      <Text style={styles.externalLinkIcon}>🔗</Text>
                    </Pressable>
                  );
                })()}

              <Pressable style={({ pressed }) => [styles.repostBtn, pressed && styles.repostBtnPressed]} onPress={() => handleRepost(base)}>
                <Text style={styles.repostBtnText}>🔁 {reshareCount}</Text>
              </Pressable>

              <AnimatedLikeButton likes={likeCount} onPress={() => safeLike(base)} />
            </View>
          </View>
        </Pressable>
      );
    }

    // 🔵 GÖREV KARTI
    return (
      <Pressable
        style={[styles.card, isHighlighted && styles.cardHighlighted, embedded && styles.embeddedCard]}
        onPress={() => {
          if (options?.onPressCard) options.onPressCard();
          else handleOpenDetail(base);
        }}
        onLongPress={() => handlePostLongPress(base)}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.title}>{cardTitleText}</Text>
            {base.isTaskCard && (
              <View style={styles.taskBadgeRow}>
                <Image source={VIRAL_LOGO} style={styles.taskBadgeLogo} />
                <Text style={styles.badge}>{t('feed.badges.taskCard', 'Görev kartı')}</Text>
              </View>
            )}
            {isExternalLocal(base) && (
              <Text style={{ color: '#AAB0C5', fontSize: 11, marginTop: 4 }}>{t('feed.external.badge', 'Dış paylaşım')}</Text>
            )}
          </View>
          <Text style={styles.time} numberOfLines={1}>
            {getTimeLabel(base)}
          </Text>
        </View>

        <View style={styles.cardAuthorRow}>
          {cardAvatarUri ? (
            <Image source={{ uri: cardAvatarUri }} style={styles.authorAvatar} />
          ) : (
            <View style={styles.authorAvatarFallback}>
              <Text style={styles.authorAvatarInitial}>{avatarInitial}</Text>
            </View>
          )}
          <Text style={styles.cardAuthorName} numberOfLines={1}>
            {cardDisplayName}
          </Text>
        </View>

        {(() => {
          const contentTextRaw =
            (anyBase.body != null ? String(anyBase.body) : '').trim() ||
            (anyBase.note != null ? String(anyBase.note) : '').trim() ||
            (anyBase.text != null ? String(anyBase.text) : '').trim() ||
            (anyBase.content != null ? String(anyBase.content) : '').trim() ||
            '';

          const linkText =
            (anyBase.url != null ? String(anyBase.url) : '').trim() ||
            (anyBase.link != null ? String(anyBase.link) : '').trim() ||
            (contentTextRaw ? extractFirstUrl(contentTextRaw) : null) ||
            '';

          const contentText =
            linkText && contentTextRaw.includes(linkText)
              ? contentTextRaw.replace(linkText, '').replace(/\n{3,}/g, '\n\n').trim()
              : contentTextRaw;

          return (
            <>
              {contentText ? <Text style={styles.body}>{contentText}</Text> : null}

              {!!linkText && (
                <Pressable
                  onPress={(e: any) => {
                    e?.stopPropagation?.();
                    try {
                      Linking.openURL(linkText);
                    } catch {}
                  }}
                  style={{ marginTop: 6 }}
                >
                  <Text style={[styles.body, { textDecorationLine: 'underline', opacity: 0.9 }]}>{linkText}</Text>
                </Pressable>
              )}
            </>
          );
        })()}

        {taskSharedTargets.length > 0 && (
          <View style={styles.taskSharedRow}>
            <Text style={styles.taskSharedLabel}>{t('feed.share.alsoSharedOn', 'Şurada da paylaşıldı:')}</Text>
            <View style={styles.sharedPlatformsRow}>
              {taskSharedTargets.map((label: string) => (
                <Image key={label} source={getPlatformIcon(label)} style={styles.sharedPlatformIcon} resizeMode="contain" />
              ))}
            </View>
          </View>
        )}

        {/* ✅ Görev kartında videoUri varsa: INLINE oynat (tek aktif) */}
        {anyBase.videoUri ? (
          <View style={styles.videoInfoRow}>
            <Text style={styles.videoInfo}>{t('feed.video.info', '📹 Bu kartla birlikte bir video planlandı.')}</Text>

            <Pressable
              style={({ pressed }) => [styles.videoPlayBtn, pressed && styles.videoPlayBtnPressed]}
              onPress={(e: any) => {
                e?.stopPropagation?.();
                if (!videoUri) return;
                openInlineVideo(instanceId, listItemId, videoUri);
              }}
            >
              <Text style={styles.videoPlayText}>
                {isThisVideoActive ? t('feed.video.closeInline', 'Videoyu kapat') : t('feed.video.watch', 'Videoyu izle')}
              </Text>
            </Pressable>

            {isThisVideoActive ? (
              <View style={[styles.freeVideoPlayerWrapper, { marginTop: 10 }]}>
                <View style={styles.freeVideoPlayer}>
                  <Video
                    source={{ uri: videoUri }}
                    style={{ width: '100%', height: '100%' }}
                    controls
                    resizeMode="contain"
                    paused={isThisVideoPaused}
                    repeat={false}
                    playInBackground={false}
                    playWhenInactive={false}
                    useTextureView={true}
                    onError={e => {
                      console.warn('[Feed] inline task video error:', e);
                      stopInlineVideo();
                    }}
                    onEnd={() => stopInlineVideo()}
                  />
                </View>

                <View style={styles.videoWatermark}>
                  <Image source={VIRAL_LOGO} style={styles.videoWatermarkLogo} />
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.cardFooterRow}>
          <View style={{ flex: 1 }} />

          <View style={styles.actions}>
            {commentsDisabled ? (
              <View style={styles.commentsOffPill}>
                <Text style={styles.commentsOffText}>{t('feed.comments.offLabel', 'Yorumlar kapalı')}</Text>
              </View>
            ) : (
              <Pressable style={({ pressed }) => [styles.commentBtn, pressed && styles.commentBtnPressed]} onPress={() => openComments(base)}>
                <Text style={styles.commentBtnText}>💬 {commentCount}</Text>
              </Pressable>
            )}

            <Pressable style={({ pressed }) => [styles.shareTriggerBtn, pressed && styles.shareTriggerBtnPressed]} onPress={() => openSharePanelForPost(base)}>
              <Text style={styles.shareTriggerText}>🌐</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.repostBtn, pressed && styles.repostBtnPressed]} onPress={() => handleRepost(base)}>
              <Text style={styles.repostBtnText}>🔁 {reshareCount}</Text>
            </Pressable>

            <AnimatedLikeButton likes={likeCount} onPress={() => safeLike(base)} />
          </View>
        </View>
      </Pressable>
    );
  };

  const renderItem = ({ item }: ListRenderItemInfo<Post>) => {
    const anyItem: any = item;

    const originalPostId: string | undefined =
      (anyItem.repostOfId as string | undefined) ?? (anyItem.originalPostId as string | undefined);

    const originalPost =
      originalPostId && originalPostId !== item.id
        ? (Array.isArray(allPosts) ? allPosts : []).find(p => p.id === originalPostId) || null
        : null;

    const isRepost = !!originalPost;
    const isHighlighted = highlightedPostId === item.id;

    if (isRepost && originalPost) {
      const repostDisplayName = (item as any).author || displayName;
      const repostAvatarInitial = (repostDisplayName[0] || displayName[0] || 'U').toUpperCase();

      const goToOriginal = () => {
        goToOriginalPost(originalPost.id);
      };

      const repostIsMine =
        anyItem.ownerId === userId ||
        anyItem.userId === userId ||
        anyItem.authorId === userId ||
        (anyItem.author && (anyItem.author === displayName || (fullNameStr && anyItem.author === fullNameStr)));

      const repostAvatarUri: string | null =
        (repostIsMine ? (myAvatarUri ? String(myAvatarUri).trim() : null) : null) || resolveAvatarUri(anyItem) || null;

      // ✅ repost embedded instanceId: orijinal kartla çakışmasın
      const embeddedInstanceId = `embed:${String(item.id)}:${String(originalPost.id)}`;

      return (
        <Pressable style={[styles.card, isHighlighted && styles.cardHighlighted]} onPress={goToOriginal} onLongPress={() => handlePostLongPress(item)}>
          <View style={styles.freeVideoHeaderRow}>
            <Pressable style={styles.authorRow} onPress={goToOriginal}>
              {repostAvatarUri ? (
                <Image source={{ uri: repostAvatarUri }} style={styles.authorAvatar} />
              ) : (
                <View style={styles.authorAvatarFallback}>
                  <Text style={styles.authorAvatarInitial}>{repostAvatarInitial}</Text>
                </View>
              )}
              <View>
                <Text style={styles.authorName} numberOfLines={1}>
                  {repostDisplayName}
                </Text>
                <Text style={styles.freeVideoTimeText}>{getTimeLabel(item)}</Text>
              </View>
            </Pressable>
          </View>

          <Text style={styles.repostLabel}>🔁</Text>

          <Pressable style={styles.repostInnerContainer} onPress={goToOriginal}>
            {renderFullPostCard(originalPost, {
              embedded: true,
              onPressCard: goToOriginal,
              instanceId: embeddedInstanceId,
              listItemId: String(item.id), // ✅ viewability bununla kapanır
            })}
          </Pressable>
        </Pressable>
      );
    }

    return renderFullPostCard(item, { isHighlighted, instanceId: String(item.id), listItemId: String(item.id) });
  };

  const currentComments: Comment[] = commentsPost && commentsByPost[commentsPost.id] ? commentsByPost[commentsPost.id] : [];

  const commentsDisabledForCurrent = commentsPost && commentsDisabledByPost[commentsPost.id];
  const isCurrentPostOwner = !!commentsPost && (((commentsPost as any).author || displayName) === displayName);

  const renderCommentsTree = () => {
    if (currentComments.length === 0) return null;

    const sorted = currentComments.slice().sort((a, b) => a.ts - b.ts);

    const roots = sorted.filter(c => !c.parentId);
    const renderThread = (comment: Comment, depth: number): React.ReactNode[] => {
      const replies = sorted.filter(c => c.parentId === comment.id);
      const isReply = depth > 0;
      const timeLabel = new Date(comment.ts).toLocaleTimeString();
      const authorInitial = (comment.author?.trim?.()[0] || '?').toUpperCase();

      const node = (
        <Pressable
          key={comment.id}
          style={({ pressed }) => [styles.commentRow, isReply && styles.commentRowReply, pressed && styles.commentRowPressed]}
          delayLongPress={300}
          onLongPress={() => {
            if (comment.author !== displayName) return;
            Alert.alert(t('feed.comments.actionsTitle', 'Yorum işlemi'), t('feed.comments.deleteQuestion', 'Bu yorumu silmek istiyor musun?'), [
              { text: t('common.cancel', 'Vazgeç'), style: 'cancel' },
              { text: t('feed.comments.delete', 'Yorumu sil'), style: 'destructive', onPress: () => handleDeleteComment(comment) },
            ]);
          }}
        >
          <View style={styles.commentAvatar}>
            <Text style={styles.commentAvatarInitial}>{authorInitial}</Text>
          </View>

          <View style={[styles.commentContent, isReply && styles.commentReplyContent]}>
            <View style={styles.commentHeaderRow}>
              <Text style={styles.commentAuthor}>{comment.author}</Text>
              <Text style={styles.commentTime}>{timeLabel}</Text>
            </View>
            <Text style={styles.commentText}>{comment.text}</Text>
            <View style={styles.commentFooterRow}>
              <Pressable style={({ pressed }) => [styles.commentLikeBtn, pressed && styles.commentLikeBtnPressed]} onPress={() => handleLikeComment(comment)}>
                <Text style={styles.commentLikeText}>
                ❤️ {comment.likes || 0}
               </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.commentReplyBtn, pressed && styles.commentReplyBtnPressed]}
                onPress={() => setReplyTo(comment)}
              >
                <Text style={styles.commentReplyText}>{t('feed.comments.reply', 'Yanıtla')}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      );

      return [node, ...replies.flatMap(r => renderThread(r, depth + 1))];
    };

    return roots.flatMap(root => renderThread(root, 0));
  };

  const commentDragResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const startY = gestureState.moveY - gestureState.dy;
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && startY < 260;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 60) closeComments();
      },
    }),
  ).current;

  const renderNotifications = () => {
    if (notifications.length === 0) {
      return <Text style={styles.notificationsEmptyText}>{t('feed.notifications.empty', 'Henüz bildirimin yok. Yorum yazdıkça ve ayarlarla oynadıkça burada gözükecek.')}</Text>;
    }

    return (
      <ScrollView contentContainerStyle={styles.notificationsList} keyboardShouldPersistTaps="handled">
        {notifications.map(n => (
          <Pressable key={n.id} style={({ pressed }) => [styles.notificationItem, pressed && styles.notificationItemPressed]} onPress={() => handleNotificationPress(n)}>
            <Text style={[styles.notificationText, !n.read && styles.notificationTextUnread]}>{n.text}</Text>
            <Text style={styles.notificationTime}>{new Date(n.ts).toLocaleString()}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  };

  const renderFilterChip = (label: string, value: FeedFilter) => {
    const active = filter === value;
    return (
      <Pressable key={value} style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.filterChipPressed]} onPress={() => setFilter(value)}>
        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerTextBlock}>
          <View style={styles.headerTitleRow}>
            <Image source={VIRAL_LOGO} style={styles.headerLogo} />
            <Text style={styles.headerTitle}>{t('feed.headerTitle', 'Akış')}</Text>
          </View>
          <Text style={styles.headerSub}>{t('feed.headerSub', { defaultValue: 'Merhaba, {{name}} 👋', name: firstName })}</Text>
          <Text style={styles.headerTagline}>{t('feed.headerTagline', 'Görevlerin, videoların ve paylaşımların — hepsi burada birleşiyor.')}</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.bellBtn, pressed && styles.bellBtnPressed]} onPress={() => setNotificationsVisible(true)}>
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadNotificationCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Focus Ağı */}
      <View style={styles.focusNetworkBar}>
        <Pressable
          style={({ pressed }) => [styles.focusNetworkButton, pressed && { opacity: 0.9 }]}
          onPress={async () => {
            await markFocusRequestsSeen();
            setActiveVideo(null);
            go('FocusNetwork');
          }}
        >
          <View style={styles.focusNetworkBtnInner}>
            <Text style={styles.focusNetworkText}>{t('feed.focusNetwork.button', 'Focus Ağına Git')}</Text>

            {pendingFocusRequestsCount > 0 && (
              <Animated.View
                style={[
                  styles.focusNetworkBadge,
                  hasNewFocusRequests && { opacity: 1 },
                  { transform: [{ scale: hasNewFocusRequests ? combinedScale : 1 }], opacity: hasNewFocusRequests ? pulseOpacity : 1 },
                ]}
              >
                <Text style={styles.focusNetworkBadgeText}>{pendingFocusRequestsCount > 99 ? '99+' : pendingFocusRequestsCount}</Text>
              </Animated.View>
            )}

            {hasNewFocusRequests && <Animated.View style={[styles.focusNetworkNewDot, { opacity: pulseOpacity }]} />}
          </View>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {renderFilterChip(t('feed.filters.all', 'Tümü'), 'all')}
        {renderFilterChip(t('feed.filters.mine', 'Benim '), 'mine')}
        {renderFilterChip(t('feed.filters.tasks', 'Görev kartları'), 'task')}
        {renderFilterChip(t('feed.filters.video', 'Video'), 'video')}
        {renderFilterChip(t('feed.filters.external', 'Dış aktivite'), 'external')}
      </View>

      {refreshMessageVisible && (
        <View style={styles.refreshBanner}>
          <Text style={styles.refreshBannerText}>{t('feed.refreshBanner', 'Akış yenilendi.')}</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={sortedFilteredPosts}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={sortedFilteredPosts.length ? styles.list : styles.listEmptyContainer}
        ListEmptyComponent={
          <View style={styles.empty}>
            {feedError ? (
              <>
                <Text style={styles.emptyText}>{feedError}</Text>
                <Pressable style={({ pressed }) => [styles.emptyCtaBtn, pressed && styles.emptyCtaBtnPressed]} onPress={() => safeHydrate()}>
                  <Text style={styles.emptyCtaText}>{t('common.retry', 'Tekrar dene')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.emptyText}>{hydrated ? t('feed.empty.noPosts', 'Henüz gönderi yok.') : t('feed.empty.loading', 'Akış yükleniyor...')}</Text>
                {hydrated && (
                  <Pressable
                    style={({ pressed }) => [styles.emptyCtaBtn, pressed && styles.emptyCtaBtnPressed]}
                    onPress={() => {
                      markNextUploadAsFree();
                      setActiveVideo(null);
                      go('Upload');
                    }}
                  >
                    <Text style={styles.emptyCtaText}>{t('feed.empty.cta', 'İlk görevini / videonu oluştur')}</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        onScrollToIndexFailed={info => {
          try {
            const offset = (info.averageItemLength || 80) * (info.index || 0);
            listRef.current?.scrollToOffset({ offset: Math.max(0, offset), animated: true });
            setTimeout(() => {
              try {
                listRef.current?.scrollToIndex({ index: info.index, animated: true });
              } catch {}
            }, 250);
          } catch {}
        }}
        // ✅ Perf / OOM sigortası
        removeClippedSubviews={false} // ✅ MECBUR: Android + Video + clipped = Surface/Texture leak/OOM
        windowSize={5}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={50}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollBeginDrag={() => setActiveVideo(null)}
        onMomentumScrollBegin={() => setActiveVideo(null)}
        // ✅ Scroll başlayınca oynayan video dursun (tek video / crash fix)
        // onScrollBeginDrag={() => setActiveVideo(null)}      // ✅ MECBUR: aynı handler 2 kez yazılmıştı, silmedim — devre dışı
        // onMomentumScrollBegin={() => setActiveVideo(null)}  // ✅ MECBUR: aynı handler 2 kez yazılmıştı, silmedim — devre dışı
      />

      {/* FAB */}
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => {
          markNextUploadAsFree();
          setActiveVideo(null);
          go('Upload');
        }}
      >
        <Text style={styles.fabIcon}>＋</Text>
      </Pressable>

      {/* Detay modal */}
      {selectedPost && (
        <Modal visible={detailVisible} transparent animationType="slide" onRequestClose={handleCloseDetail}>
          <TouchableWithoutFeedback onPress={handleCloseDetail}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            <View style={styles.modalFooterRow}>
              <View style={styles.authorRow}>
                {safeModalAvatarUri ? (
                  <Image source={{ uri: safeModalAvatarUri }} style={styles.authorAvatar} />
                ) : (
                  <View style={styles.authorAvatarFallback}>
                    <Text style={styles.authorAvatarInitial}>{modalAvatarInitial}</Text>
                  </View>
                )}
                <Text style={styles.authorName} numberOfLines={1}>
                  {modalDisplayName}
                </Text>
              </View>
            </View>

            <Text style={styles.modalTitle}>{(selectedPost as any).title || (selectedPost as any).note || t('feed.post.genericTitle', 'Paylaşım')}</Text>

            {(selectedPost as any).isTaskCard && (
              <View style={styles.taskBadgeRow}>
                <Image source={VIRAL_LOGO} style={styles.taskBadgeLogo} />
                <Text style={styles.modalBadge}>{t('feed.badges.taskCard', 'Görev kartı')}</Text>
              </View>
            )}

            {isExternalLocal(selectedPost) && <Text style={{ color: '#AAB0C5', fontSize: 11, marginBottom: 6 }}>{t('feed.external.badge', 'Dış paylaşım')}</Text>}

            <Text style={styles.modalTime}>{getTimeLabel(selectedPost)}</Text>

            {(selectedPost as any).body ? <Text style={styles.modalBody}>{(selectedPost as any).body}</Text> : null}

            {(selectedPost as any).note ? (
              <Text style={styles.modalNote}>
                {t('feed.labels.descriptionPrefix', 'Açıklama:')} {(selectedPost as any).note}
              </Text>
            ) : null}

            {(selectedPost as any).shareTargets && (selectedPost as any).shareTargets.length > 0 && (
              <Text style={styles.modalShare}>
                {t('feed.share.plannedShort', 'Planlanan paylaşım')} {(selectedPost as any).shareTargets.join(', ')}
              </Text>
            )}

            {(selectedPost as any).videoUri ? <Text style={styles.modalVideo}>{t('feed.video.info', '📹 Bu kartla birlikte bir video planlandı.')}</Text> : null}

            <View style={styles.modalFooterRow}>
              <Text style={styles.modalAuthor}>{(selectedPost as any).author || displayName}</Text>
              <AnimatedLikeButton
                likes={typeof (selectedPost as any).likes === 'number' && Number.isFinite((selectedPost as any).likes) ? (selectedPost as any).likes : 0}
                onPress={() => safeLike(selectedPost)}
              />
            </View>

            <Pressable style={styles.modalCloseBtn} onPress={handleCloseDetail}>
              <Text style={styles.modalCloseText}>{t('common.close', 'Kapat')}</Text>
            </Pressable>
          </View>
        </Modal>
      )}

      {/* Share modal (eski) */}
      {sharePost && (
        <Modal visible={shareVisible} transparent animationType="slide" onRequestClose={closeShareModal}>
          <TouchableWithoutFeedback onPress={closeShareModal}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View style={styles.shareSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.shareSheetTitle}>{t('feed.share.choose', 'Paylaşım seç')}</Text>

            {(sharePost as any).shareTargets && (sharePost as any).shareTargets.length > 0 && (
              <View style={styles.sharePlatformRow}>
                {(sharePost as any).shareTargets.map((label: string) => {
                  const isSelected = label === selectedSharePlatform;
                  return (
                    <Pressable
                      key={label}
                      style={({ pressed }) => [styles.sharePlatformChip, isSelected && styles.sharePlatformChipSelected, pressed && styles.sharePlatformChipPressed]}
                      onPress={() => setSelectedSharePlatform(label)}
                    >
                      <Text style={[styles.sharePlatformChipText, isSelected && styles.sharePlatformChipTextSelected]} numberOfLines={1}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {selectedSharePlatform && (
              <View style={{ marginTop: 12 }}>
                <View style={styles.sharePreviewBox}>
                  <Text style={styles.sharePreviewTitle}>{t('feed.share.previewTitle', 'Paylaşım önizlemesi')}</Text>
                  <Text style={styles.sharePreviewBody}>
                    {(sharePost as any).note || (sharePost as any).body || (sharePost as any).title || t('feed.share.previewFallback', 'Paylaşım metni')}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.shareSheetFooter}>
              <Pressable style={({ pressed }) => [styles.modalCloseBtn, pressed && { backgroundColor: '#e0e0e0' }]} onPress={closeShareModal}>
                <Text style={styles.modalCloseText}>{t('common.cancel', 'Vazgeç')}</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.shareConfirmBtn, pressed && styles.shareConfirmBtnPressed, !selectedSharePlatform && { opacity: 0.4 }]}
                onPress={handleConfirmShare}
                disabled={!selectedSharePlatform}
              >
                <Text style={styles.shareConfirmText}>{t('feed.share.simulateButton', 'Paylaş (simülasyon)')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      {/* ✅ Video sheet (ESKİ) — modal istemiyorsun: satır silmeden devre dışı */}
      {false && videoPost && (videoPost as any).videoUri && (
        <Modal
          visible={videoVisible}
          transparent
          animationType="slide"
          onRequestClose={() => {
            setVideoVisible(false);
            setVideoPost(null); // ✅ OOM FIX: tam unmount
          }}
        >
          <TouchableWithoutFeedback
            onPress={() => {
              setVideoVisible(false);
              setVideoPost(null); // ✅ OOM FIX: tam unmount
            }}
          >
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View style={styles.videoSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.videoSheetTitle} numberOfLines={2}>
              {t('feed.video.sheetTitlePrefix', 'Videolu kart:')} {(videoPost as any).title || (videoPost as any).note || t('feed.post.genericTitle', 'Gönderi')}
            </Text>

            <View style={styles.videoPlayerWrapper}>
              <Video source={{ uri: (videoPost as any).videoUri }} style={styles.videoPlayer} controls resizeMode="contain" />
              <View style={styles.videoWatermark}>
                <Image source={VIRAL_LOGO} style={styles.videoWatermarkLogo} />
              </View>
            </View>

            <Pressable
              style={styles.modalCloseBtn}
              onPress={() => {
                setVideoVisible(false);
                setVideoPost(null); // ✅ OOM FIX: tam unmount
              }}
            >
              <Text style={styles.modalCloseText}>{t('common.close', 'Kapat')}</Text>
            </Pressable>
          </View>
        </Modal>
      )}

      {/* 💬 Yorum ekranı */}
      {commentsPost && (
        <Modal visible={commentsVisible} transparent={false} animationType="slide" onRequestClose={closeComments}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.commentScreenRoot} {...commentDragResponder.panHandlers}>
            <View style={styles.commentSheet}>
              <View style={styles.commentDragZone}>
                <View style={styles.modalHandle} />
              </View>

              <View style={styles.commentTitleRow}>
                <Text style={styles.commentTitle} numberOfLines={2}>
                  {t('feed.comments.title', 'Yorumlar')} · {(commentsPost as any).title || (commentsPost as any).note || t('feed.post.genericTitle', 'Gönderi')}
                </Text>

                {isCurrentPostOwner && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.commentsToggleBtn,
                      commentsDisabledForCurrent && styles.commentsToggleBtnActive,
                      pressed && styles.commentsToggleBtnPressed,
                    ]}
                    onPress={() => toggleCommentsDisabledForPost(commentsPost.id)}
                  >
                    <Text style={[styles.commentsToggleText, commentsDisabledForCurrent && styles.commentsToggleTextActive]}>
                      {commentsDisabledForCurrent ? t('feed.comments.toggleOpen', 'Yorumları aç') : t('feed.comments.toggleClose', 'Yorumları kapat')}
                    </Text>
                  </Pressable>
                )}
              </View>

              {replyTo && !commentsDisabledForCurrent && (
                <View style={styles.replyInfoRow}>
                  <Text style={styles.replyInfoText}>
                    {t('feed.comments.replyingTo', 'Şu yoruma yanıt veriyorsun:')} {replyTo.author}
                  </Text>
                  <Pressable onPress={() => setReplyTo(null)}>
                    <Text style={styles.replyCancelText}>{t('common.cancel', 'İptal')}</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.commentListWrapper}>
                {currentComments.length === 0 ? (
                  <Text style={styles.commentEmptyText}>{t('feed.comments.empty', 'Henüz yorum yok. İlk yorumu sen yaz. 🙂')}</Text>
                ) : (
                  <ScrollView contentContainerStyle={styles.commentList} keyboardShouldPersistTaps="handled">
                    {renderCommentsTree()}
                  </ScrollView>
                )}
              </View>

              {!commentsDisabledForCurrent && (
                <View style={styles.emojiRow}>
                  {['❤️', '👏', '🔥', '😂', '😍', '😮', '😢'].map(emoji => (
                    <Pressable key={emoji} style={({ pressed }) => [styles.emojiChip, pressed && styles.emojiChipPressed]} onPress={() => setCommentInput(prev => (prev ? prev + ' ' + emoji : emoji))}>
                      <Text style={styles.emojiText}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {commentsDisabledForCurrent ? (
                <Text style={styles.commentsDisabledInfo}>{t('feed.comments.disabledInfo', 'Bu gönderide yorumlar kapalı. Sadece mevcut yorumları görebilirsin.')}</Text>
              ) : (
                <View style={styles.commentInputRow}>
                  <TextInput
                    style={styles.commentInput}
                    placeholder={
                      replyTo
                        ? t('feed.comments.replyPlaceholder', '{{author}} adlı yoruma yanıt yaz...').replace('{{author}}', replyTo.author)
                        : t('feed.comments.placeholder', 'Yorum yaz...')
                    }
                    value={commentInput}
                    onChangeText={setCommentInput}
                    multiline
                  />
                  <Pressable
                    style={({ pressed }) => [styles.commentSendBtn, pressed && styles.commentSendBtnPressed, !commentInput.trim() && { opacity: 0.4 }]}
                    onPress={handleSendComment}
                    disabled={!commentInput.trim()}
                  >
                    <Text style={styles.commentSendText}>{t('feed.comments.send', 'Gönder')}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* 🔔 Bildirim sheet'i */}
      <Modal visible={notificationsVisible} transparent animationType="slide" onRequestClose={() => setNotificationsVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setNotificationsVisible(false)}>
          <View style={styles.modalBackdrop} />
        </TouchableWithoutFeedback>

        <View style={styles.notificationsSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.notificationsHeaderRow}>
            <Text style={styles.notificationsTitle}>{t('feed.notifications.title', 'Bildirimler')}</Text>
            {notifications.length > 0 && (
              <Pressable style={({ pressed }) => [styles.notificationsMarkAllBtn, pressed && styles.notificationsMarkAllBtnPressed]} onPress={markAllNotificationsRead}>
                <Text style={styles.notificationsMarkAllText}>{t('feed.notifications.markAll', 'Tümünü okundu işaretle')}</Text>
              </Pressable>
            )}
          </View>

          {renderNotifications()}

          <Pressable style={styles.modalCloseBtn} onPress={() => setNotificationsVisible(false)}>
            <Text style={styles.modalCloseText}>{t('feed.notifications.close', 'Kapat')}</Text>
          </Pressable>
        </View>
      </Modal>

      {/* SharePanel */}
      <SharePanel
        visible={sharePanelVisible}
        onClose={() => {
          setSharePanelVisible(false);
          setSharePanelPost(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0C10',
  },

  // HEADER
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    justifyContent: 'space-between',
    backgroundColor: '#0B0C10', // üst şerit de koyu
  },
  headerTextBlock: {
    flex: 1,
    marginRight: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerLogo: {
    width: 34, // logo büyütüldü
    height: 34,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 14,
    color: '#D0D4E4',
  },
  headerTagline: {
    marginTop: 2,
    fontSize: 12,
    color: '#AAB0C5',
  },

  // BİLDİRİM ÇANI
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2B2D42',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#11121A',
  },
  bellBtnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  bellIcon: {
    fontSize: 18,
    color: '#FACC15',
  },
  bellBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    paddingHorizontal: 3,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E50914',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // FOCUS AĞI BUTONU
  focusNetworkBar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#0B0C10',
  },
  focusNetworkButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E50914', // 🔴 Viral kırmızısı
  },
  focusNetworkBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusNetworkText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // ✅ Focus Network istek sayısı badge (pro)
  focusNetworkBadge: {
    marginLeft: 10,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: '#11121A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',

    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  focusNetworkBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFFFFF',
  },

  // ✅ “Yeni istek” noktası
  focusNetworkNewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    marginLeft: 6,
  },

  // FİLTRE CHIPLERİ
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap', // tek satırda kalsın
    paddingHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 8, // daralt
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#111',
    marginRight: 4,
  },
  filterChipActive: {
    borderColor: '#E50914',
    backgroundColor: '#2a2a2a',
  },
  filterChipPressed: {
    opacity: 0.85,
  },
  filterChipText: {
    fontSize: 11,
    color: '#ddd',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // REFRESH BANTI
  refreshBanner: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 8,
    backgroundColor: '#13231A',
    borderWidth: 1,
    borderColor: '#214F31',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  refreshBannerText: {
    fontSize: 12,
    color: '#B9F6CA',
  },

  // LİSTE
  list: {
    paddingHorizontal: 12,
    paddingBottom: 90,
  },
  listEmptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // KARTLAR
  card: {
    backgroundColor: '#151824',
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#22263A',
  },
  cardHighlighted: {
    borderColor: '#E50914',
    shadowColor: '#E50914',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  embeddedCard: {
    marginBottom: 0,
  },

  // SERBEST VİDEO HEADER
  freeVideoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  authorAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    backgroundColor: '#242840',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorAvatarInitial: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  authorName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 160,
  },
  freeVideoTimeText: {
    fontSize: 11,
    color: '#9CA3C7',
  },
  freeVideoMenuBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  freeVideoMenuBtnPressed: {
    opacity: 0.6,
  },
  freeVideoMenuIcon: {
    fontSize: 18,
    color: '#C0C3DB',
  },
  freeVideoCaption: {
    fontSize: 13,
    color: '#E5E7F3',
    marginBottom: 6,
  },
  freeVideoPlayerWrapper: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
    marginBottom: 6,
    height: 210,
  },
  freeVideoPlayer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },

  videoWatermark: {
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    padding: 4,
  },
  videoWatermarkLogo: {
    width: 22,
    height: 22,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  freeVideoShareLeft: {
    flex: 1,
    paddingRight: 4,
  },

  sharedPlatformsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sharedPlatformIcon: {
    width: 20,
    height: 20,
    marginRight: 6,
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  commentsOffPill: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#3C445E',
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  commentsOffText: {
    fontSize: 11,
    color: '#A5ACC8',
  },

  commentBtn: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#343B5A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    backgroundColor: '#171A29',
  },
  commentBtnPressed: {
    opacity: 0.7,
  },
  commentBtnText: {
    fontSize: 12,
    color: '#E5E7F3',
  },

  shareTriggerBtn: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#343B5A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    backgroundColor: '#171A29',
  },
  shareTriggerBtnPressed: {
    opacity: 0.7,
  },
  shareTriggerText: {
    fontSize: 13,
    color: '#E5E7F3',
  },

  repostBtn: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#343B5A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    backgroundColor: '#171A29',
  },
  repostBtnPressed: {
    opacity: 0.7,
  },
  repostBtnText: {
    fontSize: 12,
    color: '#E5E7F3',
  },

  externalLinkBtn: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#343B5A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    backgroundColor: '#171A29',
  },
  externalLinkIcon: {
    fontSize: 13,
  },

  likeBtn: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#E50914',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#1F1012',
  },
  likeBtnPressed: {
    opacity: 0.7,
  },
  likeText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // GÖREV KARTI
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  taskBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  taskBadgeLogo: {
    width: 14,
    height: 14,
    marginRight: 4,
  },
  badge: {
    fontSize: 11,
    color: '#FDE2E4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#2B1013',
  },
  time: {
    fontSize: 11,
    color: '#9CA3C7',
    marginTop: 2,
    marginLeft: 4,
  },

  cardAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  cardAuthorName: {
    fontSize: 13,
    color: '#E5E7F3',
    fontWeight: '500',
  },

  body: {
    fontSize: 13,
    color: '#D7DBF0',
    marginTop: 4,
    marginBottom: 8,
  },

  taskSharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskSharedLabel: {
    fontSize: 11,
    color: '#A5ACC8',
    marginRight: 6,
  },

  videoInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  videoInfo: {
    flex: 1,
    fontSize: 12,
    color: '#D7DBF0',
    marginRight: 6,
  },
  videoPlayBtn: {
    borderRadius: 100,
    backgroundColor: '#E50914',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  videoPlayBtnPressed: {
    opacity: 0.85,
  },
  videoPlayText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#E50914',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  fabIcon: {
    fontSize: 26,
    color: '#FFFFFF',
    marginTop: -1,
  },

  // MODAL GENEL
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    backgroundColor: '#151824',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3C425C',
    marginBottom: 8,
  },

  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  modalBadge: {
    fontSize: 11,
    color: '#FDE2E4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#2B1013',
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  modalTime: {
    fontSize: 11,
    color: '#A5ACC8',
    marginBottom: 6,
  },
  modalBody: {
    fontSize: 13,
    color: '#D7DBF0',
    marginBottom: 6,
  },
  modalNote: {
    fontSize: 13,
    color: '#C2C7E2',
    marginBottom: 4,
  },
  modalShare: {
    fontSize: 12,
    color: '#A5ACC8',
    marginBottom: 6,
  },
  modalVideo: {
    fontSize: 12,
    color: '#D7DBF0',
    marginBottom: 6,
  },
  modalFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  modalAuthor: {
    fontSize: 13,
    color: '#E5E7F3',
  },
  modalCloseBtn: {
    marginTop: 10,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#22263A',
  },
  modalCloseText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
  },

  // SHARE SHEET
  shareSheet: {
    backgroundColor: '#151824',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  shareSheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  sharePlatformRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  sharePlatformChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#343B5A',
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: '#171A29',
  },
  sharePlatformChipSelected: {
    borderColor: '#E50914',
    backgroundColor: '#271016',
  },
  sharePlatformChipPressed: {
    opacity: 0.7,
  },
  sharePlatformChipText: {
    fontSize: 12,
    color: '#D7DBF0',
  },
  sharePlatformChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sharePreviewBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#343B5A',
    padding: 10,
    backgroundColor: '#11121A',
  },
  sharePreviewTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E5E7F3',
    marginBottom: 4,
  },
  sharePreviewBody: {
    fontSize: 12,
    color: '#C2C7E2',
  },
  shareSheetFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  shareConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#E50914',
  },
  shareConfirmBtnPressed: {
    opacity: 0.85,
  },
  shareConfirmText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // VİDEO SHEET
  videoSheet: {
    backgroundColor: '#151824',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  videoSheetTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  videoPlayerWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  videoPlayer: {
    width: '100%',
    height: 260,
    backgroundColor: '#000000',
  },

  // YORUM EKRANI
  commentScreenRoot: {
    flex: 1,
    backgroundColor: '#151824',
  },
  commentSheet: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
  },
  commentDragZone: {
    alignItems: 'center',
    marginBottom: 4,
  },
  commentTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  commentTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginRight: 8,
  },
  commentsToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3C445E',
    backgroundColor: '#171A29',
  },
  commentsToggleBtnActive: {
    borderColor: '#E50914',
    backgroundColor: '#2B1013',
  },
  commentsToggleBtnPressed: {
    opacity: 0.8,
  },
  commentsToggleText: {
    fontSize: 11,
    color: '#C2C7E2',
  },
  commentsToggleTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  replyInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  replyInfoText: {
    fontSize: 11,
    color: '#D7DBF0',
    flex: 1,
    marginRight: 8,
  },
  replyCancelText: {
    fontSize: 12,
    color: '#FFB4B4',
  },

  commentListWrapper: {
    flex: 1,
    marginTop: 4,
    marginBottom: 6,
  },
  commentEmptyText: {
    fontSize: 13,
    color: '#C2C7E2',
    textAlign: 'center',
    marginTop: 16,
  },
  commentList: {
    paddingBottom: 12,
  },

  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  commentRowReply: {
    marginLeft: 40,
  },
  commentRowPressed: {
    opacity: 0.85,
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#242840',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  commentAvatarInitial: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  commentContent: {
    flex: 1,
    backgroundColor: '#181B2A',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  commentReplyContent: {
    backgroundColor: '#17192B',
  },
  commentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  commentAuthor: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
    marginRight: 8,
  },
  commentTime: {
    fontSize: 10,
    color: '#9CA3C7',
  },
  commentText: {
    fontSize: 13,
    color: '#E5E7F3',
    marginBottom: 4,
  },
  commentFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  commentLikeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 6,
  },
  commentLikeBtnPressed: {
    opacity: 0.7,
  },
  commentLikeText: {
    fontSize: 11,
    color: '#FFB4D3',
  },
  commentReplyBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  commentReplyBtnPressed: {
    opacity: 0.7,
  },
  commentReplyText: {
    fontSize: 11,
    color: '#B3C5FF',
  },

  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  emojiChip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 4,
    backgroundColor: '#181B2A',
  },
  emojiChipPressed: {
    opacity: 0.7,
  },
  emojiText: {
    fontSize: 16,
  },

  commentsDisabledInfo: {
    fontSize: 12,
    color: '#C2C7E2',
    textAlign: 'center',
    marginBottom: 4,
  },

  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#343B5A',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#11121A',
  },
  commentInput: {
    flex: 1,
    fontSize: 13,
    color: '#FFFFFF',
    maxHeight: 100,
  },
  commentSendBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#E50914',
  },
  commentSendBtnPressed: {
    opacity: 0.85,
  },
  commentSendText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // BİLDİRİMLER
  notificationsSheet: {
    backgroundColor: '#151824',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  notificationsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  notificationsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  notificationsMarkAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#22263A',
  },
  notificationsMarkAllBtnPressed: {
    opacity: 0.8,
  },
  notificationsMarkAllText: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  notificationsEmptyText: {
    fontSize: 13,
    color: '#C2C7E2',
    marginTop: 12,
    textAlign: 'center',
  },
  notificationsList: {
    paddingVertical: 6,
    paddingBottom: 12,
  },
  notificationItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#262A40',
  },
  notificationItemPressed: {
    opacity: 0.75,
  },
  notificationText: {
    fontSize: 13,
    color: '#E5E7F3',
    marginBottom: 2,
  },
  notificationTextUnread: {
    fontWeight: '600',
  },
  notificationTime: {
    fontSize: 11,
    color: '#9CA3C7',
  },

  // BOŞ LİSTE
  empty: {
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#C2C7E2',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptyCtaBtn: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#E50914',
  },
  emptyCtaBtnPressed: {
    opacity: 0.85,
  },
  emptyCtaText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // ORİJİNAL KART ÖNİZLEME (REPOST)
  originalPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  originalPreviewLabel: {
    fontSize: 20,
    marginRight: 4,
  },
  originalPreviewPressable: {
    flex: 1,
  },
  originalPreviewPressablePressed: {
    opacity: 0.9,
  },
  originalPreviewCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#343B5A',
    padding: 8,
    backgroundColor: '#11121A',
  },
  originalPreviewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  originalPreviewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 6,
  },
  originalPreviewTime: {
    fontSize: 11,
    color: '#9CA3C7',
  },
  originalPreviewBody: {
    fontSize: 12,
    color: '#C2C7E2',
    marginBottom: 2,
  },
  originalPreviewAuthor: {
    fontSize: 11,
    color: '#A5ACC8',
  },

  repostInnerContainer: {
    marginTop: 4,
  },
  repostLabel: {
    fontSize: 18,
    color: '#C2C7E2',
    marginVertical: 2,
  },
});



  