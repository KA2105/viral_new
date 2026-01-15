// src/screens/ProfileScreen.tsx
import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../store/useAuth';
import { useFeed } from '../store/useFeed';
import { useTasks } from '../store/useTasks';
import { useSocialAccounts } from '../store/useSocialAccounts';
import {
  launchImageLibrary,
  Asset,
  ImageLibraryOptions,
  ImagePickerResponse,
} from 'react-native-image-picker';
import { useOnboarding } from '../store/useOnboarding';

// 🌍 i18n eklemeleri
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../components/LanguageSelector';

// ✅ Backend ME entegrasyonu
import { getMe, putMe, API_BASE_URL } from '../config/api';

// ✅ BRAND COLOR
const VIRAL_RED = '#E50914';

// ✅ account link persistence key
const STORAGE_ACCOUNT_LINKS_KEY = 'viral_profile_account_links_v1';

// ✅ Avatar upload helper (local uri -> server path/url)
const uploadAvatarToServer = async (
  localUri: string,
  token?: string | null,
): Promise<{ avatarUrl: string | null; avatarPath: string | null }> => {
  try {
    const uri = String(localUri || '').trim();
    if (!uri) return { avatarUrl: null, avatarPath: null };

    const formData = new FormData();
    formData.append('file', {
      uri,
      type: 'image/jpeg',
      name: `avatar_${Date.now()}.jpg`,
    } as any);

    const headers: any = {};
    if (token && String(token).trim().length) {
      headers.Authorization = `Bearer ${String(token).trim()}`;
    }

    const res = await fetch(`${API_BASE_URL}/uploads/avatar`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      console.warn('[Profile] avatar upload failed:', res.status);
      return { avatarUrl: null, avatarPath: null };
    }

    const json = await res.json().catch(() => null);

    const avatarUrl =
      (json?.avatarUrl != null ? String(json.avatarUrl).trim() : '') ||
      (json?.url != null ? String(json.url).trim() : '') ||
      '';

    const avatarPath =
      (json?.avatarPath != null ? String(json.avatarPath).trim() : '') ||
      (json?.path != null ? String(json.path).trim() : '') ||
      '';

    return {
      avatarUrl: avatarUrl || null,
      avatarPath: avatarPath || null,
    };
  } catch (e) {
    console.warn('[Profile] avatar upload error:', e);
    return { avatarUrl: null, avatarPath: null };
  }
};

// --- Tipler ---
type SocialPlatformId =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'nextsosyal'
  | 'tiktok'
  | 'x'
  | 'youtube';

type SocialPlatform = {
  id: SocialPlatformId;
  label: string;
  icon: any;
};

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { id: 'facebook', label: 'Facebook', icon: require('../assets/icons/facebook.png') },
  { id: 'instagram', label: 'Instagram', icon: require('../assets/icons/instagram.png') },
  { id: 'linkedin', label: 'LinkedIn', icon: require('../assets/icons/linkedin.png') },
  { id: 'nextsosyal', label: 'Nextsosyal', icon: require('../assets/icons/nextsosyal.png') },
  { id: 'tiktok', label: 'TikTok', icon: require('../assets/icons/tiktok.png') },
  { id: 'x', label: 'X', icon: require('../assets/icons/x.png') },
  { id: 'youtube', label: 'youtube', icon: require('../assets/icons/youtube.png') },
];

type ActivityItem = {
  id: string;
  title: string;
  likes: number;
  isTaskCard: boolean;
  hasVideo: boolean;
  lastSharedTargets?: string[] | null;
};

// App'ten opsiyonel olarak InstagramLogs ekranına geçmek için prop
type ProfileScreenProps = {
  goToInstagramLogs?: () => void;
};

