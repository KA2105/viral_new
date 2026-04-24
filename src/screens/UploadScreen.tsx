// src/screens/UploadScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSocialAccounts } from '../store/useSocialAccounts';
import { useTasks, Task } from '../store/useTasks';
import { useFeed } from '../store/useFeed';
import { useAuth } from '../store/useAuth';
import { requestInstagramShare } from '../services/instagramShare';
import {
  launchImageLibrary,
  Asset,
  ImageLibraryOptions,
  ImagePickerResponse,
} from 'react-native-image-picker';
import { useUploadDraft } from '../store/useUploadDraft';
import { useTranslation } from 'react-i18next';

// ✅ ÖNEMLİ: UploadScreen API_URL'yi services/api'den değil, tek kaynak olan config/api'den almalı
import { API_BASE_URL as API_URL } from '../config/api';

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

type UploadMode = 'task' | 'free' | 'praise';

type PraiseCategoryId =
  | 'kindness'
  | 'success'
  | 'support'
  | 'energy'
  | 'creativity'
  | 'leadership';

type PraiseCategory = {
  id: PraiseCategoryId;
  emoji: string;
  labelKey: string;
  fallback: string;
};

type VideoPolicy = {
  role: string;
  accountStatus: string;
  isPro: boolean;
  isFeaturedCreator: boolean;
  maxVideoSeconds: number;
  canUploadLongVideo: boolean;
  videoUploadBlockedUntil?: string | null;
  postUploadBlockedUntil?: string | null;
};

const PRAISE_CATEGORIES: PraiseCategory[] = [
  {
    id: 'kindness',
    emoji: '🤍',
    labelKey: 'upload.praise.categories.kindness',
    fallback: 'Kindness',
  },
  {
    id: 'success',
    emoji: '🏆',
    labelKey: 'upload.praise.categories.success',
    fallback: 'Success',
  },
  {
    id: 'support',
    emoji: '🤝',
    labelKey: 'upload.praise.categories.support',
    fallback: 'Support',
  },
  {
    id: 'energy',
    emoji: '⚡',
    labelKey: 'upload.praise.categories.energy',
    fallback: 'Energy',
  },
  {
    id: 'creativity',
    emoji: '🎨',
    labelKey: 'upload.praise.categories.creativity',
    fallback: 'Creativity',
  },
  {
    id: 'leadership',
    emoji: '🌟',
    labelKey: 'upload.praise.categories.leadership',
    fallback: 'Leadership',
  },
];

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    id: 'facebook',
    label: 'Facebook',
    icon: require('../assets/icons/facebook.png'),
  },
  {
    id: 'instagram',
    label: 'Instagram',
    icon: require('../assets/icons/instagram.png'),
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    icon: require('../assets/icons/linkedin.png'),
  },
  {
    id: 'nextsosyal',
    label: 'Nextsosyal',
    icon: require('../assets/icons/nextsosyal.png'),
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    icon: require('../assets/icons/tiktok.png'),
  },
  {
    id: 'x',
    label: 'X',
    icon: require('../assets/icons/x.png'),
  },
  {
    id: 'youtube',
    label: 'youtube',
    icon: require('../assets/icons/youtube.png'),
  },
];

// Global bayrak: bir sonraki Upload serbest paylaşım modu
let nextUploadIsFree = false;

export const markNextUploadAsFree = () => {
  nextUploadIsFree = true;
};

// Video süre limitleri (saniye)
const NORMAL_VIDEO_LIMIT_SECONDS = 30; // Normal kullanıcı
const PRO_VIDEO_LIMIT_SECONDS = 300; // Pro kullanıcı: 5 dakika
const ADMIN_VIDEO_LIMIT_SECONDS = 24 * 60 * 60; // Admin için pratikte sınırsız

// ✅ Çoklu foto limit
const MAX_IMAGE_COUNT = 10;

// ✅ BRAND COLOR
const VIRAL_RED = '#E50914';

function normalizeStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(x => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
}

function normalizePraiseFriendName(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/^@+/, '').trim();
}

const uploadVideoToServer = async (
  localUri: string,
  token?: string | null,
): Promise<string | null> => {
  try {
    const uri = String(localUri || '').trim();
    if (!uri) {
      console.warn('[UPLOAD] localUri empty');
      return null;
    }

    const endpoint = `${API_URL}/uploads/video`;

    console.log('[UPLOAD][VIDEO] API_URL =', API_URL);
    console.log('[UPLOAD][VIDEO] endpoint =', endpoint);
    console.log('[UPLOAD][VIDEO] uri =', uri);

    const formData = new FormData();

    formData.append('file', {
      uri,
      type: 'video/mp4',
      name: `video_${Date.now()}.mp4`,
    } as any);

    const headers: any = {};
    if (token && String(token).trim().length) {
      headers.Authorization = `Bearer ${String(token).trim()}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[UPLOAD][VIDEO] upload failed:', res.status, text);
      return null;
    }

    const json = await res.json().catch(() => null);
    const url =
      (json?.videoUrl != null ? String(json.videoUrl).trim() : '') ||
      (json?.url != null ? String(json.url).trim() : '') ||
      '';

    console.log('[UPLOAD][VIDEO] upload ok, url =', url);

    return url || null;
  } catch (e) {
    console.warn('[UPLOAD][VIDEO] upload error:', e);
    return null;
  }
};

const uploadSingleImageToServer = async (
  localUri: string,
  token?: string | null,
): Promise<string | null> => {
  try {
    const uri = String(localUri || '').trim();
    if (!uri) {
      console.warn('[UPLOAD][IMAGE] localUri empty');
      return null;
    }

    const endpoint = `${API_URL}/uploads/image`;

    console.log('[UPLOAD][IMAGE] API_URL =', API_URL);
    console.log('[UPLOAD][IMAGE] endpoint =', endpoint);
    console.log('[UPLOAD][IMAGE] uri =', uri);

    const fileNameGuess = uri.split('/').pop()?.trim() || `image_${Date.now()}.jpg`;
    const lower = fileNameGuess.toLowerCase();

    let mime = 'image/jpeg';
    if (lower.endsWith('.png')) mime = 'image/png';
    else if (lower.endsWith('.webp')) mime = 'image/webp';
    else if (lower.endsWith('.heic')) mime = 'image/heic';
    else if (lower.endsWith('.heif')) mime = 'image/heif';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';

    const formData = new FormData();

    formData.append('file', {
      uri,
      type: mime,
      name: fileNameGuess,
    } as any);

    const headers: any = {};
    if (token && String(token).trim().length) {
      headers.Authorization = `Bearer ${String(token).trim()}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[UPLOAD][IMAGE] upload failed:', res.status, text);
      return null;
    }

    const json = await res.json().catch(() => null);
    const url =
      (json?.imageUrl != null ? String(json.imageUrl).trim() : '') ||
      (json?.url != null ? String(json.url).trim() : '') ||
      '';

    console.log('[UPLOAD][IMAGE] upload ok, url =', url);

    return url || null;
  } catch (e) {
    console.warn('[UPLOAD][IMAGE] upload error:', e);
    return null;
  }
};

