// src/screens/FocusNetworkScreen.tsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  Modal,
  TouchableWithoutFeedback,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage'; // 🔥 kalıcılık için
import { useTranslation } from 'react-i18next';

// ✅ API
import { API_BASE_URL } from '../config/api';
import { useAuth } from '../store/useAuth';
import { useFocusNetwork } from '../store/useFocusNetwork';

type FocusProfile = {
  id: string;
  name: string;
  handle: string;
  summary: string;

  // ✅ avatar (gerçek profil foto)
  avatarUri?: string | null;

  // ✅ discover relationship (friend/incoming/outgoing/none)
  relationship?: 'friend' | 'incoming' | 'outgoing' | 'none' | 'unknown';
};

type Props = {
  onClose?: () => void;
};

const INITIAL_MY_NETWORK: FocusProfile[] = [
  { id: 'friend_focus_buddy', name: 'Odak Arkadaşın', handle: '@odak_arkadas', summary: 'Bugün 3 görev tamamladı.' },
  { id: 'friend_morning_routine', name: 'Sabah Rutini', handle: '@sabah_rutini', summary: 'Son 7 günde 5 gün aktif.' },
  { id: 'friend_gandalf', name: 'Gandalf', handle: '@gandalf', summary: 'Uzun vadeli görevleri sakin sakin planlar.' },
  { id: 'friend_aragorn', name: 'Aragorn', handle: '@aragorn', summary: 'Zor görevlerde bile liderliği bırakmaz.' },
  { id: 'friend_theoden', name: 'Kral Théoden', handle: '@kral_theoden', summary: 'Uyuyan görevleri yeniden canlandırmayı sever.' },
  { id: 'friend_sauron', name: 'Sauron', handle: '@sauron', summary: 'Tek hedefe odaklanıp asla vazgeçmez.' },
  { id: 'friend_gimli', name: 'Gimli', handle: '@gimli', summary: 'Kısa ama yoğun görevleri tercih eder.' },
  { id: 'friend_gollum', name: 'Gollum', handle: '@gollum', summary: '“Kıymetli” hedeflerine takılı kalır.' },
];

const INITIAL_SUGGESTIONS: FocusProfile[] = [
  { id: 'suggest_daily_planner', name: 'Günlük Planlayıcı', handle: '@gunluk_plan', summary: 'Her gün 1 görev paylaşır.' },
  { id: 'suggest_pomodoro_master', name: 'Pomodoro Ustası', handle: '@pomodoro', summary: 'Kısa odak blokları ile çalışır.' },
  { id: 'suggest_habit_builder', name: 'Alışkanlık İnşaatçısı', handle: '@habit_builder', summary: 'Mini görev zincirleriyle ilerler.' },
];

// 🔒 AsyncStorage key’i (UI state: son sekme vs.)
const FOCUS_NETWORK_STORAGE_KEY = '@focus_network_state_v2';

// 🔔 “İstek geldi” in-app bildirim için seen-state
const FOCUS_NETWORK_SEEN_REQUESTS_KEY = '@focus_network_seen_requests_v1';

type TabKey = 'network' | 'discover' | 'requests';

// ✅ useAuth içinden userId’yi sağlam çöz (string/number, farklı alan isimleri)
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

// ✅ küçük bir fetch helper (store çalışmazsa bile ekranda gerçek kullanıcıları göstermek için)
async function fetchJson<T>(url: string, opts?: RequestInit, timeoutMs = 12000): Promise<T> {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(opts || {}), signal: ctl.signal });
    const text = await res.text().catch(() => '');
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(
        typeof data === 'object' && data
          ? `HTTP ${res.status}: ${JSON.stringify(data)}`
          : `HTTP ${res.status}: ${String(data)}`,
      );
    }
    return data as T;
  } finally {
    clearTimeout(id);
  }
}

// ✅ olası avatar alanlarını tek noktadan çöz
function resolveAvatarUri(u: any): string | null {
  const cand =
    u?.avatarUri ??
    u?.avatarURL ??
    u?.avatarUrl ??
    u?.photoUrl ??
    u?.photoURL ??
    u?.photoUri ??
    u?.profilePhoto ??
    u?.profilePhotoUrl ??
    u?.profilePhotoUri ??
    u?.imageUrl ??
    u?.imageURL ??
    null;

  if (!cand) return null;
  const s = String(cand).trim();
  if (!s) return null;
  return s;
}