const ProfileScreen: React.FC<ProfileScreenProps> = ({ goToInstagramLogs }) => {
  // 🌍 çeviri hook'u
  const { t } = useTranslation();

  const {
    userId,
    profile,
    saveProfile,
    requestPhoneCode,
    verifyPhoneCode,
    setAvatarUri,
    signOut,
    hydrated,
    isSyncing,
  } = useAuth() as any;

  // ✅ KRİTİK: Hook kurallarını BOZMAMAK için (Rendered fewer hooks hatası)
  // ARTIK hooklardan önce return yok. Aşağıda "güvenli ekran" için tek return var.

  // ✅ Bu hooklar daima çalışmalı (koşullu return ÜSTTE olamaz!)
  const posts = useFeed(s => s.posts);
  const tasks = useTasks(s => s.tasks);
  const socialStore: any = useSocialAccounts();
  const { reset: resetOnboarding } = useOnboarding();

  // ✅ Ekranı güvenli şekilde "bekleme" moduna alma koşulları
  const shouldBlockUI = !hydrated || !userId || !profile || isSyncing;

  // Hesap bağlama grid’i (kart içi) için
  const [showAccounts, setShowAccounts] = useState(true);

  // Profil formu
  const [fullName, setFullName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [verifyCode, setVerifyCode] = useState('');

  // Şifre görünürlük toggle
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  // Hesap bağlama mini paneli için ek state
  const [activePlatformId, setActivePlatformId] =
    useState<SocialPlatformId | null>(null);
  const [accountLinks, setAccountLinks] = useState<
    Partial<Record<SocialPlatformId, string>>
  >({});
  const [accountLinkInput, setAccountLinkInput] = useState('');
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  // Kişisel bilgiler aç/kapa
  const [showPersonalSection, setShowPersonalSection] = useState(false);

  // Telefon doğrulama aç/kapa
  const [showVerifySection, setShowVerifySection] = useState(false);

  // Diğer bölümler için aç/kapa
  const [showAccountsSection, setShowAccountsSection] = useState(false);
  const [showFeedStatsSection, setShowFeedStatsSection] = useState(false);
  const [showActivitiesSection, setShowActivitiesSection] = useState(false);

  // Arkadaş davet kartı
  const [showInviteCard, setShowInviteCard] = useState(false);

  // ✅ handle validator (backend ile aynı kurala yakın)
  const isValidHandle = (h: string) => /^[a-zA-Z0-9_.]{3,24}$/.test(h);

  // ✅ accountLinks hydrate (kalıcılık)
  useEffect(() => {
    let alive = true;

    const hydrateLinks = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_ACCOUNT_LINKS_KEY);
        if (!alive) return;
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setAccountLinks(parsed);
        }
      } catch (e) {
        console.warn('[Profile] accountLinks hydrate failed:', e);
      }
    };

    hydrateLinks();

    return () => {
      alive = false;
    };
  }, []);

  // ✅ accountLinks persist (kalıcılık)
  useEffect(() => {
    const persist = async () => {
      try {
        await AsyncStorage.setItem(
          STORAGE_ACCOUNT_LINKS_KEY,
          JSON.stringify(accountLinks || {}),
        );
      } catch (e) {
        console.warn('[Profile] accountLinks persist failed:', e);
      }
    };

    persist();
  }, [accountLinks]);

  // Profil değişince formu doldur
  useEffect(() => {
    // shouldBlockUI iken profile null olabilir; yine de safe set
    setFullName(profile?.fullName || userId || '');
    setEmail(profile?.email || '');
    setPhone(profile?.phone || '');
    setHandle((profile?.handle || '').replace(/^@+/, ''));
    setBio(profile?.bio || '');
    setWebsite(profile?.website || '');
  }, [profile, userId]);

  // ✅ Backend’ten /me çek (varsa backendUserId ile)
  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        const authState = useAuth.getState() as any;
        const backendUserId = authState.backendUserId;

        if (!backendUserId) return;

        const me = await getMe(backendUserId);

        if (!alive) return;

        // Formu backend verisiyle doldur
        setFullName(me.fullName || '');
        setEmail(me.email || '');
        setPhone(me.phone || '');
        setHandle((me.handle || '').replace(/^@+/, ''));
        setBio(me.bio || '');
        setWebsite(me.website || '');

        // ✅ Avatar backend’den geldiyse local’e de yazalım
        // - backend bazen "/uploads/..." path döndürebilir
        // - UI'da çalışması için API_BASE_URL ile normalize ediyoruz
        if (typeof me.avatarUri !== 'undefined') {
          const currentAvatar =
            (useAuth.getState() as any)?.profile?.avatarUri ?? null;
          const nextAvatarRaw = me.avatarUri ?? null;

          const nextAvatarForUI =
            nextAvatarRaw &&
            typeof nextAvatarRaw === 'string' &&
            nextAvatarRaw.trim().length
              ? (() => {
                  const v = nextAvatarRaw.trim();
                  if (v.startsWith('http://') || v.startsWith('https://')) return v;
                  if (v.startsWith('/')) return `${API_BASE_URL}${v}`;
                  return v;
                })()
              : null;

          // Store'da mevcut değer farklıysa güncelle
          if (currentAvatar !== nextAvatarForUI) {
            setAvatarUri(nextAvatarForUI);
          }
        }
      } catch (e) {
        console.warn('[Profile] GET /me failed:', e);
      }
    };

    run();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sosyal hesapları storage'dan hydrate et
  useEffect(() => {
    if (typeof socialStore?.hydrate === 'function' && !socialStore.hydrated) {
      socialStore.hydrate();
    }
  }, [socialStore?.hydrate, socialStore?.hydrated]);

  const connectedPlatformIds: SocialPlatformId[] = useMemo(() => {
    if (Array.isArray(socialStore?.connectedPlatforms)) {
      return socialStore.connectedPlatforms as SocialPlatformId[];
    }
    if (Array.isArray(socialStore?.accounts)) {
      return socialStore.accounts
        .filter((a: any) => a.isConnected)
        .map((a: any) => a.id) as SocialPlatformId[];
    }
    return [];
  }, [socialStore]);

  // Aktif platform değişince inputu doldur
  useEffect(() => {
    if (!activePlatformId) {
      setAccountLinkInput('');
      return;
    }
    const existing = accountLinks[activePlatformId];
    setAccountLinkInput(existing ?? '');
  }, [activePlatformId, accountLinks]);

  // Flash mesajı 2.5 sn sonra gizle
  useEffect(() => {
    if (!flashMessage) return;
    const tmr = setTimeout(() => setFlashMessage(null), 2500);
    return () => clearTimeout(tmr);
  }, [flashMessage]);

  const handleToggleAccountFromStore = (id: SocialPlatformId) => {
    if (typeof socialStore?.togglePlatformConnection === 'function') {
      socialStore.togglePlatformConnection(id);
    } else if (typeof socialStore?.toggleAccount === 'function') {
      socialStore.toggleAccount(id);
    }
  };

  const handleSaveProfile = async () => {
    if (!password || !passwordConfirm) {
      Alert.alert(
        t('profile.alert.warning', 'Uyarı'),
        t('profile.alert.passwordRequired', 'Şifre ve şifre tekrarı zorunludur.'),
      );
      return;
    }
    if (password !== passwordConfirm) {
      Alert.alert(
        t('profile.alert.warning', 'Uyarı'),
        t('profile.alert.passwordMismatch', 'Şifre ve şifre tekrarı aynı olmalı.'),
      );
      return;
    }

    // ✅ handle temizle + validate
    const cleanedHandle =
      typeof handle === 'string' ? handle.trim().replace(/^@+/, '') : '';

    if (cleanedHandle && !isValidHandle(cleanedHandle)) {
      Alert.alert(
        t('profile.alert.warning', 'Uyarı'),
        t(
          'profile.alert.invalidHandle',
          'Kullanıcı adı 3–24 karakter olmalı ve sadece harf, rakam, "_" veya "." içerebilir.',
        ),
      );
      return;
    }

    const result = saveProfile({
      fullName,
      email,
      phone,
      password,
      // ✅ handle sadece geçerliyse store'a gönder (boşsa undefined)
      handle: cleanedHandle || undefined,
      bio: bio?.trim() || undefined,
      website: website?.trim() || undefined,
    });

    if (!result.ok) {
      Alert.alert(
        t('profile.alert.error', 'Hata'),
        result.error || t('profile.alert.saveFailed', 'Profil güncellenemedi.'),
      );
      return;
    }

    // ✅ Backend’e yaz: PUT /me  (handle sadece valid ise gönder)
    try {
      const authState = useAuth.getState() as any;
      const backendUserId = authState.backendUserId;

      if (backendUserId) {
        const payload: any = {
          fullName,
          bio: (bio || '').trim() ? bio.trim() : null,
          website: (website || '').trim() ? website.trim() : null,
          avatarUri: (useAuth.getState() as any)?.profile?.avatarUri ?? null,
          email,
          phone,
        };

        if (cleanedHandle && isValidHandle(cleanedHandle)) {
          payload.handle = cleanedHandle;
        } else {
          // invalid/empty handle -> backend'e hiç göndermiyoruz
        }

        await putMe(backendUserId, payload);
      }
    } catch (e) {
      console.warn('[Profile] PUT /me failed:', e);
      Alert.alert(
        t('profile.alert.warning', 'Uyarı'),
        t(
          'profile.alert.savedLocalButBackendFailed',
          'Profil kaydedildi fakat sunucuya yazılamadı.',
        ),
      );
    }

    // ✅ UX: Şifre alanlarını temizle
    setPassword('');
    setPasswordConfirm('');

    Alert.alert(
      t('profile.alert.success', 'Başarılı'),
      t('profile.alert.saveSuccess', 'Profil bilgilerin güncellendi.'),
    );
  };

  const handleSendVerifyCode = () => {
    const result = requestPhoneCode();
    if (!result.ok) {
      Alert.alert(
        t('profile.alert.error', 'Hata'),
        result.error || t('profile.alert.codeSendFailed', 'Kod gönderilemedi.'),
      );
      return;
    }

    if (result.code) {
      Alert.alert(
        t('profile.verify.codeSentTitle', 'Doğrulama kodu gönderildi'),
        t('profile.verify.codeSentDev', 'Simülasyon (dev): Kod {{code}}').replace(
          '{{code}}',
          String(result.code),
        ),
      );
    } else {
      Alert.alert(
        t('profile.verify.codeSentTitle', 'Doğrulama kodu gönderildi'),
        t(
          'profile.verify.codeSentText',
          'Telefonuna bir doğrulama kodu gönderildi (simülasyon).',
        ),
      );
    }
  };

  const handleVerifyCode = () => {
    if (!verifyCode.trim()) {
      Alert.alert(
        t('profile.alert.warning', 'Uyarı'),
        t('profile.verify.enterCode', 'Lütfen doğrulama kodunu gir.'),
      );
      return;
    }

    const result = verifyPhoneCode(verifyCode.trim());
    if (!result.ok) {
      Alert.alert(
        t('profile.alert.error', 'Hata'),
        result.error || t('profile.verify.verifyFailed', 'Kod doğrulanamadı.'),
      );
      return;
    }

    setVerifyCode('');
    Alert.alert(
      t('profile.alert.success', 'Başarılı'),
      t('profile.verify.verifySuccess', 'Telefon numaran doğrulandı.'),
    );
  };

  const handlePickAvatar = async () => {
    try {
      const options: ImageLibraryOptions = {
        mediaType: 'photo',
        selectionLimit: 1,
      };

      const result: ImagePickerResponse = await launchImageLibrary(options);

      if (result.didCancel) return;

      const asset: Asset | undefined = result.assets && result.assets[0];
      if (!asset || !asset.uri) {
        Alert.alert(
          t('profile.alert.error', 'Hata'),
          t('profile.avatar.readError', 'Seçilen görsel okunamadı.'),
        );
        return;
      }

      // ✅ 1) Önce local state (UI hızlı güncellensin)
      setAvatarUri(asset.uri);

      // ✅ 2) Sonra server'a upload et ve backend'e "server path" yaz
      try {
        const authState = useAuth.getState() as any;
        const backendUserId = authState.backendUserId;

        // token varsa header için kullan (yoksa sorun değil)
        const token =
          authState?.token ??
          authState?.accessToken ??
          authState?.authToken ??
          null;

        const uploaded = await uploadAvatarToServer(asset.uri, token);

        if (!uploaded.avatarUrl && !uploaded.avatarPath) {
          console.warn('[Profile] avatar upload returned empty');
          return;
        }

        // UI'da kesin görünmesi için: url > (path'i base ile birleştir) > path
        const uiUri =
          (uploaded.avatarUrl && uploaded.avatarUrl.trim()) ||
          (uploaded.avatarPath && uploaded.avatarPath.startsWith('/')
            ? `${API_BASE_URL}${uploaded.avatarPath}`
            : uploaded.avatarPath) ||
          null;

        if (uiUri) {
          setAvatarUri(uiUri);
        }

        // Backend'e yazılacak değer: tercihen path (db'de relative dursun)
        if (backendUserId) {
          await putMe(backendUserId, {
            avatarUri: uploaded.avatarPath || uploaded.avatarUrl || null,
          });
        }
      } catch (e) {
        console.warn('[Profile] PUT /me avatar (upload flow) failed:', e);
      }
    } catch (e) {
      console.warn('[Profile] pickAvatar error:', e);
      Alert.alert(
        t('profile.alert.error', 'Hata'),
        t(
          'profile.avatar.pickError',
          'Profil fotoğrafını seçerken bir sorun oluştu. Lütfen tekrar dene.',
        ),
      );
    }
  };

  // Onboarding’i yeniden başlat
  const handleRestartOnboarding = () => {
    Alert.alert(
      t('profile.onboarding.restartTitle', 'Onboarding’i tekrar başlat'),
      t(
        'profile.onboarding.restartMessage',
        'Kısa başlangıç turunu yeniden görmek üzeresin. Devam edilsin mi?',
      ),
      [
        { text: t('common.cancel', 'Vazgeç'), style: 'cancel' },
        {
          text: t('profile.onboarding.restartConfirm', 'Evet, başlat'),
          style: 'default',
          onPress: () => {
            try {
              resetOnboarding();
              Alert.alert(
                t('profile.onboarding.readyTitle', 'Hazır 🎉'),
                t(
                  'profile.onboarding.readyMessage',
                  'Onboarding birazdan yeniden açılacak. Tur bittiğinde uygulamaya geri döneceksin.',
                ),
              );
            } catch (e) {
              console.warn('[Profile] restart onboarding error:', e);
            }
          },
        },
      ],
    );
  };

  const totalPosts = posts.length;
  const visiblePosts = posts.filter(p => !p.archived);
  const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
  const videoPlannedCount = posts.filter(p => p.videoUri).length;

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.done).length;

  const avatarUri = profile?.avatarUri ?? null;

  const initial =
    (profile?.fullName || userId || 'K')[0]?.toUpperCase?.() ?? 'K';

  const verifiedLabel = profile?.isPhoneVerified
    ? t('profile.verify.statusVerified', 'Telefon doğrulandı')
    : t('profile.verify.statusNotVerified', 'Telefon doğrulanmadı');

  const verifiedColor = profile?.isPhoneVerified ? '#2e7d32' : '#b71c1c';

  const handleForDisplay =
    profile?.handle && profile.handle.trim().length
      ? '@' + profile.handle.trim().replace(/^@+/, '')
      : '';

  // Senin kartların için aktivite özeti
  const myDisplayName = (profile?.fullName || userId || '').trim();

  const myPosts = useMemo(
    () =>
      myDisplayName
        ? posts.filter(
            p =>
              (p.author || '')
                .toString()
                .trim()
                .toLowerCase() === myDisplayName.toLowerCase(),
          )
        : [],
    [posts, myDisplayName],
  );

  const activities: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = myPosts.map(p => ({
      id: p.id,
      title: p.title,
      likes: typeof p.likes === 'number' ? p.likes : 0,
      isTaskCard: !!p.isTaskCard,
      hasVideo: !!p.videoUri,
      lastSharedTargets: p.lastSharedTargets as string[] | undefined,
    }));

    return items
      .sort((a, b) => {
        const scoreA = a.likes + (a.lastSharedTargets?.length || 0);
        const scoreB = b.likes + (b.lastSharedTargets?.length || 0);
        return scoreB - scoreA;
      })
      .slice(0, 12);
  }, [myPosts]);

  // Arkadaş davet paylaşımı
  const inviteUsername =
    handleForDisplay ||
    profile?.fullName ||
    userId ||
    t('profile.invite.defaultUsername', 'Viral kullanıcısı');

  const inviteProfileLink = `https://viral.app/u/${inviteUsername
    .toString()
    .replace(/^@+/, '')
    .replace(/\s+/g, '')
    .toLowerCase()}`;

  const inviteAppLink = 'https://viral.app/download';

  const handleShareInvite = async (platformLabel: string) => {
    try {
      const message =
        t('profile.invite.shareLine1', "Beni Viral'de bul! 👋") +
        '\n' +
        t('profile.invite.shareUsername', 'Kullanıcı adı: {{username}}').replace(
          '{{username}}',
          inviteUsername.toString(),
        ) +
        '\n' +
        t('profile.invite.shareProfile', 'Profil: {{link}}').replace(
          '{{link}}',
          inviteProfileLink,
        ) +
        '\n' +
        t('profile.invite.shareApp', 'Uygulama linki: {{link}}').replace(
          '{{link}}',
          inviteAppLink,
        ) +
        '\n\n' +
        t('profile.invite.shareVia', '({{platform}} üzerinden paylaşıyorum)').replace(
          '{{platform}}',
          platformLabel,
        );

      await Share.share({ message });
    } catch (e) {
      console.warn('[Profile] share invite error:', e);
    }
  };

  // Hesap bağlama paneli: bağla
  const handleConnectAccount = () => {
    if (!activePlatformId) return;

    const trimmed = accountLinkInput.trim();
    if (!trimmed) {
      Alert.alert(
        t('profile.alert.warning', 'Uyarı'),
        t('profile.accounts.enterLink', 'Önce bağlamak istediğin hesabın linkini gir.'),
      );
      return;
    }

    const platform = SOCIAL_PLATFORMS.find(p => p.id === activePlatformId);
    const label = platform?.label || t('profile.accounts.account', 'Hesap');

    handleToggleAccountFromStore(activePlatformId);

    setAccountLinks(prev => ({
      ...prev,
      [activePlatformId]: trimmed,
    }));

    setActivePlatformId(null);
    setAccountLinkInput('');
    setFlashMessage(
      t('profile.accounts.connectedFlash', "{{label}} hesabın başarıyla Viral'e bağlandı.").replace(
        '{{label}}',
        label,
      ),
    );
  };

  // Hesap bağlama paneli: kaldır
  const handleDisconnectAccount = () => {
    if (!activePlatformId) return;
    const platform = SOCIAL_PLATFORMS.find(p => p.id === activePlatformId);
    const label = platform?.label || t('profile.accounts.account', 'Hesap');

    handleToggleAccountFromStore(activePlatformId);

    setAccountLinks(prev => {
      const copy = { ...prev };
      delete copy[activePlatformId];
      return copy;
    });

    setActivePlatformId(null);
    setAccountLinkInput('');
    setFlashMessage(
      t('profile.accounts.disconnectedFlash', "{{label}} hesabın Viral'den kaldırıldı.").replace(
        '{{label}}',
        label,
      ),
    );
  };

  const activePlatform =
    activePlatformId && SOCIAL_PLATFORMS.find(p => p.id === activePlatformId);
  const isActivePlatformConnected =
    !!activePlatformId && connectedPlatformIds.includes(activePlatformId);

  // ✅ Hook kuralı için: "erken return" yerine tek return içinde güvenli ekran
  if (shouldBlockUI) {
    const msg = !hydrated
      ? t('common.loading', 'Yükleniyor...')
      : !userId
        ? t('profile.notLoggedIn', 'Oturum bulunamadı.')
        : t('profile.loadingProfile', 'Profil yükleniyor...');

    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.centerBox, { flex: 1 }]}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: '#666' }}>{msg}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Hesap bağlama / kaldırma flash mesajı */}
        {flashMessage && (
          <View style={styles.flashBanner}>
            <Text style={styles.flashBannerText}>{flashMessage}</Text>
          </View>
        )}

        {/* Başlık + Dil butonu */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('profile.title', 'Profil')}</Text>
          <LanguageSelector />
        </View>

        {/* Avatar + ad / handle / mail */}
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.usernameLabel}>
              {t('profile.fullNameLabel', 'Ad Soyad')}
            </Text>
            <Text style={styles.usernameValue}>
              {profile?.fullName || userId || t('profile.defaultUser', 'Kullanıcı')}
            </Text>
            {handleForDisplay ? (
              <Text style={styles.handleValue}>{handleForDisplay}</Text>
            ) : null}
            {!!profile?.email && <Text style={styles.emailValue}>{profile.email}</Text>}
          </View>
        </View>

        {/* Kişisel bilgiler aç/kapa butonu */}
        <TouchableOpacity
          style={styles.sectionToggleBtn}
          onPress={() => setShowPersonalSection(prev => !prev)}
          activeOpacity={0.85}
        >
          <View>
            <Text style={styles.sectionToggleTitle}>
              {t('profile.personalSection.title', 'Kişisel bilgiler')}
            </Text>
            <Text style={styles.sectionToggleSubtitle}>
              {showPersonalSection
                ? t('profile.personalSection.hide', 'Gizle')
                : t('profile.personalSection.showEdit', 'Göster / Düzenle')}
            </Text>
          </View>
          <Text style={styles.sectionToggleChevron}>
            {showPersonalSection ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {/* Kişisel bilgiler formu */}
        {showPersonalSection && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {t('profile.personalSection.title', 'Kişisel bilgiler')}
            </Text>

            {/* Profil fotoğrafı alanı */}
            <Text style={styles.inputLabel}>
              {t('profile.avatar.label', 'Profil fotoğrafı')}
            </Text>
            <View style={styles.avatarRowInCard}>
              <View style={styles.avatarSmall}>
                {avatarUri ? (
                  <Image
                    source={{ uri: avatarUri }}
                    style={styles.avatarSmallImage}
                  />
                ) : (
                  <Text style={styles.avatarSmallText}>{initial}</Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.avatarPickBtn}
                onPress={handlePickAvatar}
              >
                <Text style={styles.avatarPickText}>
                  {avatarUri
                    ? t('profile.avatar.change', 'Fotoğrafı değiştir')
                    : t('profile.avatar.choose', 'Fotoğraf seç')}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>
              {t('profile.fullNameLabel', 'Ad Soyad')}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={t('profile.fullNamePlaceholder', 'Ad Soyad')}
              value={fullName}
              onChangeText={setFullName}
            />

            {/* Kullanıcı adı */}
            <Text style={styles.inputLabel}>
              {t('profile.handleLabel', 'Kullanıcı adı')}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={t('profile.handlePlaceholder', '@kullanici')}
              autoCapitalize="none"
              value={handle}
              onChangeText={setHandle}
            />

            {/* Bio */}
            <Text style={styles.inputLabel}>
              {t('profile.bioLabel', 'Hakkında (bio)')}
            </Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              placeholder={t('profile.bioPlaceholder', 'Kısaca kendini anlat...')}
              value={bio}
              onChangeText={setBio}
              multiline
            />

            {/* Website */}
            <Text style={styles.inputLabel}>
              {t('profile.websiteLabel', 'Bağlantı (isteğe bağlı)')}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={t('profile.websitePlaceholder', 'https://')}
              autoCapitalize="none"
              value={website}
              onChangeText={setWebsite}
            />

            <Text style={styles.inputLabel}>
              {t('profile.emailLabel', 'E-posta')}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={t('profile.emailPlaceholder', 'ornek@mail.com')}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.inputLabel}>
              {t('profile.phoneLabel', 'Telefon')}
            </Text>
            <View style={styles.phoneRow}>
              <View style={styles.countryBox}>
                <Text style={styles.countryCodeText}>+90</Text>
              </View>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder={t('profile.phonePlaceholder', '5xx xxx xx xx')}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </View>
            <Text style={styles.phoneHint}>
              {t(
                'profile.phoneHint',
                'Numaranın başına 0 koymana gerek yok. Ülke kodu solda.',
              )}
            </Text>

            <Text style={styles.inputLabel}>
              {t('profile.passwordLabel', 'Şifre')}
            </Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder={t('profile.passwordPlaceholder', 'Şifren')}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                style={styles.showPasswordBtn}
                onPress={() => setShowPassword(prev => !prev)}
              >
                <Text style={styles.showPasswordText}>
                  {showPassword ? t('common.hide', 'Gizle') : t('common.show', 'Göster')}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>
              {t('profile.passwordConfirmLabel', 'Şifre (tekrar)')}
            </Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder={t('profile.passwordConfirmPlaceholder', 'Şifre tekrar')}
                secureTextEntry={!showPasswordConfirm}
                value={passwordConfirm}
                onChangeText={setPasswordConfirm}
              />
              <TouchableOpacity
                style={styles.showPasswordBtn}
                onPress={() => setShowPasswordConfirm(prev => !prev)}
              >
                <Text style={styles.showPasswordText}>
                  {showPasswordConfirm ? t('common.hide', 'Gizle') : t('common.show', 'Göster')}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.passwordHint}>
              {t(
                'profile.passwordHint',
                'Şifre en az 8 karakter olmalı; büyük/küçük harf, rakam ve işaret içermeli.',
              )}
            </Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveProfile}>
              <Text style={styles.primaryBtnText}>
                {t('common.save', 'Save')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Telefon doğrulama – aç/kapa */}
        <TouchableOpacity
          style={styles.sectionToggleBtn}
          onPress={() => setShowVerifySection(prev => !prev)}
          activeOpacity={0.85}
        >
          <View>
            <Text style={styles.sectionToggleTitle}>
              {t('profile.verify.sectionTitle', 'Telefon doğrulama')}
            </Text>
            <Text style={styles.sectionToggleSubtitle}>
              {showVerifySection
                ? t('profile.section.hide', 'Gizle')
                : t('profile.section.show', 'Göster')}
            </Text>
          </View>
          <Text style={styles.sectionToggleChevron}>
            {showVerifySection ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {showVerifySection && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {t('profile.verify.sectionTitle', 'Telefon doğrulama')}
            </Text>
            <Text style={[styles.verifyStatus, { color: verifiedColor }]}>
              {verifiedLabel}
            </Text>

            <View style={styles.verifyRow}>
              <TouchableOpacity style={styles.verifyBtn} onPress={handleSendVerifyCode}>
                <Text style={styles.verifyBtnText}>
                  {t('profile.verify.sendCodeButton', 'Kod gönder (simülasyon)')}
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder={t('profile.verify.codePlaceholder', 'Doğrulama kodu')}
              keyboardType="number-pad"
              value={verifyCode}
              onChangeText={setVerifyCode}
            />

            <TouchableOpacity style={styles.verifyConfirmBtn} onPress={handleVerifyCode}>
              <Text style={styles.verifyConfirmText}>
                {t('profile.verify.confirmButton', 'Kodu doğrula')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Arkadaşlarımı Davet Et – telefon doğrulamanın hemen altında */}
        <TouchableOpacity
          style={styles.inviteBtn}
          onPress={() => setShowInviteCard(prev => !prev)}
          activeOpacity={0.9}
        >
          <Text style={styles.inviteBtnText}>
            {t('profile.invite.button', 'Arkadaşlarımı Davet Et')}
          </Text>
          <Text style={styles.inviteBtnChevron}>
            {showInviteCard ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {showInviteCard && (
          <View style={styles.inviteCard}>
            <Text style={styles.inviteTitle}>
              {t('profile.invite.title', "Beni Viral'de bul")}
            </Text>
            <Text style={styles.inviteLabel}>
              {t('profile.invite.usernameLabel', 'Kullanıcı adı')}
            </Text>
            <Text style={styles.inviteValue}>{inviteUsername}</Text>

            <Text style={[styles.inviteLabel, { marginTop: 10 }]}>
              {t('profile.invite.profileLinkLabel', 'Profil linki')}
            </Text>
            <Text style={styles.inviteValue}>{inviteProfileLink}</Text>

            <Text style={[styles.inviteLabel, { marginTop: 10 }]}>
              {t('profile.invite.appLinkLabel', 'Viral uygulama linki')}
            </Text>
            <Text style={styles.inviteValue}>{inviteAppLink}</Text>

            <Text style={[styles.inviteLabel, { marginTop: 14 }]}>
              {t('profile.invite.platformQuestion', 'Hangi platformda paylaşmak istersin?')}
            </Text>

            <View style={styles.invitePlatformsRow}>
              {SOCIAL_PLATFORMS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.invitePlatformBtn}
                  onPress={() => handleShareInvite(p.label)}
                  activeOpacity={0.8}
                >
                  <Image source={p.icon} style={styles.invitePlatformIcon} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Hesap bağlama – aç/kapa başlık */}
        <TouchableOpacity
          style={styles.sectionToggleBtn}
          onPress={() => setShowAccountsSection(prev => !prev)}
          activeOpacity={0.85}
        >
          <View>
            <Text style={styles.sectionToggleTitle}>
              {t('profile.accounts.sectionTitle', 'Hesap bağlama')}
            </Text>
            <Text style={styles.sectionToggleSubtitle}>
              {showAccountsSection
                ? t('profile.section.hide', 'Gizle')
                : t('profile.section.show', 'Göster')}
            </Text>
          </View>
          <Text style={styles.sectionToggleChevron}>
            {showAccountsSection ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {showAccountsSection && (
          <View style={styles.card}>
            <View style={styles.accountHeaderRow}>
              <Text style={styles.cardTitle}>
                {t('profile.accounts.sectionTitle', 'Hesap bağlama')}
              </Text>
              <TouchableOpacity
                style={styles.accountToggleBtn}
                onPress={() =>
                  setShowAccounts(prev => {
                    const next = !prev;
                    if (!next) setActivePlatformId(null);
                    return next;
                  })
                }
              >
                <Text style={styles.accountToggleText}>
                  {t('profile.accounts.toggleButton', 'Hesapları Bağla / Çöz')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Bağlı hesap sayısı */}
            {connectedPlatformIds.length > 0 && (
              <View style={styles.accountSummaryPill}>
                <Text style={styles.accountSummaryText}>
                  {t('profile.accounts.summary', '{{count}} hesap bağlı').replace(
                    '{{count}}',
                    String(connectedPlatformIds.length),
                  )}
                </Text>
              </View>
            )}

            {showAccounts && (
              <>
                <View style={styles.accountsRow}>
                  {SOCIAL_PLATFORMS.map(platform => {
                    const isConnected = connectedPlatformIds.includes(platform.id);
                    return (
                      <TouchableOpacity
                        key={platform.id}
                        style={[
                          styles.accountChip,
                          isConnected && styles.accountChipConnected,
                        ]}
                        onPress={() => setActivePlatformId(platform.id)}
                        activeOpacity={0.8}
                      >
                        <Image source={platform.icon} style={styles.accountIcon} />
                        <View style={styles.accountTextWrapper}>
                          <Text
                            style={[
                              styles.accountName,
                              isConnected && styles.accountNameConnected,
                            ]}
                            numberOfLines={1}
                          >
                            {platform.label}
                          </Text>
                          <Text style={styles.accountStatus} numberOfLines={1}>
                            {isConnected
                              ? t('profile.accounts.connected', 'Bağlı')
                              : t('profile.accounts.connect', 'Bağla')}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Alt mini panel */}
                {activePlatform && (
                  <View style={styles.accountLinkPanel}>
                    <Text style={styles.accountLinkTitle}>
                      {activePlatform.label}{' '}
                      {isActivePlatformConnected
                        ? t('profile.accounts.manage', 'hesabını yönet')
                        : t('profile.accounts.bind', 'hesabını bağla')}
                    </Text>

                    <Text style={styles.accountLinkHint}>
                      {isActivePlatformConnected
                        ? t(
                            'profile.accounts.hintConnected',
                            'Bu hesabı Viral’den kaldırabilir ya da linkini güncelleyebilirsin.',
                          )
                        : t(
                            'profile.accounts.hintDisconnected',
                            'Profil ya da sayfa linkini girip hesabını Viral’e bağlayabilirsin.',
                          )}
                    </Text>

                    <TextInput
                      style={styles.accountLinkInput}
                      placeholder={t('profile.accounts.linkPlaceholder', 'https://...')}
                      autoCapitalize="none"
                      value={accountLinkInput}
                      onChangeText={setAccountLinkInput}
                    />

                    <View style={styles.accountLinkButtonsRow}>
                      <TouchableOpacity
                        style={styles.accountLinkSecondaryBtn}
                        onPress={() => {
                          setActivePlatformId(null);
                          setAccountLinkInput('');
                        }}
                      >
                        <Text style={styles.accountLinkSecondaryText}>
                          {t('common.cancel', 'Vazgeç')}
                        </Text>
                      </TouchableOpacity>

                      {isActivePlatformConnected ? (
                        <TouchableOpacity
                          style={styles.accountLinkPrimaryDangerBtn}
                          onPress={handleDisconnectAccount}
                        >
                          <Text style={styles.accountLinkPrimaryDangerText}>
                            {t('profile.accounts.removeButton', 'Hesabı kaldır')}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.accountLinkPrimaryBtn}
                          onPress={handleConnectAccount}
                        >
                          <Text style={styles.accountLinkPrimaryText}>
                            {t('profile.accounts.connect', 'Bağla')}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Akış istatistikleri – aç/kapa */}
        <TouchableOpacity
          style={styles.sectionToggleBtn}
          onPress={() => setShowFeedStatsSection(prev => !prev)}
          activeOpacity={0.85}
        >
          <View>
            <Text style={styles.sectionToggleTitle}>
              {t('profile.feedStats.sectionTitle', 'Akış istatistikleri')}
            </Text>
            <Text style={styles.sectionToggleSubtitle}>
              {showFeedStatsSection
                ? t('profile.section.hide', 'Gizle')
                : t('profile.section.show', 'Göster')}
            </Text>
          </View>
          <Text style={styles.sectionToggleChevron}>
            {showFeedStatsSection ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {showFeedStatsSection && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {t('profile.feedStats.sectionTitle', 'Akış istatistikleri')}
            </Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{totalPosts}</Text>
                <Text style={styles.statLabel}>
                  {t('profile.feedStats.totalCards', 'Toplam kart')}
                </Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{visiblePosts.length}</Text>
                <Text style={styles.statLabel}>
                  {t('profile.feedStats.visibleCards', 'Görünen kart')}
                </Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{totalLikes}</Text>
                <Text style={styles.statLabel}>
                  {t('profile.feedStats.totalLikes', 'Toplam beğeni')}
                </Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{videoPlannedCount}</Text>
                <Text style={styles.statLabel}>
                  {t('profile.feedStats.videoCards', 'Videolu kart')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Son aktiviteler – aç/kapa */}
        <TouchableOpacity
          style={styles.sectionToggleBtn}
          onPress={() => setShowActivitiesSection(prev => !prev)}
          activeOpacity={0.85}
        >
          <View>
            <Text style={styles.sectionToggleTitle}>
              {t('profile.activities.sectionTitle', 'Son aktiviteler')}
            </Text>
            <Text style={styles.sectionToggleSubtitle}>
              {showActivitiesSection
                ? t('profile.section.hide', 'Gizle')
                : t('profile.section.show', 'Göster')}
            </Text>
          </View>
          <Text style={styles.sectionToggleChevron}>
            {showActivitiesSection ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {showActivitiesSection && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {t('profile.activities.sectionTitle', 'Son aktiviteler')}
            </Text>
            {activities.length === 0 ? (
              <Text style={styles.activityEmptyText}>
                {t(
                  'profile.activities.empty',
                  'Henüz sana ait kart bulunamadı. Akışa görev kartı veya video eklediğinde burada özetlerini göreceksin.',
                )}
              </Text>
            ) : (
              activities.map(item => {
                const badgeParts: string[] = [];
                if (item.isTaskCard) badgeParts.push(t('profile.activities.badgeTaskCard', 'Görev kartı'));
                if (item.hasVideo) badgeParts.push(t('profile.activities.badgeVideo', 'Videolu'));
                const shareLabel =
                  item.lastSharedTargets && item.lastSharedTargets.length > 0
                    ? item.lastSharedTargets.join(', ')
                    : t('profile.activities.noSharePlanned', 'Planlanan paylaşım yok');

                return (
                  <View key={item.id} style={styles.activityRow}>
                    <View style={styles.activityIconBubble}>
                      <Text style={styles.activityIconText}>
                        {item.hasVideo ? '📹' : '📄'}
                      </Text>
                    </View>
                    <View style={styles.activityTextWrapper}>
                      <Text style={styles.activityTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.activityMeta} numberOfLines={2}>
                        {badgeParts.length > 0 ? badgeParts.join(' · ') + ' · ' : ''}
                        👍 {item.likes} · {shareLabel}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Görev istatistikleri – şimdilik hep açık */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {t('profile.taskStats.sectionTitle', 'Görev istatistikleri')}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{tasks.length}</Text>
              <Text style={styles.statLabel}>
                {t('profile.taskStats.totalTasks', 'Toplam görev')}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{tasks.filter(tk => tk.done).length}</Text>
              <Text style={styles.statLabel}>
                {t('profile.taskStats.completed', 'Tamamlanan')}
              </Text>
            </View>
          </View>
        </View>

        {/* Hesap – bu kartta sadece sosyal medya logları bölümü */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {t('profile.account.sectionTitle', 'Hesap')}
          </Text>

          {goToInstagramLogs && (
            <TouchableOpacity style={styles.logsBtn} onPress={goToInstagramLogs}>
              <Text style={styles.logsText}>
                {t('profile.account.instagramLogs', 'Instagram paylaşım loglarını gör')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Onboarding reset + Çıkış */}
        <View style={styles.bottomActionsRow}>
          <TouchableOpacity style={styles.onboardingResetBtn} onPress={handleRestartOnboarding}>
            <Text style={styles.onboardingResetText}>
              {t('profile.onboarding.restartButton', 'Onboarding’i tekrar başlat')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={signOut}>
            <Text style={styles.logoutText}>{t('profile.logout', 'Çıkış yap')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ProfileScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },

  centerBox: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 16,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#111' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: '700' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 28 },
  usernameLabel: { fontSize: 12, color: '#777' },
  usernameValue: { fontSize: 18, fontWeight: '700', color: '#111', marginTop: 2 },
  handleValue: { fontSize: 13, color: '#555', marginTop: 2 },
  emailValue: { fontSize: 13, color: '#555', marginTop: 2 },

  sectionToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 10,
  },
  sectionToggleTitle: { fontSize: 14, fontWeight: '700', color: '#111' },
  sectionToggleSubtitle: { fontSize: 11, color: '#777', marginTop: 2 },
  sectionToggleChevron: { fontSize: 16, color: '#555', marginLeft: 8 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8, color: '#222' },

  inputLabel: { fontSize: 12, color: '#666', marginBottom: 4, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
    marginBottom: 6,
  },
  bioInput: { minHeight: 60, textAlignVertical: 'top' },

  primaryBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: VIRAL_RED, // ✅ Viral Kırmızısı
  },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  passwordHint: { fontSize: 11, color: '#777', marginTop: 4 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  countryBox: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    marginRight: 8,
  },
  countryCodeText: { fontSize: 13, fontWeight: '600', color: '#333' },
  phoneInput: { flex: 1, marginBottom: 0 },
  phoneHint: { fontSize: 11, color: '#777', marginBottom: 4 },

  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, marginBottom: 0 },
  showPasswordBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0f0f0',
  },
  showPasswordText: { fontSize: 11, fontWeight: '600', color: '#444' },

  verifyStatus: { fontSize: 12, marginBottom: 6 },
  verifyRow: { flexDirection: 'row', marginBottom: 6 },
  verifyBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: '#eee' },
  verifyBtnText: { fontSize: 12, fontWeight: '600', color: '#333' },
  verifyConfirmBtn: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1565c0',
  },
  verifyConfirmText: { fontSize: 13, fontWeight: '600', color: '#fff' },

  avatarRowInCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 10 },
  avatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarSmallText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  avatarSmallImage: { width: '100%', height: '100%', borderRadius: 20 },
  avatarPickBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f0f0f0' },
  avatarPickText: { fontSize: 12, fontWeight: '600', color: '#333' },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  statBox: { flex: 1, paddingVertical: 6 },
  statValue: { fontSize: 18, fontWeight: '700', color: '#111' },
  statLabel: { fontSize: 12, color: '#777', marginTop: 2 },

  activityEmptyText: { fontSize: 12, color: '#777' },
  activityRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  activityIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f1f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  activityIconText: { fontSize: 16 },
  activityTextWrapper: { flex: 1 },
  activityTitle: { fontSize: 13, fontWeight: '600', color: '#222' },
  activityMeta: { fontSize: 11, color: '#777', marginTop: 2 },

  accountHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  accountHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountHeaderSub: { fontSize: 12, color: '#666' },

  accountToggleBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#f0f0f0' },
  accountToggleText: { fontSize: 11, fontWeight: '600', color: '#444' },

  accountSummaryPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#ffebee',
    marginBottom: 6,
    marginTop: -2,
  },
  accountSummaryText: { fontSize: 11, fontWeight: '600', color: '#c62828' },

  accountsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
    minWidth: 140,
    maxWidth: '48%',
  },
  accountChipConnected: { borderColor: '#4caf50', backgroundColor: '#eaf7ea' },
  accountIcon: { width: 22, height: 22, borderRadius: 11, marginRight: 8 },
  accountTextWrapper: { flex: 1 },
  accountName: { fontSize: 13, fontWeight: '500' },
  accountNameConnected: { color: '#2e7d32' },
  accountStatus: { fontSize: 11, color: '#777' },

  accountLinkPanel: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
    padding: 10,
  },
  accountLinkTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4, color: '#222' },
  accountLinkHint: { fontSize: 11, color: '#777', marginBottom: 6 },
  accountLinkInput: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  accountLinkButtonsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  accountLinkSecondaryBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#f0f0f0' },
  accountLinkSecondaryText: { fontSize: 12, fontWeight: '600', color: '#444' },
  accountLinkPrimaryBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, backgroundColor: '#111' },
  accountLinkPrimaryText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  accountLinkPrimaryDangerBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#ffebee',
    borderWidth: 1,
    borderColor: '#e53935',
  },
  accountLinkPrimaryDangerText: { fontSize: 12, fontWeight: '700', color: '#c62828' },

  onboardingResetBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1565c0',
    backgroundColor: '#e3f2fd',
  },
  onboardingResetText: { fontSize: 13, fontWeight: '600', color: '#0d47a1' },

  logsBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#00897b',
    backgroundColor: '#e0f2f1',
    marginBottom: 4,
  },
  logsText: { fontSize: 13, fontWeight: '600', color: '#00695c' },

  logoutBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e53935',
    backgroundColor: '#ffebee',
  },
  logoutText: { fontSize: 13, fontWeight: '600', color: '#c62828' },

  bottomActionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },

  flashBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e8f5e9',
    alignSelf: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  flashBannerText: { fontSize: 12, fontWeight: '600', color: '#2e7d32' },

  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: VIRAL_RED,
    backgroundColor: VIRAL_RED,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 10,
  },
  inviteBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  inviteBtnChevron: { fontSize: 16, color: '#ffffff' },

  inviteCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffe0b2',
    backgroundColor: '#fffaf0',
    padding: 14,
    marginBottom: 12,
  },
  inviteTitle: { fontSize: 16, fontWeight: '800', color: '#e65100', marginBottom: 8 },
  inviteLabel: { fontSize: 11, color: '#777' },
  inviteValue: { fontSize: 13, color: '#222', marginTop: 2 },
  invitePlatformsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
    gap: 8,
  },
  invitePlatformBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ffd180',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  invitePlatformIcon: { width: 20, height: 20, borderRadius: 10 },
});