const uploadImagesToServer = async (
  localUris: string[],
  token?: string | null,
): Promise<string[] | null> => {
  try {
    const safeUris = normalizeStringArray(localUris);
    if (!safeUris.length) return [];

    const uploaded: string[] = [];

    for (const uri of safeUris) {
      const one = await uploadSingleImageToServer(uri, token);
      if (!one) {
        return null;
      }
      uploaded.push(one);
    }

    return uploaded;
  } catch (e) {
    console.warn('[UPLOAD][IMAGE] multi upload error:', e);
    return null;
  }
};

const UploadScreen: React.FC = () => {
  const { t } = useTranslation();

  const { userId, backendUserId, profile, token } = useAuth() as any;

  const username: string =
    (profile?.fullName != null ? String(profile.fullName).trim() : '') ||
    (profile?.handle != null
      ? `@${String(profile.handle).trim().replace(/^@/, '')}`
      : '') ||
    (userId != null ? String(userId).trim() : '') ||
    t('feed.guestName', 'misafir');

  const authorAvatarUri: string | null = useMemo(() => {
    const raw =
      (profile?.avatarUri != null ? String(profile.avatarUri).trim() : '') ||
      (profile?.avatarUrl != null ? String(profile.avatarUrl).trim() : '') ||
      (profile?.avatar != null ? String(profile.avatar).trim() : '');
    return raw && raw.length > 0 ? raw : null;
  }, [profile?.avatarUri, profile?.avatarUrl, profile?.avatar]);

  const tasks = useTasks(state => state.tasks);
  const completedTasks = useMemo(() => tasks.filter(tk => tk.done), [tasks]);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showTaskList, setShowTaskList] = useState(true);
  const [cardDescription, setCardDescription] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatformId[]>([]);
  const [plannedTimeLabel] = useState(t('feed.time.justNow'));

  const socialStore: any = useSocialAccounts();
  const addTaskCardFromTask = useFeed(s => s.addTaskCardFromTask);

  const [showAccounts, setShowAccounts] = useState(true);

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoLabel, setVideoLabel] = useState<string | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);

  const [imageUris, setImageUris] = useState<string[]>([]);
  const [imageLabels, setImageLabels] = useState<string[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [forceFreePost, setForceFreePost] = useState(false);

  const [videoPolicy, setVideoPolicy] = useState<VideoPolicy | null>(null);

  // ✅ SÜRÜM 2 / ÖVGÜ PAYLAŞIMI
  const [uploadMode, setUploadMode] = useState<UploadMode>('task');
  const [praiseFriendName, setPraiseFriendName] = useState('');
  const [praiseCategoryId, setPraiseCategoryId] =
    useState<PraiseCategoryId>('kindness');
  const [praiseMessage, setPraiseMessage] = useState('');

  // ✅ Övgü arkadaş etiketi: Focus Ağı / kullanıcı arama sonuçları
  const [praiseFriendResults, setPraiseFriendResults] = useState<any[]>([]);
  const [selectedPraiseFriend, setSelectedPraiseFriend] = useState<any | null>(null);
  const [isSearchingPraiseFriend, setIsSearchingPraiseFriend] = useState(false);

  const { preselectedTaskId, setPreselectedTaskId } = useUploadDraft();

  useEffect(() => {
    if (nextUploadIsFree) {
      setSelectedTaskId(null);
      setCardDescription('');
      setForceFreePost(true);
      setUploadMode('free');
      nextUploadIsFree = false;

      if (preselectedTaskId) {
        setPreselectedTaskId(null);
      }
      return;
    }

    if (uploadMode === 'praise') return;

    if (!forceFreePost && !selectedTaskId) {
      if (preselectedTaskId) {
        const found = completedTasks.find(tk => tk.id === preselectedTaskId);
        if (found) {
          setSelectedTaskId(preselectedTaskId);
          setUploadMode('task');
        }
        setPreselectedTaskId(null);
        return;
      }

      if (completedTasks.length > 0) {
        const first = completedTasks[0];
        setSelectedTaskId(first.id);
        setUploadMode('task');
      }
    }
  }, [
    completedTasks,
    selectedTaskId,
    forceFreePost,
    preselectedTaskId,
    setPreselectedTaskId,
    uploadMode,
  ]);

  const selectedTask: Task | undefined = useMemo(
    () => completedTasks.find(tk => tk.id === selectedTaskId),
    [completedTasks, selectedTaskId],
  );

  const defaultTitleFromTask = useMemo(() => {
    if (!selectedTask) return '';
    const prefix = t('tasks.completeCardPrefix');
    return `${prefix}${selectedTask.title}`;
  }, [selectedTask, t]);

  const selectedPraiseCategory = useMemo(() => {
    return (
      PRAISE_CATEGORIES.find(c => c.id === praiseCategoryId) ||
      PRAISE_CATEGORIES[0]
    );
  }, [praiseCategoryId]);

  const selectedPraiseCategoryLabel = t(
    selectedPraiseCategory.labelKey,
    selectedPraiseCategory.fallback,
  );


  useEffect(() => {
    let cancelled = false;

    const loadVideoPolicy = async () => {
      try {
        const headers: any = {
          Accept: 'application/json',
        };

        if (token && String(token).trim().length) {
          headers.Authorization = `Bearer ${String(token).trim()}`;
        }

        if (backendUserId != null) {
          headers['x-user-id'] = String(backendUserId);
        }

        const res = await fetch(`${API_URL}/me/video-policy`, {
          method: 'GET',
          headers,
        });

        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.policy) {
          setVideoPolicy(json.policy as VideoPolicy);
        }
      } catch (e) {
        console.warn('[Upload] video policy load error:', e);
      }
    };

    loadVideoPolicy();

    return () => {
      cancelled = true;
    };
  }, [backendUserId, token]);

  const effectiveMaxVideoSeconds = useMemo(() => {
    const source: any = videoPolicy || profile || {};
    const role = String(source?.role ?? 'user').trim().toLowerCase();
    const rawMax = typeof source?.maxVideoSeconds === 'number' ? source.maxVideoSeconds : Number(source?.maxVideoSeconds);
    const customMax = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : NORMAL_VIDEO_LIMIT_SECONDS;

    if (role === 'admin') return ADMIN_VIDEO_LIMIT_SECONDS;
    if (source?.isPro === true || role === 'pro') return Math.max(customMax, PRO_VIDEO_LIMIT_SECONDS);
    if (source?.canUploadLongVideo === true || source?.isFeaturedCreator === true || role === 'creator') {
      return Math.max(customMax, NORMAL_VIDEO_LIMIT_SECONDS);
    }

    return NORMAL_VIDEO_LIMIT_SECONDS;
  }, [profile, videoPolicy]);

  const videoLimitLabel = useMemo(() => {
    if (effectiveMaxVideoSeconds >= ADMIN_VIDEO_LIMIT_SECONDS) return 'unlimited';
    if (effectiveMaxVideoSeconds >= 60) {
      const min = Math.floor(effectiveMaxVideoSeconds / 60);
      const sec = effectiveMaxVideoSeconds % 60;
      return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
    }
    return `${effectiveMaxVideoSeconds}s`;
  }, [effectiveMaxVideoSeconds]);


  const currentUserIsProAuthor = useMemo(() => {
    const source: any = videoPolicy || profile || {};
    const role = String(source?.role ?? '').trim().toLowerCase();
    return source?.isPro === true || source?.isFeaturedCreator === true || role === 'pro' || role === 'admin' || role === 'creator';
  }, [profile, videoPolicy]);

  useEffect(() => {
    if (typeof socialStore?.hydrate === 'function' && !socialStore.hydrated) {
      socialStore.hydrate();
    }
  }, [socialStore]);

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

  const togglePlatform = (id: SocialPlatformId) => {
    const isConnected = connectedPlatformIds.includes(id);

    if (!isConnected) {
      const platform = SOCIAL_PLATFORMS.find(p => p.id === id);
      const label = platform?.label ?? t('upload.share.plannedLabel');

      Alert.alert(
        t('upload.share.platformNotConnectedTitle', { platform: label }),
        t('upload.share.platformNotConnectedBody', { platform: label }),
        [
          {
            text: t('upload.share.platformNotConnectedCancel'),
            style: 'cancel',
          },
          {
            text: t('upload.share.platformNotConnectedConnect', {
              platform: label,
            }),
            onPress: () => {
              Alert.alert(
                t('upload.share.goProfileTitle'),
                t('upload.share.goProfileBody', { platform: label }),
              );
            },
          },
        ],
      );
      return;
    }

    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    );
  };

  const handleToggleAccountFromStore = (id: SocialPlatformId) => {
    if (typeof socialStore?.togglePlatformConnection === 'function') {
      socialStore.togglePlatformConnection(id);
    } else if (typeof socialStore?.toggleAccount === 'function') {
      socialStore.toggleAccount(id);
    }
  };

  const handleSelectTask = (task: Task) => {
    setSelectedTaskId(task.id);
    setForceFreePost(false);
    setUploadMode('task');
  };

  const setModeTask = () => {
    if (completedTasks.length > 0) {
      const nextTask = selectedTask || completedTasks[0];
      setSelectedTaskId(nextTask.id);
      setForceFreePost(false);
      setUploadMode('task');
      return;
    }

    Alert.alert(
      t('upload.mode.noCompletedTasksTitle'),
      t('upload.mode.noCompletedTasksBody'),
    );
  };

  const setModeFree = () => {
    setSelectedTaskId(null);
    setForceFreePost(true);
    setUploadMode('free');
  };

  const setModePraise = () => {
    setSelectedTaskId(null);
    setForceFreePost(true);
    setUploadMode('praise');
  };

  const handleToggleFreePostMode = () => {
    const hasCompleted = completedTasks.length > 0;
    const currentlyFree = forceFreePost || !selectedTask;

    if (currentlyFree) {
      if (hasCompleted) {
        const first = completedTasks[0];
        setSelectedTaskId(first.id);
        setForceFreePost(false);
        setUploadMode('task');
      } else {
        Alert.alert(
          t('upload.mode.noCompletedTasksTitle'),
          t('upload.mode.noCompletedTasksBody'),
        );
      }
    } else {
      setModeFree();
    }
  };

  const getPraiseFriendDisplayName = (user: any): string => {
    const fullName = String(user?.fullName ?? user?.displayName ?? '').trim();
    const handle = String(user?.handle ?? '').trim().replace(/^@+/, '');
    return fullName || (handle ? `@${handle}` : '');
  };

  const getPraiseFriendAvatar = (user: any): string | null => {
    const raw =
      String(user?.avatarUri ?? '').trim() ||
      String(user?.avatarUrl ?? '').trim() ||
      String(user?.avatar ?? '').trim();
    return raw || null;
  };

  const handlePraiseFriendSearch = async (text: string) => {
    setPraiseFriendName(text);
    setSelectedPraiseFriend(null);

    const q = String(text || '').trim().replace(/^@+/, '');

    if (q.length < 2) {
      setPraiseFriendResults([]);
      setIsSearchingPraiseFriend(false);
      return;
    }

    setIsSearchingPraiseFriend(true);

    try {
      const headers: any = {
        Accept: 'application/json',
      };

      if (token && String(token).trim().length) {
        headers.Authorization = `Bearer ${String(token).trim()}`;
      }

      if (backendUserId != null) {
        headers['x-user-id'] = String(backendUserId);
      }

      const res = await fetch(`${API_URL}/users/search?q=${encodeURIComponent(q)}&limit=20`, {
        method: 'GET',
        headers,
      });

      const json = await res.json().catch(() => null);
      const items = Array.isArray(json?.items) ? json.items : [];

      // ✅ Öncelik Focus Ağı arkadaşlarında; yoksa arama sonuçlarını yine göster.
      const sorted = [...items].sort((a, b) => {
        const ar = String(a?.relationship ?? '');
        const br = String(b?.relationship ?? '');
        if (ar === 'friend' && br !== 'friend') return -1;
        if (ar !== 'friend' && br === 'friend') return 1;
        return 0;
      });

      setPraiseFriendResults(sorted);
    } catch (e) {
      console.warn('[Upload] praise friend search error:', e);
      setPraiseFriendResults([]);
    } finally {
      setIsSearchingPraiseFriend(false);
    }
  };

  const handleSelectPraiseFriend = (user: any) => {
    const handle = String(user?.handle ?? '').trim().replace(/^@+/, '');
    const displayName = getPraiseFriendDisplayName(user);

    setSelectedPraiseFriend(user);
    setPraiseFriendName(handle || displayName);
    setPraiseFriendResults([]);
  };

  const pickVideo = async () => {
    try {
      const options: ImageLibraryOptions = {
        mediaType: 'video',
        selectionLimit: 1,
        includeExtra: true,
      };

      const result: ImagePickerResponse = await launchImageLibrary(options);

      if (result.didCancel) {
        console.log('[Upload] pickVideo: user cancelled');
        return;
      }

      const asset: Asset | undefined = result.assets && result.assets[0];
      if (!asset || !asset.uri) {
        console.warn('[Upload] pickVideo: no valid video');
        return;
      }

      const durationSec = typeof asset.duration === 'number' ? asset.duration : 0;

      if (durationSec > 0) {
        console.log('[Upload] video duration (s):', durationSec);

        if (durationSec > effectiveMaxVideoSeconds) {
          Alert.alert(
            t('upload.video.tooLongTitle', 'Video is too long'),
            t('upload.video.dynamicLimitBody', {
              limit: videoLimitLabel,
              defaultValue: `This account can upload videos up to ${videoLimitLabel}.`,
            }),
          );
          return;
        }
      }

      setVideoUri(asset.uri);
      setVideoDurationSeconds(durationSec > 0 ? Math.ceil(durationSec) : null);
      setVideoLabel(asset.fileName ?? t('upload.video.selectedFallback'));

      console.log('[Upload] pickVideo success:', asset.uri);
    } catch (e) {
      console.warn('[Upload] pickVideo error:', e);
      Alert.alert(t('upload.video.pickErrorTitle'), t('upload.video.pickErrorBody'));
    }
  };

  const pickImages = async () => {
    try {
      const options: ImageLibraryOptions = {
        mediaType: 'photo',
        selectionLimit: MAX_IMAGE_COUNT,
        includeExtra: true,
      };

      const result: ImagePickerResponse = await launchImageLibrary(options);

      if (result.didCancel) {
        console.log('[Upload] pickImages: user cancelled');
        return;
      }

      const assets = Array.isArray(result.assets) ? result.assets : [];
      const validAssets = assets.filter(a => !!a?.uri);

      if (!validAssets.length) {
        console.warn('[Upload] pickImages: no valid images');
        return;
      }

      const nextUris = validAssets
        .map(a => String(a.uri || '').trim())
        .filter(Boolean)
        .slice(0, MAX_IMAGE_COUNT);

      const nextLabels = validAssets
        .map((a, index) => {
          const fileName = String(a.fileName || '').trim();
          if (fileName) return fileName;
          return `image_${index + 1}.jpg`;
        })
        .slice(0, MAX_IMAGE_COUNT);

      setImageUris(nextUris);
      setImageLabels(nextLabels);

      console.log('[Upload] pickImages success count:', nextUris.length);
    } catch (e) {
      console.warn('[Upload] pickImages error:', e);
      Alert.alert(
        t('upload.images.pickErrorTitle'),
        t('upload.images.pickErrorBody'),
      );
    }
  };

  const removePickedImageAt = (index: number) => {
    setImageUris(prev => prev.filter((_, i) => i !== index));
    setImageLabels(prev => prev.filter((_, i) => i !== index));
  };

  const clearPickedImages = () => {
    setImageUris([]);
    setImageLabels([]);
  };

  const isPraiseMode = uploadMode === 'praise';

  const canSubmit = isPraiseMode
    ? !!normalizePraiseFriendName(praiseFriendName) && !!praiseMessage.trim()
    : !!(selectedTask || cardDescription.trim() || videoUri || imageUris.length > 0);

  const handleCreateCard = async () => {
    if (isSubmitting) return;

    const isPraisePost = uploadMode === 'praise';

    const hasFreePostContent =
      !!cardDescription.trim() ||
      !!videoUri ||
      imageUris.length > 0;

    const safePraiseFriendName = normalizePraiseFriendName(praiseFriendName);
    const safePraiseMessage = praiseMessage.trim();

    if (isPraisePost) {
      if (!safePraiseFriendName) {
        Alert.alert(
          t('upload.praise.missingFriendTitle', 'No friend selected'),
          t('upload.praise.missingFriendBody', 'Write a friend name for the praise share.'),
        );
        return;
      }

      if (!safePraiseMessage) {
        Alert.alert(
          t('upload.praise.missingMessageTitle', 'Message missing'),
          t('upload.praise.missingMessageBody', 'Write a short praise message.'),
        );
        return;
      }
    } else if (!selectedTask && !hasFreePostContent) {
      Alert.alert(
        t('upload.alerts.missingContentTitle'),
        t('upload.alerts.missingContentBody'),
      );
      return;
    }

    setIsSubmitting(true);

    try {
      let taskTitle = '';
      let note = '';

      const shareTargets = selectedPlatforms
        .map(id => SOCIAL_PLATFORMS.find(p => p.id === id)?.label)
        .filter(Boolean) as string[];

      let isFreePost = forceFreePost || !selectedTask;

      let extraPayload: any = {};

      if (isPraisePost) {
        isFreePost = true;

        taskTitle = t('upload.praise.feedTitle', {
          friend: safePraiseFriendName,
          defaultValue: `Praise for @${safePraiseFriendName}`,
        });

        note = safePraiseMessage;

        extraPayload = {
          postType: 'praise',
          isPraisePost: true,
          praiseFriendName: safePraiseFriendName,
          praiseFriendUserId:
            selectedPraiseFriend?.id != null ? Number(selectedPraiseFriend.id) : null,
          praiseFriendDisplayName:
            selectedPraiseFriend ? getPraiseFriendDisplayName(selectedPraiseFriend) : safePraiseFriendName,
          praiseFriendHandle:
            selectedPraiseFriend?.handle != null
              ? String(selectedPraiseFriend.handle).trim().replace(/^@+/, '')
              : safePraiseFriendName,
          praiseFriendAvatarUri:
            selectedPraiseFriend ? getPraiseFriendAvatar(selectedPraiseFriend) : null,
          praiseCategoryId,
          praiseCategoryLabel: selectedPraiseCategoryLabel,
          praiseCategoryEmoji: selectedPraiseCategory.emoji,
          praiseMessage: safePraiseMessage,
        };
      } else if (selectedTask && !forceFreePost) {
        const baseTitle = selectedTask.title;
        const autoTitle = defaultTitleFromTask || baseTitle;
        const descTrim = cardDescription.trim();

        taskTitle = autoTitle.trim();
        note = (descTrim || baseTitle).trim();
      } else {
        const descTrim = cardDescription.trim();

        if (!descTrim) {
          taskTitle = '';
          note = '';
        } else {
          taskTitle = '';
          note = descTrim;
        }
      }

      let finalVideoUri: string | null = videoUri;

      if (videoUri) {
        const uploadedUrl = await uploadVideoToServer(videoUri, token);

        if (!uploadedUrl) {
          Alert.alert(
            t('upload.video.uploadFailedTitle', 'Video could not be uploaded'),
            t(
              'upload.video.uploadFailedBody',
              'Video could not be uploaded to the server. Check your internet/server.',
            ),
          );
          return;
        }

        finalVideoUri = uploadedUrl;
      }

      let finalImageUris: string[] = normalizeStringArray(imageUris);

      if (imageUris.length > 0) {
        const uploadedImages = await uploadImagesToServer(imageUris, token);

        if (!uploadedImages) {
          Alert.alert(
            t('upload.images.uploadFailedTitle', 'Photos could not be uploaded'),
            t(
              'upload.images.uploadFailedBody',
              'Photos could not be uploaded to the server. Check your internet/server.',
            ),
          );
          return;
        }

        finalImageUris = normalizeStringArray(uploadedImages);
      }

      // ✅ Övgü postunda optimistic local ekleme yapmıyoruz.
      // Sebep: Aynı kart server'dan geri geldiğinde paylaşan kişide çift kart oluşuyordu.
      // Diğer paylaşım tiplerinde mevcut davranış korunuyor.
      if (!isPraisePost) {
        (addTaskCardFromTask as any)({
          taskTitle,
          note,
          author: username,
          shareTargets,
          videoUri: finalVideoUri,
          imageUris: finalImageUris,
          isFreePost,
          authorAvatarUri,
          authorIsPro: currentUserIsProAuthor,
          ...extraPayload,
        });
      }

      const createdAt = new Date().toISOString();

      const serverPayload = {
        taskTitle,
        note,
        author: username,
        isFreePost,
        shareTargets,
        videoUri: finalVideoUri,
        videoDurationSeconds,
        imageUris: finalImageUris,
        createdAt,
        userId: backendUserId ?? null,
        authorAvatarUri,
        avatarUri: authorAvatarUri,
        ...extraPayload,
      };

      try {
        const headers: any = {
          'Content-Type': 'application/json',
        };
        if (token && String(token).trim().length) {
          headers.Authorization = `Bearer ${String(token).trim()}`;
        }

        const response = await fetch(`${API_URL}/posts`, {
          method: 'POST',
          headers,
          body: JSON.stringify(serverPayload),
        });

        if (!response.ok) {
          console.warn('[API] post failed /posts', response.status);
        } else {
          const data = await response.json().catch(() => null);
          console.log('[Upload] post saved on server', data || '(no body)');
        }
      } catch (err) {
        console.warn('[Upload] error while calling /posts:', err);
      }

      if (selectedPlatforms.includes('instagram')) {
        const caption = (note || taskTitle || '').trim();

        requestInstagramShare({
          caption: caption || t('feed.share.defaultText'),
          videoUri,
          username,
        });
      }

      Alert.alert(
        isPraisePost
          ? t('upload.praise.successTitle', 'Praise shared')
          : t('upload.alerts.successTitle'),
        isPraisePost
          ? t('upload.praise.successBody', 'Your praise card has been added to the feed.')
          : selectedTask && !forceFreePost
            ? t('upload.alerts.successTaskBody')
            : t('upload.alerts.successFreeBody'),
      );

      if (isPraisePost) {
        setPraiseFriendName('');
        setSelectedPraiseFriend(null);
        setPraiseFriendResults([]);
        setPraiseCategoryId('kindness');
        setPraiseMessage('');
        setCardDescription('');
        setSelectedTaskId(null);
        setForceFreePost(true);
        setUploadMode('praise');
      } else if (selectedTask && !forceFreePost) {
        setCardDescription('');
      } else {
        setSelectedTaskId(null);
        setCardDescription('');
        setForceFreePost(true);
        setUploadMode('free');
      }

      setSelectedPlatforms([]);
      setVideoUri(null);
      setVideoLabel(null);
      setVideoDurationSeconds(null);
      setImageUris([]);
      setImageLabels([]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFreePostPreview = uploadMode === 'free' || (!selectedTask && uploadMode !== 'praise');

  const screenTitle =
    uploadMode === 'praise'
      ? t('upload.praise.screenTitle', 'Praise Share')
      : isFreePostPreview
        ? t('upload.screenTitleFree')
        : t('upload.screenTitleTask');

  const modeHelperText =
    uploadMode === 'praise'
      ? t(
          'upload.praise.description',
          'Write a short praise message for a friend and share it as a special card.',
        )
      : isFreePostPreview
        ? t('upload.mode.freeDescription')
        : t('upload.mode.taskDescription');

  const previewTitle =
    uploadMode === 'praise'
      ? t('upload.praise.previewTitle', {
          friend: normalizePraiseFriendName(praiseFriendName) || t('upload.praise.friendFallback', 'your friend'),
          defaultValue: `Praise for @${normalizePraiseFriendName(praiseFriendName) || 'your friend'}`,
        })
      : isFreePostPreview
        ? t('upload.preview.noTaskSelected')
        : defaultTitleFromTask ||
          selectedTask?.title ||
          t('upload.preview.noTaskSelected');

  const previewDescription =
    uploadMode === 'praise'
      ? praiseMessage
      : cardDescription ||
        (selectedTask
          ? `${t('feed.labels.descriptionPrefix')} ${selectedTask.title}`
          : '');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.screenTitle}>{screenTitle}</Text>

      {/* 1) PAYLAŞIM TÜRÜ + TAMAMLANMIŞ GÖREVLER */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.modeTabsRow}>
            <Pressable
              onPress={setModeTask}
              style={({ pressed }) => [
                styles.modeTabBtn,
                uploadMode === 'task' && styles.modeTabBtnActive,
                pressed && styles.modeTabBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.modeTabText,
                  uploadMode === 'task' && styles.modeTabTextActive,
                ]}
                numberOfLines={1}
              >
                {t('upload.mode.task')}
              </Text>
            </Pressable>

            <Pressable
              onPress={setModeFree}
              style={({ pressed }) => [
                styles.modeTabBtn,
                uploadMode === 'free' && styles.modeTabBtnActive,
                pressed && styles.modeTabBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.modeTabText,
                  uploadMode === 'free' && styles.modeTabTextActive,
                ]}
                numberOfLines={1}
              >
                {t('upload.mode.free')}
              </Text>
            </Pressable>

            <Pressable
              onPress={setModePraise}
              style={({ pressed }) => [
                styles.modeTabBtn,
                uploadMode === 'praise' && styles.modeTabBtnActivePraise,
                pressed && styles.modeTabBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.modeTabText,
                  uploadMode === 'praise' && styles.modeTabTextActivePraise,
                ]}
                numberOfLines={1}
              >
                {t('upload.praise.tab', 'Praise')}
              </Text>
            </Pressable>
          </View>

          {uploadMode === 'task' && completedTasks.length > 0 && (
            <Pressable
              onPress={() => setShowTaskList(prev => !prev)}
              style={({ pressed }) => [
                styles.toggleBtn,
                pressed && styles.toggleBtnPressed,
              ]}
            >
              <Text style={styles.toggleText}>
                {showTaskList
                  ? t('upload.mode.toggleHideTasks')
                  : t('upload.mode.toggleShowTasks')}
              </Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.helperText}>{modeHelperText}</Text>

        {completedTasks.length === 0 ? (
          uploadMode === 'task' && (
            <Text style={[styles.helperText, { marginTop: 4 }]}>
              {t('upload.mode.noCompletedTasksInline')}
            </Text>
          )
        ) : (
          uploadMode === 'task' &&
          showTaskList && (
            <View style={styles.taskList}>
              {completedTasks.map(task => {
                const isSelected = task.id === selectedTaskId;
                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[
                      styles.taskItem,
                      isSelected && styles.taskItemSelected,
                    ]}
                    onPress={() => handleSelectTask(task)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.taskTitle,
                        isSelected && styles.taskTitleSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )
        )}
      </View>

      {/* 2) Kart metni / Övgü metni */}
      {uploadMode === 'praise' ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t('upload.praise.friendLabel', 'Friend')}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={t('upload.praise.friendPlaceholder', 'Friend name or username')}
            placeholderTextColor="#8a8a8a"
            value={praiseFriendName}
            onChangeText={handlePraiseFriendSearch}
            autoCapitalize="none"
          />

          {selectedPraiseFriend && (
            <View style={styles.selectedPraiseFriendBox}>
              {getPraiseFriendAvatar(selectedPraiseFriend) ? (
                <Image
                  source={{ uri: getPraiseFriendAvatar(selectedPraiseFriend)! }}
                  style={styles.praiseFriendAvatar}
                />
              ) : (
                <View style={styles.praiseFriendAvatarFallback}>
                  <Text style={styles.praiseFriendAvatarFallbackText}>
                    {(getPraiseFriendDisplayName(selectedPraiseFriend)[0] || '@').toUpperCase()}
                  </Text>
                </View>
              )}

              <View style={styles.praiseFriendTextWrap}>
                <Text style={styles.selectedPraiseFriendName} numberOfLines={1}>
                  {getPraiseFriendDisplayName(selectedPraiseFriend)}
                </Text>
                {!!selectedPraiseFriend?.handle && (
                  <Text style={styles.selectedPraiseFriendHandle} numberOfLines={1}>
                    @{String(selectedPraiseFriend.handle).replace(/^@+/, '')}
                  </Text>
                )}
              </View>

              <Pressable
                onPress={() => {
                  setSelectedPraiseFriend(null);
                  setPraiseFriendName('');
                }}
                style={({ pressed }) => [
                  styles.clearPraiseFriendBtn,
                  pressed && styles.clearPraiseFriendBtnPressed,
                ]}
              >
                <Text style={styles.clearPraiseFriendBtnText}>×</Text>
              </Pressable>
            </View>
          )}

          {praiseFriendResults.length > 0 && (
            <View style={styles.praiseFriendResultsBox}>
              {praiseFriendResults.map(user => {
                const avatar = getPraiseFriendAvatar(user);
                const displayName = getPraiseFriendDisplayName(user);
                const relationship = String(user?.relationship ?? '');

                return (
                  <Pressable
                    key={String(user?.id ?? displayName)}
                    onPress={() => handleSelectPraiseFriend(user)}
                    style={({ pressed }) => [
                      styles.praiseFriendResultItem,
                      pressed && styles.praiseFriendResultItemPressed,
                    ]}
                  >
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.praiseFriendAvatar} />
                    ) : (
                      <View style={styles.praiseFriendAvatarFallback}>
                        <Text style={styles.praiseFriendAvatarFallbackText}>
                          {(displayName[0] || '@').toUpperCase()}
                        </Text>
                      </View>
                    )}

                    <View style={styles.praiseFriendTextWrap}>
                      <Text style={styles.praiseFriendResultName} numberOfLines={1}>
                        {displayName || t('profile.defaultUser', 'User')}
                      </Text>
                      <Text style={styles.praiseFriendResultHandle} numberOfLines={1}>
                        {user?.handle ? `@${String(user.handle).replace(/^@+/, '')}` : ''}
                      </Text>
                    </View>

                    {relationship === 'friend' && (
                      <Text style={styles.praiseFriendRelationBadge}>
                        {t('focusNetwork.friend', 'Friend')}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {isSearchingPraiseFriend && (
            <Text style={styles.praiseFriendSearchingText}>
              {t('common.loading', 'Loading...')}
            </Text>
          )}

          <Text style={[styles.sectionLabel, { marginTop: 14 }]}>
            {t('upload.praise.categoryLabel', 'Category')}
          </Text>
          <View style={styles.praiseCategoryRow}>
            {PRAISE_CATEGORIES.map(category => {
              const selected = category.id === praiseCategoryId;
              return (
                <Pressable
                  key={category.id}
                  onPress={() => setPraiseCategoryId(category.id)}
                  style={({ pressed }) => [
                    styles.praiseCategoryChip,
                    selected && styles.praiseCategoryChipSelected,
                    pressed && styles.praiseCategoryChipPressed,
                  ]}
                >
                  <Text style={styles.praiseCategoryEmoji}>{category.emoji}</Text>
                  <Text
                    style={[
                      styles.praiseCategoryText,
                      selected && styles.praiseCategoryTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {t(category.labelKey, category.fallback)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 14 }]}>
            {t('upload.praise.messageLabel', 'Short message')}
          </Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder={t(
              'upload.praise.messagePlaceholder',
              'Example: Your energy lifted everyone today.',
            )}
            placeholderTextColor="#8a8a8a"
            value={praiseMessage}
            onChangeText={setPraiseMessage}
            multiline
          />
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t('upload.fields.cardDescriptionLabel')}
          </Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder={t('upload.fields.cardDescriptionPlaceholder')}
            placeholderTextColor="#8a8a8a"
            value={cardDescription}
            onChangeText={setCardDescription}
            multiline
          />
        </View>
      )}

      {/* 2.5) Video (opsiyonel) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('upload.video.label')}</Text>
        <Text style={styles.videoHint}>{t('upload.video.hint')}</Text>
        <View style={styles.videoRow}>
          <Pressable
            style={({ pressed }) => [
              styles.videoBtn,
              pressed && styles.videoBtnPressed,
            ]}
            onPress={pickVideo}
          >
            <Text style={styles.videoBtnText}>
              {videoUri ? t('upload.video.change') : t('upload.video.pick')}
            </Text>
          </Pressable>

          <View style={styles.videoInfoBox}>
            <Text style={styles.videoInfoText} numberOfLines={2}>
              {videoUri
                ? videoLabel ?? t('upload.video.selectedFallback')
                : t('upload.video.notSelected')}
            </Text>
          </View>
        </View>
      </View>

      {/* 2.6) Çoklu fotoğraf (opsiyonel) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          {t('upload.images.label', 'Photos')}
        </Text>
        <Text style={styles.videoHint}>
          {t(
            'upload.images.hint',
            'You can select multiple photos.',
          )}
        </Text>

        <View style={styles.videoRow}>
          <Pressable
            style={({ pressed }) => [
              styles.videoBtn,
              pressed && styles.videoBtnPressed,
            ]}
            onPress={pickImages}
          >
            <Text style={styles.videoBtnText}>
              {imageUris.length > 0
                ? t('upload.images.change', 'Change photos')
                : t('upload.images.pick', 'Choose photo')}
            </Text>
          </Pressable>

          <View style={styles.videoInfoBox}>
            <Text style={styles.videoInfoText} numberOfLines={2}>
              {imageUris.length > 0
                ? t('upload.images.selectedCount', {
                    count: imageUris.length,
                    defaultValue: `${imageUris.length} photo(s) selected`,
                  })
                : t('upload.images.notSelected', 'No photo selected')}
            </Text>
          </View>
        </View>

        {imageUris.length > 0 && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.imagePreviewRow}
            >
              {imageUris.map((uri, index) => (
                <View key={`${uri}_${index}`} style={styles.imagePreviewItem}>
                  <Image source={{ uri }} style={styles.imagePreviewThumb} />
                  <Pressable
                    onPress={() => removePickedImageAt(index)}
                    style={({ pressed }) => [
                      styles.removeImageBtn,
                      pressed && styles.removeImageBtnPressed,
                    ]}
                  >
                    <Text style={styles.removeImageBtnText}>×</Text>
                  </Pressable>
                  <Text style={styles.imagePreviewLabel} numberOfLines={1}>
                    {imageLabels[index] || `image_${index + 1}.jpg`}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.imageActionsRow}>
              <Pressable
                onPress={clearPickedImages}
                style={({ pressed }) => [
                  styles.clearImagesBtn,
                  pressed && styles.clearImagesBtnPressed,
                ]}
              >
                <Text style={styles.clearImagesBtnText}>
                  {t('upload.images.clearAll', 'Clear all')}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* 3) Planlanan paylaşım platformları */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          {t('upload.share.plannedLabel')}
        </Text>
        <Text style={styles.freePostTip}>{t('upload.share.freePostTip')}</Text>
        <View style={styles.platformRow}>
          {SOCIAL_PLATFORMS.map(platform => {
            const isSelected = selectedPlatforms.includes(platform.id);
            return (
              <TouchableOpacity
                key={platform.id}
                style={[
                  styles.platformChip,
                  isSelected && styles.platformChipSelected,
                ]}
                onPress={() => togglePlatform(platform.id)}
                activeOpacity={0.8}
              >
                <Image source={platform.icon} style={styles.platformIcon} />
                <Text
                  style={[
                    styles.platformChipLabel,
                    isSelected && styles.platformChipLabelSelected,
                  ]}
                  numberOfLines={1}
                >
                  {platform.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 4) Hesap bağlama (katlanabilir) PROFİLE TAŞINDI */}
      {false && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>
              {t('profile.accounts.sectionTitle')}
            </Text>
            <View style={styles.sectionHeaderRight}>
              {connectedPlatformIds.length > 0 && (
                <Text style={styles.sectionSubLabel}>
                  {t('profile.accounts.summary', {
                    count: connectedPlatformIds.length,
                  })}
                </Text>
              )}
              <Pressable
                onPress={() => setShowAccounts(prev => !prev)}
                style={({ pressed }) => [
                  styles.toggleBtn,
                  pressed && styles.toggleBtnPressed,
                ]}
              >
                <Text style={styles.toggleText}>
                  {showAccounts
                    ? t('profile.section.hide')
                    : t('profile.section.show')}
                </Text>
              </Pressable>
            </View>
          </View>

          {showAccounts && (
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
                    onPress={() => handleToggleAccountFromStore(platform.id)}
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
                          ? t('profile.accounts.connected')
                          : t('profile.accounts.connect')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* 5) Önizleme */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('upload.preview.label')}</Text>
        <TaskPreviewCard
          isFreePost={isFreePostPreview}
          isPraisePost={uploadMode === 'praise'}
          title={previewTitle}
          description={previewDescription}
          platformIds={selectedPlatforms}
          plannedTimeLabel={plannedTimeLabel}
          hasVideo={!!videoUri}
          videoLabel={videoLabel}
          imageUris={imageUris}
          praiseFriendName={
            selectedPraiseFriend
              ? getPraiseFriendDisplayName(selectedPraiseFriend).replace(/^@+/, '')
              : normalizePraiseFriendName(praiseFriendName)
          }
          praiseCategoryLabel={selectedPraiseCategoryLabel}
          praiseCategoryEmoji={selectedPraiseCategory.emoji}
        />
      </View>

      {/* 6) Kartı oluştur butonu */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            !canSubmit && styles.primaryButtonDisabled,
          ]}
          onPress={handleCreateCard}
          activeOpacity={0.9}
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? (
            <View style={styles.primaryButtonContent}>
              <ActivityIndicator size="small" color="#000" />
              <Text style={[styles.primaryButtonText, { marginLeft: 8 }]}>
                {t('upload.submit.creating')}
              </Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>
              {uploadMode === 'praise'
                ? t('upload.praise.submit', 'Share Praise')
                : selectedTask && !forceFreePost
                  ? t('upload.submit.task')
                  : t('upload.submit.free')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

type TaskPreviewCardProps = {
  title: string;
  description: string;
  platformIds: SocialPlatformId[];
  plannedTimeLabel: string;
  hasVideo?: boolean;
  videoLabel?: string | null;
  isFreePost?: boolean;
  isPraisePost?: boolean;
  imageUris?: string[];
  praiseFriendName?: string;
  praiseCategoryLabel?: string;
  praiseCategoryEmoji?: string;
};

const TaskPreviewCard: React.FC<TaskPreviewCardProps> = ({
  title,
  description,
  platformIds,
  plannedTimeLabel,
  hasVideo,
  videoLabel,
  isFreePost,
  isPraisePost,
  imageUris,
  praiseFriendName,
  praiseCategoryLabel,
  praiseCategoryEmoji,
}) => {
  const { t } = useTranslation();
  const platforms = SOCIAL_PLATFORMS.filter(p => platformIds.includes(p.id));
  const safeImageUris = normalizeStringArray(imageUris);

  const titlePrefix = isPraisePost
    ? ''
    : isFreePost
      ? t('upload.preview.freePrefix')
      : t('upload.preview.taskPrefix');

  const badgeText = isPraisePost
    ? t('upload.praise.badge', 'Praise Card')
    : isFreePost
      ? t('upload.preview.freeBadge')
      : t('upload.preview.taskBadge');

  const contentLabel = isPraisePost
    ? t('upload.praise.previewMessageLabel', 'Praise message')
    : isFreePost
      ? t('upload.preview.contentLabelFree')
      : t('upload.preview.contentLabelTask');

  const videoText = videoLabel || t('upload.preview.videoFallback');

  if (isPraisePost) {
    return (
      <View style={[styles.card, styles.praisePreviewCard]}>
        <View style={styles.praisePreviewTopRow}>
          <View style={styles.praisePreviewIcon}>
            <Text style={styles.praisePreviewIconText}>
              {praiseCategoryEmoji || '🌟'}
            </Text>
          </View>

          <View style={styles.praisePreviewTitleWrap}>
            <Text style={styles.praisePreviewBadge}>{badgeText}</Text>
            <Text style={styles.praisePreviewTitle} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.praisePreviewCategory} numberOfLines={1}>
              {praiseCategoryLabel || t('upload.praise.categoryFallback', 'Praise')}
            </Text>
          </View>

          <Text style={styles.cardTime} numberOfLines={1}>
            {plannedTimeLabel}
          </Text>
        </View>

        <View style={styles.praiseMessageBox}>
          <Text style={styles.cardSectionLabel}>{contentLabel}</Text>
          <Text style={styles.praiseMessageText}>
            {description ||
              t(
                'upload.praise.previewEmptyMessage',
                'Your praise message will appear here.',
              )}
          </Text>
        </View>

        {!!praiseFriendName && (
          <Text style={styles.praiseFriendHint}>
            {t('upload.praise.previewFriendHint', {
              friend: praiseFriendName,
              defaultValue: `@${praiseFriendName} etiketlenecek`,
            })}
          </Text>
        )}

        {platforms.length > 0 && (
          <>
            <Text style={[styles.cardSectionLabel, { marginTop: 8 }]}>
              {t('upload.preview.plannedLabel')}
            </Text>
            <View style={styles.cardPlatformsRow}>
              {platforms.map(p => (
                <View key={p.id} style={styles.cardPlatformItem}>
                  <Image source={p.icon} style={styles.cardPlatformIcon} />
                  <Text style={styles.cardPlatformText} numberOfLines={1}>
                    {p.label}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {hasVideo && (
          <Text style={styles.cardVideoText}>
            {t('upload.preview.videoLabel', { label: videoText })}
          </Text>
        )}

        {safeImageUris.length > 0 && (
          <>
            <Text style={styles.cardVideoText}>
              {t('upload.preview.imagesLabel', {
                count: safeImageUris.length,
                defaultValue: `${safeImageUris.length} fotoğraf eklendi`,
              })}
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cardImagesRow}
            >
              {safeImageUris.map((uri, index) => (
                <Image
                  key={`${uri}_${index}`}
                  source={{ uri }}
                  style={styles.cardImageThumb}
                />
              ))}
            </ScrollView>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {titlePrefix}
          {title}
        </Text>
        <Text style={styles.cardTime} numberOfLines={1}>
          {plannedTimeLabel}
        </Text>
      </View>

      <Text style={styles.cardSubLink}>{badgeText}</Text>

      <View style={styles.cardBody}>
        <Text style={styles.cardSectionLabel}>{contentLabel}</Text>
        <Text style={styles.cardDescription}>{description}</Text>

        {platforms.length > 0 && (
          <>
            <Text style={[styles.cardSectionLabel, { marginTop: 8 }]}>
              {t('upload.preview.plannedLabel')}
            </Text>
            <View style={styles.cardPlatformsRow}>
              {platforms.map(p => (
                <View key={p.id} style={styles.cardPlatformItem}>
                  <Image source={p.icon} style={styles.cardPlatformIcon} />
                  <Text style={styles.cardPlatformText} numberOfLines={1}>
                    {p.label}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {hasVideo && (
          <Text style={styles.cardVideoText}>
            {t('upload.preview.videoLabel', { label: videoText })}
          </Text>
        )}

        {safeImageUris.length > 0 && (
          <>
            <Text style={styles.cardVideoText}>
              {t('upload.preview.imagesLabel', {
                count: safeImageUris.length,
                defaultValue: `${safeImageUris.length} fotoğraf eklendi`,
              })}
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cardImagesRow}
            >
              {safeImageUris.map((uri, index) => (
                <Image
                  key={`${uri}_${index}`}
                  source={{ uri }}
                  style={styles.cardImageThumb}
                />
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
    marginTop: 16,
    marginBottom: 12,
  },
  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
    marginBottom: 6,
  },
  sectionSubLabel: {
    fontSize: 12,
    color: '#666',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  helperText: {
    fontSize: 12,
    color: '#777',
  },
  freePostTip: {
    fontSize: 12,
    color: '#777',
    marginTop: 6,
  },
  modeTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modeTabBtn: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabBtnActive: {
    borderColor: '#ffb300',
    backgroundColor: '#fff7e0',
  },
  modeTabBtnActivePraise: {
    borderColor: VIRAL_RED,
    backgroundColor: '#fff0f1',
  },
  modeTabBtnPressed: {
    opacity: 0.9,
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
  },
  modeTabTextActive: {
    color: '#b27100',
  },
  modeTabTextActivePraise: {
    color: VIRAL_RED,
  },
  taskList: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
    padding: 6,
    marginTop: 8,
  },
  taskItem: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  taskItemSelected: {
    backgroundColor: '#fff7e0',
  },
  taskTitle: {
    fontSize: 13,
    color: '#333',
  },
  taskTitleSelected: {
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#fff',
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  praiseCategoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  praiseCategoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    backgroundColor: '#fff',
  },
  praiseCategoryChipSelected: {
    borderColor: VIRAL_RED,
    backgroundColor: '#fff0f1',
  },
  praiseCategoryChipPressed: {
    opacity: 0.9,
  },
  praiseCategoryEmoji: {
    fontSize: 14,
    marginRight: 5,
  },
  praiseCategoryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  praiseCategoryTextSelected: {
    color: VIRAL_RED,
  },
  selectedPraiseFriendBox: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffd6da',
    backgroundColor: '#fffafb',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  praiseFriendResultsBox: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  praiseFriendResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  praiseFriendResultItemPressed: {
    backgroundColor: '#fff0f1',
  },
  praiseFriendAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eee',
    marginRight: 10,
  },
  praiseFriendAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff0f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  praiseFriendAvatarFallbackText: {
    fontSize: 13,
    fontWeight: '700',
    color: VIRAL_RED,
  },
  praiseFriendTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  praiseFriendResultName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },
  praiseFriendResultHandle: {
    marginTop: 1,
    fontSize: 11,
    color: '#777',
  },
  selectedPraiseFriendName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },
  selectedPraiseFriendHandle: {
    marginTop: 1,
    fontSize: 11,
    color: '#777',
  },
  praiseFriendRelationBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#fff0f1',
    color: VIRAL_RED,
    fontSize: 10,
    fontWeight: '700',
  },
  praiseFriendSearchingText: {
    marginTop: 6,
    fontSize: 11,
    color: '#777',
  },
  clearPraiseFriendBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  clearPraiseFriendBtnPressed: {
    backgroundColor: '#e2e2e2',
  },
  clearPraiseFriendBtnText: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700',
    color: '#555',
  },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  videoHint: {
    fontSize: 11,
    color: '#777',
    marginBottom: 4,
  },
  videoBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#111',
  },
  videoBtnPressed: {
    opacity: 0.85,
  },
  videoBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  videoInfoBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  videoInfoText: {
    fontSize: 12,
    color: '#555',
  },
  imagePreviewRow: {
    paddingTop: 10,
    gap: 10,
  },
  imagePreviewItem: {
    width: 96,
  },
  imagePreviewThumb: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: '#eee',
  },
  imagePreviewLabel: {
    marginTop: 4,
    fontSize: 10,
    color: '#555',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeImageBtnPressed: {
    opacity: 0.85,
  },
  removeImageBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 16,
  },
  imageActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  clearImagesBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f0f0f0',
  },
  clearImagesBtnPressed: {
    backgroundColor: '#e2e2e2',
  },
  clearImagesBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
  },
  platformRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  platformChipSelected: {
    borderColor: '#ffb300',
    backgroundColor: '#fff7e0',
  },
  platformIcon: {
    width: 20,
    height: 20,
    marginRight: 6,
    borderRadius: 10,
  },
  platformChipLabel: {
    fontSize: 12,
    color: '#111',
  },
  platformChipLabelSelected: {
    fontWeight: '600',
  },
  accountsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
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
  accountChipConnected: {
    borderColor: '#4caf50',
    backgroundColor: '#eaf7ea',
  },
  accountIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginRight: 8,
  },
  accountTextWrapper: { flex: 1 },
  accountName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111',
  },
  accountNameConnected: {
    color: '#2e7d32',
  },
  accountStatus: {
    fontSize: 11,
    color: '#777',
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f0f0f0',
  },
  toggleBtnPressed: {
    backgroundColor: '#e0e0e0',
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#444',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  praisePreviewCard: {
    borderColor: '#ffd6da',
    backgroundColor: '#fffafb',
  },
  praisePreviewTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  praisePreviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff0f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  praisePreviewIconText: {
    fontSize: 22,
  },
  praisePreviewTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  praisePreviewBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: VIRAL_RED,
    marginBottom: 2,
  },
  praisePreviewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
  },
  praisePreviewCategory: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '600',
    color: '#777',
  },
  praiseMessageBox: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#f1e0e2',
    padding: 10,
  },
  praiseMessageText: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
  },
  praiseFriendHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#777',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
    marginRight: 8,
    flexWrap: 'wrap',
  },
  cardTime: {
    maxWidth: 70,
    fontSize: 11,
    color: '#777',
    textAlign: 'right',
    flexShrink: 0,
  },
  cardSubLink: {
    fontSize: 12,
    color: '#2962ff',
    marginBottom: 8,
  },
  cardBody: {},
  cardSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
    marginBottom: 2,
  },
  cardDescription: {
    fontSize: 13,
    color: '#444',
  },
  cardPlatformsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 6,
  },
  cardPlatformItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f5f5f5',
  },
  cardPlatformIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 4,
  },
  cardPlatformText: {
    fontSize: 11,
    color: '#111',
  },
  cardVideoText: {
    marginTop: 8,
    fontSize: 12,
    color: '#555',
  },
  cardImagesRow: {
    paddingTop: 8,
    gap: 8,
  },
  cardImageThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#eee',
  },
  footer: {
    marginTop: 8,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: VIRAL_RED,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default UploadScreen;