const FocusNetworkScreen: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  // ✅ Auth: userId header için
  const auth = useAuth() as any;
  const userId: number | null = useMemo(() => resolveUserId(auth), [auth]);

  // ✅ Store: API tabanlı
  const {
    friends,
    discover,
    incomingRequests,
    hydrated,
    hydrateError,
    hydrateAll,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
  } = useFocusNetwork();

  const [selectedProfile, setSelectedProfile] = useState<FocusProfile | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>('network');

  const viralRed = '#E50914';
  const normalizedQuery = search.trim().toLowerCase();

  // 🔄 Scroll & “Kişi ekle” için ref / offset
  const scrollRef = useRef<ScrollView | null>(null);
  const [suggestionsOffset, setSuggestionsOffset] = useState(0);

  // 🔔 Seen request ids + new badge count
  const [seenRequestIds, setSeenRequestIds] = useState<Set<string>>(new Set());
  const [newIncomingCount, setNewIncomingCount] = useState(0);

  // ✅ Store bozulursa bile gerçek kullanıcıları göstermek için “manual online” override state
  const [manualFriends, setManualFriends] = useState<any[] | null>(null);
  const [manualDiscover, setManualDiscover] = useState<any[] | null>(null);
  const [manualIncoming, setManualIncoming] = useState<any[] | null>(null);
  const [netHint, setNetHint] = useState<string>('');

  const seenKey = useMemo(() => {
    if (!userId) return `${FOCUS_NETWORK_SEEN_REQUESTS_KEY}:guest`;
    return `${FOCUS_NETWORK_SEEN_REQUESTS_KEY}:u${userId}`;
  }, [userId]);

  // 🔄 UI state restore (tab)
  useEffect(() => {
    const loadUi = async () => {
      try {
        const raw = await AsyncStorage.getItem(FOCUS_NETWORK_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { tab?: TabKey };
        if (parsed?.tab) setActiveTab(parsed.tab);
      } catch {}
    };
    loadUi();
  }, []);

  // 🔐 UI state save
  useEffect(() => {
    const saveUi = async () => {
      try {
        await AsyncStorage.setItem(FOCUS_NETWORK_STORAGE_KEY, JSON.stringify({ tab: activeTab }));
      } catch {}
    };
    saveUi();
  }, [activeTab]);

  // 🔔 seen state yükle
  useEffect(() => {
    const loadSeen = async () => {
      try {
        const raw = await AsyncStorage.getItem(seenKey);
        if (!raw) {
          setSeenRequestIds(new Set());
          return;
        }
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const s = new Set(arr.map((x: any) => String(x)));
          setSeenRequestIds(s);
        } else {
          setSeenRequestIds(new Set());
        }
      } catch {
        setSeenRequestIds(new Set());
      }
    };
    loadSeen();
  }, [seenKey]);

  // ✅ Açılışta backend’den hydrate (store)
  useEffect(() => {
    hydrateAll({ userId: userId ?? undefined });
  }, [userId, hydrateAll]);

  // ✅ Store hydrate başarısızsa / sessizce çalışmıyorsa: burada doğrudan API'ye vur
  useEffect(() => {
    const run = async () => {
      try {
        const base = String(API_BASE_URL || '').replace(/\/+$/, '');

        if (!base || !/^https?:\/\//i.test(base)) {
          setNetHint(t('focusNetwork.net.invalidBaseUrl', 'API_BASE_URL geçersiz görünüyor.'));
          return;
        }

        setNetHint(`API: ${base}`);

        const uid = userId ?? undefined;

        const discoverUrl =
          uid != null
            ? `${base}/users/search?limit=30&userId=${encodeURIComponent(String(uid))}`
            : `${base}/users/search?limit=30`;

        const friendsUrl = uid != null ? `${base}/friends/list?userId=${encodeURIComponent(String(uid))}` : null;

        const requestsUrl = uid != null ? `${base}/friends/requests?userId=${encodeURIComponent(String(uid))}` : null;

        const d = await fetchJson<any>(discoverUrl);
        const dItems = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : [];
        setManualDiscover(dItems);

        if (friendsUrl) {
          const f = await fetchJson<any>(friendsUrl);
          const fItems = Array.isArray(f?.items) ? f.items : Array.isArray(f) ? f : [];
          setManualFriends(fItems);
        }

        if (requestsUrl) {
          const r = await fetchJson<any>(requestsUrl);
          const rItems = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
          setManualIncoming(rItems);
        }
      } catch (e: any) {
        setNetHint(
          `${t('focusNetwork.net.onlineFetchError', 'Focus Ağı online fetch hata')}: ${e?.message || String(e)}`,
        );
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // 🔄 Basit “yakın gerçek zamanlı” istek bildirimi için polling (in-app)
  useEffect(() => {
    if (!userId) return;
    const id = setInterval(() => {
      hydrateAll({ userId: userId ?? undefined });
    }, 15000);
    return () => clearInterval(id);
  }, [userId, hydrateAll]);

  // ✅ Search: Discover tab’ında arama yazınca backend’de ara
  useEffect(() => {
    if (activeTab !== 'discover') return;

    const q = search.trim();
    const tmr = setTimeout(() => {
      searchUsers({ userId: userId ?? undefined, q });
    }, 250);

    return () => clearTimeout(tmr);
  }, [search, activeTab, userId, searchUsers]);

  // 🔔 yeni istek sayısını hesapla (seenRequestIds ile kıyas)
  useEffect(() => {
    try {
      if (!incomingRequests || !Array.isArray(incomingRequests)) {
        setNewIncomingCount(0);
        return;
      }

      const ids = incomingRequests.map((r: any) => String(r?.id ?? ''));
      const unseen = ids.filter(id => id && !seenRequestIds.has(id));
      setNewIncomingCount(unseen.length);
    } catch {
      setNewIncomingCount(0);
    }
  }, [incomingRequests, seenRequestIds]);

  // 🔔 Requests sekmesine girince “seen” yap (badge kapansın)
  useEffect(() => {
    const markSeenIfRequests = async () => {
      if (activeTab !== 'requests') return;
      try {
        const ids = (incomingRequests || []).map((r: any) => String(r?.id ?? '')).filter(Boolean);

        const next = new Set(seenRequestIds);
        for (const id of ids) next.add(id);

        setSeenRequestIds(next);
        setNewIncomingCount(0);

        await AsyncStorage.setItem(seenKey, JSON.stringify(Array.from(next)));
      } catch {}
    };

    markSeenIfRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, incomingRequests]);

  const markAllIncomingSeen = async () => {
    try {
      const ids = (incomingRequests || []).map((r: any) => String(r?.id ?? '')).filter(Boolean);

      const next = new Set(seenRequestIds);
      for (const id of ids) next.add(id);

      setSeenRequestIds(next);
      setNewIncomingCount(0);

      await AsyncStorage.setItem(seenKey, JSON.stringify(Array.from(next)));
    } catch {}
  };

  // ✅ UI listelerine FocusProfile mapping
  const myNetworkProfiles: FocusProfile[] = useMemo(() => {
    const sourceFriends =
      hydrated && !hydrateError && Array.isArray(friends)
        ? friends
        : Array.isArray(manualFriends)
        ? manualFriends
        : null;

    if (!sourceFriends) return INITIAL_MY_NETWORK;

    return sourceFriends.map((u: any) => {
      const handle = u?.handle ? `@${String(u.handle).replace(/^@+/, '')}` : '@viral_user';
      const name = u?.fullName || u?.displayName || 'Viral user';
      const avatarUri = resolveAvatarUri(u);
      return {
        id: String(u.id),
        name,
        handle,
        summary: u?.bio ? String(u.bio) : t('focusNetwork.summary.inNetwork', 'Focus ağında.'),
        avatarUri,
      };
    });
  }, [friends, hydrated, hydrateError, manualFriends, t]);

  const discoverProfiles: FocusProfile[] = useMemo(() => {
    const sourceDiscover =
      hydrated && !hydrateError && Array.isArray(discover)
        ? discover
        : Array.isArray(manualDiscover)
        ? manualDiscover
        : null;

    if (!sourceDiscover) return INITIAL_SUGGESTIONS;

    return sourceDiscover.map((u: any) => {
      const handle = u?.handle ? `@${String(u.handle).replace(/^@+/, '')}` : '@viral_user';
      const name = u?.fullName || u?.displayName || 'Viral user';

      const rel = String((u as any)?.relationship ?? 'none') as any;
      const avatarUri = resolveAvatarUri(u);

      const summary =
        rel === 'friend'
          ? t('focusNetwork.summary.alreadyInNetwork', 'Zaten ağında.')
          : rel === 'incoming'
          ? t('focusNetwork.summary.incomingRequest', 'Sana istek göndermiş.')
          : rel === 'outgoing'
          ? t('focusNetwork.summary.outgoingPending', 'İstek gönderildi (beklemede).')
          : u?.bio
          ? String(u.bio)
          : t('focusNetwork.summary.discoverFallback', 'Keşfet listesinden ekle.');

      return {
        id: String(u.id),
        name,
        handle,
        summary,
        relationship: rel,
        avatarUri,
      };
    });
  }, [discover, hydrated, hydrateError, manualDiscover, t]);

  const incomingProfiles: FocusProfile[] = useMemo(() => {
    const srcIncoming =
      hydrated && !hydrateError && Array.isArray(incomingRequests)
        ? incomingRequests
        : Array.isArray(manualIncoming)
        ? manualIncoming
        : null;

    if (!srcIncoming) return [];

    return srcIncoming
      .filter((r: any) => r?.fromUser || r?.from)
      .map((r: any) => {
        const u = r.fromUser || r.from;
        const handle = u?.handle ? `@${String(u.handle).replace(/^@+/, '')}` : '@viral_user';
        const name = u?.fullName || u?.displayName || 'Viral user';
        const avatarUri = resolveAvatarUri(u);
        return {
          id: String(r.id),
          name,
          handle,
          summary: t('focusNetwork.summary.requestPending', 'Arkadaşlık isteği bekliyor.'),
          avatarUri,
        };
      });
  }, [incomingRequests, hydrated, hydrateError, manualIncoming, t]);

  const filteredMyNetwork = useMemo(() => {
    if (!normalizedQuery) return myNetworkProfiles;
    return myNetworkProfiles.filter(p => (p.name + ' ' + p.handle).toLowerCase().includes(normalizedQuery));
  }, [myNetworkProfiles, normalizedQuery]);

  const filteredDiscover = useMemo(() => {
    if (!normalizedQuery) return discoverProfiles;
    return discoverProfiles.filter(p => (p.name + ' ' + p.handle).toLowerCase().includes(normalizedQuery));
  }, [discoverProfiles, normalizedQuery]);

  const filteredIncoming = useMemo(() => {
    if (!normalizedQuery) return incomingProfiles;
    return incomingProfiles.filter(p => (p.name + ' ' + p.handle).toLowerCase().includes(normalizedQuery));
  }, [incomingProfiles, normalizedQuery]);

  const handleBack = () => {
    if (onClose) onClose();
  };

  const openDetail = (profile: FocusProfile) => {
    setSelectedProfile(profile);
    setDetailVisible(true);
  };

  const closeDetail = () => {
    setDetailVisible(false);
    setSelectedProfile(null);
  };

  const detailContext = useMemo(() => {
    if (!selectedProfile) return { mode: 'none' as const };
    if (activeTab === 'network') return { mode: 'network' as const };
    if (activeTab === 'requests') return { mode: 'requests' as const };
    return { mode: 'discover' as const };
  }, [selectedProfile, activeTab]);

  const handlePrimaryActionInDetail = async () => {
    if (!selectedProfile) return;

    if (!userId) {
      Alert.alert(
        t('focusNetwork.alerts.loginRequiredTitle', 'Giriş gerekli'),
        t('focusNetwork.alerts.loginRequiredBody', 'Bu işlem için kullanıcı oturumu gerekli.'),
      );
      return;
    }

    try {
      if (detailContext.mode === 'network') {
        const otherUserId = Number(selectedProfile.id);
        if (!Number.isFinite(otherUserId)) return;

        await removeFriend({ userId, otherUserId });
        closeDetail();
        return;
      }

      if (detailContext.mode === 'requests') {
        const requestId = Number(selectedProfile.id);
        if (!Number.isFinite(requestId)) return;

        await acceptFriendRequest({ userId, requestId });
        closeDetail();
        await markAllIncomingSeen();
        return;
      }

      if (detailContext.mode === 'discover') {
        const rel = selectedProfile.relationship ?? 'none';

        if (rel === 'friend') {
          Alert.alert(
            t('focusNetwork.alerts.alreadyInNetworkTitle', 'Zaten ağında'),
            t('focusNetwork.alerts.alreadyInNetworkBody', 'Bu kişi zaten Focus ağında.'),
          );
          closeDetail();
          return;
        }
        if (rel === 'outgoing') {
          Alert.alert(
            t('focusNetwork.alerts.pendingTitle', 'Beklemede'),
            t(
              'focusNetwork.alerts.pendingBody',
              'Bu kişiye zaten istek gönderdin. Kabul etmesini bekle.',
            ),
          );
          closeDetail();
          return;
        }
        if (rel === 'incoming') {
          Alert.alert(
            t('focusNetwork.alerts.requestExistsTitle', 'İstek var'),
            t(
              'focusNetwork.alerts.requestExistsBody',
              'Bu kişi sana istek göndermiş. “İstekler” sekmesinden kabul edebilirsin.',
            ),
          );
          setActiveTab('requests');
          closeDetail();
          return;
        }

        const toUserId = Number(selectedProfile.id);
        if (!Number.isFinite(toUserId)) return;

        const result = await sendFriendRequest({ userId, toUserId });

        if (result?.status === 'incoming-exists') {
          Alert.alert(
            t('focusNetwork.alerts.requestExistsTitle', 'İstek var'),
            t(
              'focusNetwork.alerts.requestExistsBody',
              'Bu kişi sana zaten istek göndermiş. “İstekler” sekmesinden kabul edebilirsin.',
            ),
          );
          setActiveTab('requests');
        }
        closeDetail();
        return;
      }
    } catch (e: any) {
      console.warn('[FocusNetwork] primary action failed:', e);
      Alert.alert(
        t('common.error', 'Hata'),
        t('focusNetwork.alerts.actionFailedWithConnection', 'İşlem başarısız oldu. (Bağlantı?)'),
      );
    }
  };

  const handleSecondaryActionInDetail = async () => {
    if (!selectedProfile) return;

    if (!userId) {
      closeDetail();
      return;
    }

    if (detailContext.mode === 'requests') {
      try {
        const requestId = Number(selectedProfile.id);
        if (!Number.isFinite(requestId)) return;

        await declineFriendRequest({ userId, requestId });
        closeDetail();
        await markAllIncomingSeen();
      } catch (e) {
        console.warn('[FocusNetwork] decline failed:', e);
        Alert.alert(
          t('common.error', 'Hata'),
          t('focusNetwork.alerts.declineFailed', 'Reddetme işlemi başarısız oldu.'),
        );
      }
    } else {
      closeDetail();
    }
  };

  // ✅ KAYMA FIX: Image'ı container içine “sıkıştırma” yok.
  // Image doğrudan width/height + borderRadius ile çizilir (feed gibi).
  const renderAvatar = (profile: FocusProfile, size: 'small' | 'large') => {
    const initial = (profile.name?.trim?.()[0] || profile.handle?.trim?.()[1] || 'F').toUpperCase();
    const hasImage = !!(profile.avatarUri && String(profile.avatarUri).trim());

    if (size === 'large') {
      if (hasImage) {
        return <Image source={{ uri: String(profile.avatarUri) }} style={styles.avatarImgLarge} />;
      }
      return (
        <View style={[styles.avatarCircleLarge, { backgroundColor: viralRed }]}>
          <Text style={styles.avatarTextLarge}>{initial}</Text>
        </View>
      );
    }

    if (hasImage) {
      return <Image source={{ uri: String(profile.avatarUri) }} style={styles.avatarImg} />;
    }
    return (
      <View style={[styles.avatarCircle, { backgroundColor: viralRed }]}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
    );
  };

  const renderProfileRow = (
    profile: FocusProfile,
    options?: {
      inNetwork?: boolean;
      showQuickAdd?: boolean;
      showQuickAccept?: boolean;
      showQuickDecline?: boolean;
      requestId?: string;
    },
  ) => {
    const inNetwork = options?.inNetwork ?? false;

    const rel = profile.relationship ?? 'none';
    const quickAddDisabled = inNetwork || rel === 'friend' || rel === 'outgoing' || rel === 'incoming';

    const quickAddText =
      inNetwork || rel === 'friend'
        ? t('focusNetwork.actions.inMyNetwork', 'Ağımda')
        : rel === 'outgoing'
        ? t('focusNetwork.actions.pending', 'Beklemede')
        : rel === 'incoming'
        ? t('focusNetwork.actions.requestExists', 'İstek var')
        : t('focusNetwork.actions.sendRequest', 'İstek gönder');

    return (
      <View key={profile.id} style={styles.profileRow}>
        <View style={styles.profileLeft}>
          {renderAvatar(profile, 'small')}

          <View style={styles.profileTextBlock}>
            <Text style={styles.profileName} numberOfLines={1}>
              {profile.name}
            </Text>
            <Text style={styles.profileHandle} numberOfLines={1}>
              {profile.handle}
            </Text>
            <Text style={styles.profileSummary} numberOfLines={1}>
              {profile.summary}
            </Text>
          </View>
        </View>

        <View style={styles.profileRight}>
          <Pressable style={({ pressed }) => [styles.detailBtn, pressed && styles.detailBtnPressed]} onPress={() => openDetail(profile)}>
            <Text style={styles.detailBtnText}>{t('focusNetwork.actions.detail', 'Detay')}</Text>
          </Pressable>

          {options?.showQuickAdd && (
            <Pressable
              disabled={quickAddDisabled}
              style={({ pressed }) => [
                styles.addBtn,
                quickAddDisabled && { opacity: 0.6 },
                pressed && !quickAddDisabled && styles.addBtnPressed,
              ]}
              onPress={async () => {
                if (!userId) {
                  Alert.alert(
                    t('focusNetwork.alerts.loginRequiredTitle', 'Giriş gerekli'),
                    t('focusNetwork.alerts.loginRequiredBody', 'Bu işlem için kullanıcı oturumu gerekli.'),
                  );
                  return;
                }

                if (rel === 'friend') return;

                if (rel === 'outgoing') {
                  Alert.alert(
                    t('focusNetwork.alerts.pendingTitle', 'Beklemede'),
                    t(
                      'focusNetwork.alerts.pendingBody',
                      'Bu kişiye zaten istek gönderdin. Kabul etmesini bekle.',
                    ),
                  );
                  return;
                }

                if (rel === 'incoming') {
                  Alert.alert(
                    t('focusNetwork.alerts.requestExistsTitle', 'İstek var'),
                    t(
                      'focusNetwork.alerts.requestExistsBody',
                      'Bu kişi sana istek göndermiş. “İstekler” sekmesinden kabul edebilirsin.',
                    ),
                  );
                  setActiveTab('requests');
                  return;
                }

                const toUserId = Number(profile.id);
                if (!Number.isFinite(toUserId)) return;

                try {
                  const result = await sendFriendRequest({ userId, toUserId });
                  if (result?.status === 'incoming-exists') {
                    Alert.alert(
                      t('focusNetwork.alerts.requestExistsTitle', 'İstek var'),
                      t(
                        'focusNetwork.alerts.requestExistsBody',
                        'Bu kişi sana zaten istek göndermiş. “İstekler” sekmesinden kabul edebilirsin.',
                      ),
                    );
                    setActiveTab('requests');
                  }
                } catch (e) {
                  console.warn('[FocusNetwork] quick add failed:', e);
                  Alert.alert(
                    t('common.error', 'Hata'),
                    t('focusNetwork.alerts.requestSendFailed', 'İstek gönderilemedi. (Bağlantı?)'),
                  );
                }
              }}
            >
              <Text style={styles.addBtnText}>{quickAddText}</Text>
            </Pressable>
          )}

          {options?.showQuickAccept && (
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
              onPress={async () => {
                if (!userId) return;
                const requestId = Number(profile.id);
                if (!Number.isFinite(requestId)) return;

                try {
                  await acceptFriendRequest({ userId, requestId });
                  await markAllIncomingSeen();
                } catch (e) {
                  console.warn('[FocusNetwork] quick accept failed:', e);
                  Alert.alert(
                    t('common.error', 'Hata'),
                    t('focusNetwork.alerts.acceptFailed', 'Kabul edilemedi. (Bağlantı?)'),
                  );
                }
              }}
            >
              <Text style={styles.addBtnText}>{t('focusNetwork.actions.accept', 'Kabul et')}</Text>
            </Pressable>
          )}

          {options?.showQuickDecline && (
            <Pressable
              style={({ pressed }) => [styles.declineBtn, pressed && styles.declineBtnPressed]}
              onPress={async () => {
                if (!userId) return;
                const requestId = Number(profile.id);
                if (!Number.isFinite(requestId)) return;

                try {
                  await declineFriendRequest({ userId, requestId });
                  await markAllIncomingSeen();
                } catch (e) {
                  console.warn('[FocusNetwork] quick decline failed:', e);
                  Alert.alert(
                    t('common.error', 'Hata'),
                    t('focusNetwork.alerts.declineFailed', 'Reddetme işlemi başarısız oldu.'),
                  );
                }
              }}
            >
              <Text style={styles.declineBtnText}>{t('focusNetwork.actions.decline', 'Reddet')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.headerRow}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]} onPress={handleBack}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>

        <View style={styles.headerTextBlock}>
          <Text style={styles.headerTitle}>{t('focusNetwork.title', 'Focus Ağı')}</Text>
          <Text style={styles.headerSubtitle}>
            {t(
              'focusNetwork.subtitle',
              'Burada sadece seçtiğin kişilerin gönderilerini görürsün.',
            )}
          </Text>
        </View>
      </View>

      {!!netHint && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
          <Text style={{ fontSize: 10, color: '#999' }}>{netHint}</Text>
        </View>
      )}

      <View style={styles.tabsRow}>
        <Pressable
          style={({ pressed }) => [styles.tabPill, activeTab === 'network' && styles.tabPillActive, pressed && styles.tabPillPressed]}
          onPress={() => setActiveTab('network')}
        >
          <Text style={[styles.tabText, activeTab === 'network' && styles.tabTextActive]}>
            {t('focusNetwork.tabs.network', 'Ağım')}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.tabPill, activeTab === 'discover' && styles.tabPillActive, pressed && styles.tabPillPressed]}
          onPress={() => setActiveTab('discover')}
        >
          <Text style={[styles.tabText, activeTab === 'discover' && styles.tabTextActive]}>
            {t('focusNetwork.tabs.discover', 'Keşfet')}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.tabPill, activeTab === 'requests' && styles.tabPillActive, pressed && styles.tabPillPressed]}
          onPress={() => setActiveTab('requests')}
        >
          <Text style={[styles.tabText, activeTab === 'requests' && styles.tabTextActive]}>
            {t('focusNetwork.tabs.requests', 'İstekler')} {incomingProfiles.length > 0 ? `(${incomingProfiles.length})` : ''}
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={
            activeTab === 'network'
              ? t('focusNetwork.search.networkPlaceholder', 'Ağında ara (@kullanıcı, ad)...')
              : activeTab === 'discover'
              ? t('focusNetwork.search.discoverPlaceholder', 'Keşfet: @handle / ad / email / telefon...')
              : t('focusNetwork.search.requestsPlaceholder', 'İsteklerde ara...')
          }
          placeholderTextColor="#999"
          style={styles.searchInput}
        />
        <Pressable
          style={({ pressed }) => [styles.addPersonBtn, pressed && styles.addPersonBtnPressed]}
          onPress={() => {
            if (activeTab !== 'discover') {
              setActiveTab('discover');
              return;
            }
            if (scrollRef.current) {
              scrollRef.current.scrollTo({ y: suggestionsOffset, animated: true });
            }
          }}
        >
          <Text style={styles.addPersonBtnText}>
            {activeTab === 'discover'
              ? t('focusNetwork.actions.addPerson', 'Kişi ekle')
              : t('focusNetwork.tabs.discover', 'Keşfet')}
          </Text>
        </Pressable>
      </View>

      {newIncomingCount > 0 && activeTab !== 'requests' && (
        <Pressable style={({ pressed }) => [styles.incomingBanner, pressed && styles.incomingBannerPressed]} onPress={() => setActiveTab('requests')}>
          <View style={{ flex: 1 }}>
            <Text style={styles.incomingBannerTitle}>
              {t('focusNetwork.banner.newRequestTitle', 'Yeni bağlantı isteği')}
            </Text>
            <Text style={styles.incomingBannerSub}>
              {t('focusNetwork.banner.newRequestBody', '{{count}} yeni istek var. Görmek için dokun.', {
                count: newIncomingCount,
                defaultValue: '{{count}} yeni istek var. Görmek için dokun.',
              })}
            </Text>
          </View>

          <View style={styles.incomingBannerPill}>
            <Text style={styles.incomingBannerPillText}>
              {t('focusNetwork.tabs.requests', 'İstekler')}
            </Text>
          </View>
        </Pressable>
      )}

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {activeTab === 'network' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('focusNetwork.sections.network', 'Ağım')}</Text>
              <Text style={styles.sectionCount}>
                {t('focusNetwork.count.people', '{{count}} kişi', {
                  count: myNetworkProfiles.length,
                  defaultValue: '{{count}} kişi',
                })}
              </Text>
            </View>

            {filteredMyNetwork.length === 0 ? (
              <Text style={styles.emptyText}>
                {t('focusNetwork.empty.noSearchMatch', 'Aramana uygun kişi bulunamadı.')}
              </Text>
            ) : (
              filteredMyNetwork.map(profile => renderProfileRow(profile, { inNetwork: true, showQuickAdd: false }))
            )}
          </View>
        )}

        {activeTab === 'discover' && (
          <View style={styles.section} onLayout={e => setSuggestionsOffset(e.nativeEvent.layout.y)}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('focusNetwork.sections.discover', 'Keşfet')}</Text>
              <Text style={styles.sectionCount}>
                {t('focusNetwork.count.people', '{{count}} kişi', {
                  count: discoverProfiles.length,
                  defaultValue: '{{count}} kişi',
                })}
              </Text>
            </View>

            {filteredDiscover.length === 0 ? (
              <Text style={styles.emptyText}>
                {t('focusNetwork.empty.noResults', 'Şu anda sonuç yok.')}
              </Text>
            ) : (
              filteredDiscover.map(profile => renderProfileRow(profile, { inNetwork: false, showQuickAdd: true }))
            )}

            <View style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 11, color: '#999' }}>
                {t(
                  'focusNetwork.note.backendDiscover',
                  'Not: Keşfet listesi backend’den gelir. Bağlantı yoksa sonuçlar güncellenmeyebilir.',
                )}
              </Text>
            </View>
          </View>
        )}

        {activeTab === 'requests' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                {t('focusNetwork.sections.incomingRequests', 'Gelen istekler')}
              </Text>
              <Text style={styles.sectionCount}>
                {t('focusNetwork.count.requests', '{{count}} istek', {
                  count: incomingProfiles.length,
                  defaultValue: '{{count}} istek',
                })}
              </Text>
            </View>

            {filteredIncoming.length === 0 ? (
              <Text style={styles.emptyText}>
                {t('focusNetwork.empty.noPendingRequests', 'Bekleyen istek yok.')}
              </Text>
            ) : (
              filteredIncoming.map(profile => renderProfileRow(profile, { showQuickAccept: true, showQuickDecline: true }))
            )}
          </View>
        )}
      </ScrollView>

      {selectedProfile && (
        <Modal visible={detailVisible} transparent animationType="slide" onRequestClose={closeDetail}>
          <TouchableWithoutFeedback onPress={closeDetail}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View style={styles.detailSheet}>
            <View style={styles.modalHandle} />

            <View style={styles.detailHeaderRow}>
              {renderAvatar(selectedProfile, 'large')}
              <View style={styles.detailHeaderTextBlock}>
                <Text style={styles.detailName}>{selectedProfile.name}</Text>
                <Text style={styles.detailHandle}>{selectedProfile.handle}</Text>
              </View>
            </View>

            <Text style={styles.detailSummary}>{selectedProfile.summary}</Text>

            <View style={styles.detailInfoBox}>
              <Text style={styles.detailInfoText}>
                {t(
                  'focusNetwork.detail.rule1',
                  '• Arkadaşlık sistemi: istek gönder → karşı taraf kabul eder.',
                )}
              </Text>
              <Text style={styles.detailInfoText}>
                {t('focusNetwork.detail.rule2', '• Zorla bağlama yok. Her şey onaylı ilerler.')}
              </Text>
              <Text style={styles.detailInfoText}>
                {t(
                  'focusNetwork.detail.rule3',
                  '• Bağlantı yoksa işlemler başarısız olabilir.',
                )}
              </Text>
              <Text style={styles.detailInfoText}>• API: {API_BASE_URL}</Text>
            </View>

            <View style={styles.detailActionsRow}>
              <Pressable style={({ pressed }) => [styles.detailSecondaryBtn, pressed && styles.detailSecondaryBtnPressed]} onPress={handleSecondaryActionInDetail}>
                <Text style={styles.detailSecondaryText}>
                  {detailContext.mode === 'requests'
                    ? t('focusNetwork.actions.decline', 'Reddet')
                    : t('common.close', 'Kapat')}
                </Text>
              </Pressable>

              <Pressable style={({ pressed }) => [styles.detailPrimaryBtn, pressed && styles.detailPrimaryBtnPressed]} onPress={handlePrimaryActionInDetail}>
                <Text style={styles.detailPrimaryText}>
                  {detailContext.mode === 'network'
                    ? t('focusNetwork.actions.removeFromNetwork', 'Ağımdan çıkar')
                    : detailContext.mode === 'requests'
                    ? t('focusNetwork.actions.accept', 'Kabul et')
                    : (() => {
                        const rel = selectedProfile.relationship ?? 'none';
                        if (rel === 'friend') return t('focusNetwork.actions.inMyNetwork', 'Ağımda');
                        if (rel === 'outgoing') return t('focusNetwork.actions.pending', 'Beklemede');
                        if (rel === 'incoming') return t('focusNetwork.actions.requestExists', 'İstek var');
                        return t('focusNetwork.actions.sendRequest', 'İstek gönder');
                      })()}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
};

export default FocusNetworkScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f7f7' },

  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  backBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999, marginRight: 8 },
  backBtnPressed: { backgroundColor: '#eeeeee' },
  backIcon: { fontSize: 18, fontWeight: '600', color: '#222' },
  headerTextBlock: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#111' },
  headerSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },

  tabsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingBottom: 6 },
  tabPill: { flex: 1, borderRadius: 999, paddingVertical: 8, backgroundColor: '#eeeeee', alignItems: 'center', justifyContent: 'center' },
  tabPillActive: { backgroundColor: '#E50914' },
  tabPillPressed: { opacity: 0.9 },
  tabText: { fontSize: 12, fontWeight: '800', color: '#333' },
  tabTextActive: { color: '#fff' },

  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6, gap: 8 },
  searchInput: { flex: 1, borderRadius: 999, borderWidth: 1, borderColor: '#ddd', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff', fontSize: 13 },
  addPersonBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#E50914' },
  addPersonBtnPressed: { backgroundColor: '#c10710' },
  addPersonBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  incomingBanner: {
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ffd1d6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  incomingBannerPressed: { opacity: 0.92 },
  incomingBannerTitle: { fontSize: 13, fontWeight: '800', color: '#111' },
  incomingBannerSub: { marginTop: 2, fontSize: 11, color: '#666' },
  incomingBannerPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#E50914' },
  incomingBannerPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24 },

  section: { marginTop: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  sectionCount: { fontSize: 12, color: '#777' },
  emptyText: { fontSize: 13, color: '#777', marginTop: 4 },

  profileRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  profileLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8, minHeight: 36 },

  // Harfli avatar (View)
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // ✅ Resimli avatar (Image) -> kaymayı bitirir
  avatarImg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
    resizeMode: 'cover',
  },

  profileTextBlock: { flex: 1 },
  profileName: { fontSize: 14, fontWeight: '700', color: '#111' },
  profileHandle: { fontSize: 12, color: '#777', marginTop: 1 },
  profileSummary: { fontSize: 11, color: '#999', marginTop: 1 },

  profileRight: { alignItems: 'flex-end', gap: 4 },
  detailBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#eeeeee' },
  detailBtnPressed: { backgroundColor: '#e0e0e0' },
  detailBtnText: { fontSize: 11, fontWeight: '600', color: '#444' },

  addBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#E50914', backgroundColor: '#fff' },
  addBtnPressed: { backgroundColor: '#ffe5e8' },
  addBtnText: { fontSize: 11, fontWeight: '700', color: '#E50914' },

  declineBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  declineBtnPressed: { backgroundColor: '#f2f2f2' },
  declineBtnText: { fontSize: 11, fontWeight: '800', color: '#666' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  detailSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  modalHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 999, backgroundColor: '#ddd', marginBottom: 12 },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'center' },

  // Harfli büyük avatar (View)
  avatarCircleLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarTextLarge: { color: '#fff', fontSize: 22, fontWeight: '800' },

  // ✅ Resimli büyük avatar (Image)
  avatarImgLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    resizeMode: 'cover',
  },

  detailHeaderTextBlock: { flex: 1 },
  detailName: { fontSize: 18, fontWeight: '800', color: '#111' },
  detailHandle: { fontSize: 13, color: '#777', marginTop: 2 },
  detailSummary: { marginTop: 10, fontSize: 13, color: '#444' },

  detailInfoBox: { marginTop: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#f5f5f5' },
  detailInfoText: { fontSize: 12, color: '#555', marginBottom: 4 },

  detailActionsRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 14, gap: 8 },
  detailSecondaryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#eeeeee' },
  detailSecondaryBtnPressed: { backgroundColor: '#e0e0e0' },
  detailSecondaryText: { fontSize: 12, fontWeight: '600', color: '#444' },
  detailPrimaryBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#E50914' },
  detailPrimaryBtnPressed: { backgroundColor: '#c10710' },
  detailPrimaryText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
