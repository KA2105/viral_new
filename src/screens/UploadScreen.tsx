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
const MAX_FREE_DURATION = 60; // Ücretsiz kullanıcı
const MAX_APP_DURATION = 180; // Uygulamanın üst limiti (3 dakika)

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

// ✅ EK: video upload helper (local uri -> server url)
// server index.ts’de /uploads/video endpoint’i zaten var demiştin.
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

// ✅ NEW: çoklu foto upload helper (local uri[] -> server url[])
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

  // Kullanıcı adı (Akışta gösterilecek)
  const { userId, backendUserId, profile, token } = useAuth() as any;

  // ✅ FIX: Feed'de de kullandığımız mantık: fullName > handle > userId > misafir
  const username: string =
    (profile?.fullName != null ? String(profile.fullName).trim() : '') ||
    (profile?.handle != null
      ? `@${String(profile.handle).trim().replace(/^@/, '')}`
      : '') ||
    (userId != null ? String(userId).trim() : '') ||
    t('feed.guestName', 'misafir');

  // ✅ avatar uri normalize
  const authorAvatarUri: string | null = useMemo(() => {
    const raw =
      (profile?.avatarUri != null ? String(profile.avatarUri).trim() : '') ||
      (profile?.avatarUrl != null ? String(profile.avatarUrl).trim() : '') ||
      (profile?.avatar != null ? String(profile.avatar).trim() : '');
    return raw && raw.length > 0 ? raw : null;
  }, [profile?.avatarUri, profile?.avatarUrl, profile?.avatar]);

  // Görevler
  const tasks = useTasks(state => state.tasks);
  const completedTasks = useMemo(() => tasks.filter(tk => tk.done), [tasks]);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Görev listesini gizle/göster
  const [showTaskList, setShowTaskList] = useState(true);

  // Kart başlığı / açıklaması
  const [cardTitle, setCardTitle] = useState('');
  const [cardDescription, setCardDescription] = useState('');

  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatformId[]>([]);
  const [plannedTimeLabel] = useState(t('feed.time.justNow'));

  const socialStore: any = useSocialAccounts();
  const addTaskCardFromTask = useFeed(s => s.addTaskCardFromTask);

  // Hesap bağlama bölümünü aç/kapa (YÜKLE ekranında artık kullanılmıyor ama state kalsın)
  const [showAccounts, setShowAccounts] = useState(true);

  // Video state
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoLabel, setVideoLabel] = useState<string | null>(null);

  // ✅ NEW: çoklu foto state
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [imageLabels, setImageLabels] = useState<string[]>([]);

  // Kart oluşturuluyor mu?
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Serbest paylaşım modu
  const [forceFreePost, setForceFreePost] = useState(false);

  // TasksScreen'den gelen "ön seçili görev" bilgisi
  const { preselectedTaskId, setPreselectedTaskId } = useUploadDraft();

  useEffect(() => {
    if (nextUploadIsFree) {
      setSelectedTaskId(null);
      setCardTitle('');
      setCardDescription('');
      setForceFreePost(true);
      nextUploadIsFree = false;

      if (preselectedTaskId) {
        setPreselectedTaskId(null);
      }
      return;
    }

    if (!forceFreePost && !selectedTaskId) {
      if (preselectedTaskId) {
        const found = completedTasks.find(tk => tk.id === preselectedTaskId);
        if (found) {
          setSelectedTaskId(preselectedTaskId);
        }
        setPreselectedTaskId(null);
        return;
      }

      if (completedTasks.length > 0) {
        const first = completedTasks[0];
        setSelectedTaskId(first.id);
      }
    }
  }, [
    completedTasks,
    selectedTaskId,
    forceFreePost,
    preselectedTaskId,
    setPreselectedTaskId,
  ]);

  const selectedTask: Task | undefined = useMemo(
    () => completedTasks.find(tk => tk.id === selectedTaskId),
    [completedTasks, selectedTaskId],
  );

  // 🔥 Görev kartı için varsayılan başlık (çok dilli)
  const defaultTitleFromTask = useMemo(() => {
    if (!selectedTask) return '';
    const prefix = t('tasks.completeCardPrefix');
    return `${prefix}${selectedTask.title}`;
  }, [selectedTask, t]);

  // Sosyal hesapları storage'dan hydrate et
  useEffect(() => {
    if (typeof socialStore?.hydrate === 'function' && !socialStore.hydrated) {
      socialStore.hydrate();
    }
  }, [socialStore]);

  // Bağlı platform ID'leri
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

  // PLATFORM SEÇME – BAĞLI DEĞİLSE UYAR
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
  };

  // Serbest paylaşım modunu toggle eden fonksiyon
  const handleToggleFreePostMode = () => {
    const hasCompleted = completedTasks.length > 0;
    const currentlyFree = forceFreePost || !selectedTask;

    if (currentlyFree) {
      if (hasCompleted) {
        const first = completedTasks[0];
        setSelectedTaskId(first.id);
        setForceFreePost(false);
      } else {
        Alert.alert(
          t('upload.mode.noCompletedTasksTitle'),
          t('upload.mode.noCompletedTasksBody'),
        );
      }
    } else {
      setSelectedTaskId(null);
      setForceFreePost(true);
    }
  };

  // Video seçmek
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

        if (durationSec > MAX_APP_DURATION) {
          Alert.alert(t('upload.video.tooLongTitle'), t('upload.video.tooLongBody'));
          return;
        }

        if (durationSec > MAX_FREE_DURATION) {
          Alert.alert(
            t('upload.video.overFreeLimitTitle'),
            t('upload.video.overFreeLimitBody'),
            [
              {
                text: t('upload.video.overFreeLimitCancel'),
                style: 'cancel',
              },
              {
                text: t('upload.video.overFreeLimitPro'),
                onPress: () => {
                  Alert.alert(
                    t('upload.video.proInfoTitle'),
                    t('upload.video.proInfoBody'),
                  );
                },
              },
            ],
          );
          return;
        }
      }

      setVideoUri(asset.uri);
      setVideoLabel(asset.fileName ?? t('upload.video.selectedFallback'));

      console.log('[Upload] pickVideo success:', asset.uri);
    } catch (e) {
      console.warn('[Upload] pickVideo error:', e);
      Alert.alert(t('upload.video.pickErrorTitle'), t('upload.video.pickErrorBody'));
    }
  };

  // ✅ NEW: çoklu foto seçmek
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
        t('upload.images.pickErrorTitle', 'Fotoğraflar seçilemedi'),
        t('upload.images.pickErrorBody', 'Fotoğraf seçerken bir hata oluştu.'),
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

  // Form geçerli mi?
  const canSubmit = !!(
    selectedTask ||
    cardTitle.trim() ||
    cardDescription.trim() ||
    videoUri ||
    imageUris.length > 0
  );

  const handleCreateCard = async () => {
    if (isSubmitting) return;

    const hasFreePostContent =
      !!cardTitle.trim() ||
      !!cardDescription.trim() ||
      !!videoUri ||
      imageUris.length > 0;

    if (!selectedTask && !hasFreePostContent) {
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

      if (selectedTask && !forceFreePost) {
        const baseTitle = selectedTask.title;
        const autoTitle = defaultTitleFromTask || baseTitle;
        const titleTrim = cardTitle.trim();
        const descTrim = cardDescription.trim();

        taskTitle = (titleTrim || autoTitle).trim();
        note = (descTrim || baseTitle).trim();
      } else {
        const titleTrim = cardTitle.trim();
        const descTrim = cardDescription.trim();

        if (!titleTrim && !descTrim) {
          taskTitle = '';
          note = '';
        } else {
          taskTitle = titleTrim || descTrim;
          note = descTrim || titleTrim;
        }
      }

      const shareTargets = selectedPlatforms
        .map(id => SOCIAL_PLATFORMS.find(p => p.id === id)?.label)
        .filter(Boolean) as string[];

      const isFreePost = forceFreePost || !selectedTask;

      // ✅ video varsa upload et
      let finalVideoUri: string | null = videoUri;

      if (videoUri) {
        const uploadedUrl = await uploadVideoToServer(videoUri, token);

        if (!uploadedUrl) {
          Alert.alert(
            t('upload.video.uploadFailedTitle', 'Video yüklenemedi'),
            t(
              'upload.video.uploadFailedBody',
              'Video sunucuya yüklenemedi. İnternet/Server kontrol et.',
            ),
          );
          return;
        }

        finalVideoUri = uploadedUrl;
      }

      // ✅ çoklu foto varsa upload et
      let finalImageUris: string[] = normalizeStringArray(imageUris);

      if (imageUris.length > 0) {
        const uploadedImages = await uploadImagesToServer(imageUris, token);

        if (!uploadedImages) {
          Alert.alert(
            t('upload.images.uploadFailedTitle', 'Fotoğraflar yüklenemedi'),
            t(
              'upload.images.uploadFailedBody',
              'Fotoğraflar sunucuya yüklenemedi. İnternet/Server kontrol et.',
            ),
          );
          return;
        }

        finalImageUris = normalizeStringArray(uploadedImages);
      }

      // 🟢 1) Önce yerel feed'e kartı ekle
      addTaskCardFromTask({
        taskTitle,
        note,
        author: username,
        shareTargets,
        videoUri: finalVideoUri,
        imageUris: finalImageUris,
        isFreePost,
        authorAvatarUri,
      });

      // 🟢 2) Sonra backend'e post kaydı gönder
      const createdAt = new Date().toISOString();

      const serverPayload = {
        taskTitle,
        note,
        author: username,
        isFreePost,
        shareTargets,
        videoUri: finalVideoUri,
        imageUris: finalImageUris,
        createdAt,
        userId: backendUserId ?? null,
        authorAvatarUri,
        avatarUri: authorAvatarUri,
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

      // Instagram paylaşımı
      // ⚠️ Instagram için genelde local uri gerekli
      if (selectedPlatforms.includes('instagram')) {
        const caption = (note || taskTitle || '').trim();

        requestInstagramShare({
          caption: caption || t('feed.share.defaultText'),
          videoUri,
          username,
        });
      }

      Alert.alert(
        t('upload.alerts.successTitle'),
        selectedTask && !forceFreePost
          ? t('upload.alerts.successTaskBody')
          : t('upload.alerts.successFreeBody'),
      );

      if (selectedTask && !forceFreePost) {
        setCardDescription('');
      } else {
        setSelectedTaskId(null);
        setCardTitle('');
        setCardDescription('');
        setForceFreePost(true);
      }

      setSelectedPlatforms([]);
      setVideoUri(null);
      setVideoLabel(null);
      setImageUris([]);
      setImageLabels([]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFreePostPreview = forceFreePost || !selectedTask;

  const screenTitle = isFreePostPreview
    ? t('upload.screenTitleFree')
    : t('upload.screenTitleTask');

  const modeHelperText = isFreePostPreview
    ? t('upload.mode.freeDescription')
    : t('upload.mode.taskDescription');

  // Önizleme kartı için başlık
  const previewTitle =
    (cardTitle || '').trim() ||
    (isFreePostPreview
      ? t('upload.preview.noTaskSelected')
      : defaultTitleFromTask ||
        selectedTask?.title ||
        t('upload.preview.noTaskSelected'));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.screenTitle}>{screenTitle}</Text>

      {/* 1) PAYLAŞIM TÜRÜ + TAMAMLANMIŞ GÖREVLER */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.modeTabsRow}>
            <Pressable
              onPress={() => {
                if (isFreePostPreview) {
                  handleToggleFreePostMode();
                }
              }}
              style={({ pressed }) => [
                styles.modeTabBtn,
                !isFreePostPreview && styles.modeTabBtnActive,
                pressed && styles.modeTabBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.modeTabText,
                  !isFreePostPreview && styles.modeTabTextActive,
                ]}
                numberOfLines={1}
              >
                {t('upload.mode.task')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                if (!isFreePostPreview) {
                  handleToggleFreePostMode();
                }
              }}
              style={({ pressed }) => [
                styles.modeTabBtn,
                isFreePostPreview && styles.modeTabBtnActive,
                pressed && styles.modeTabBtnPressed,
              ]}
            >
              <Text
                style={[
                  styles.modeTabText,
                  isFreePostPreview && styles.modeTabTextActive,
                ]}
                numberOfLines={1}
              >
                {t('upload.mode.free')}
              </Text>
            </Pressable>
          </View>

          {!isFreePostPreview && completedTasks.length > 0 && (
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
          !isFreePostPreview && (
            <Text style={[styles.helperText, { marginTop: 4 }]}>
              {t('upload.mode.noCompletedTasksInline')}
            </Text>
          )
        ) : (
          !isFreePostPreview &&
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

      {/* 2) Kart başlığı & açıklaması */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          {t('upload.fields.cardTitleLabel')}
        </Text>
        <TextInput
          style={styles.input}
          placeholder={t('upload.fields.cardTitlePlaceholder')}
          placeholderTextColor="#8a8a8a"
          value={cardTitle}
          onChangeText={setCardTitle}
        />
      </View>

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
          {t('upload.images.label', 'Fotoğraflar')}
        </Text>
        <Text style={styles.videoHint}>
          {t(
            'upload.images.hint',
            'Birden fazla fotoğraf seçebilirsin.',
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
                ? t('upload.images.change', 'Fotoğrafları değiştir')
                : t('upload.images.pick', 'Fotoğraf seç')}
            </Text>
          </Pressable>

          <View style={styles.videoInfoBox}>
            <Text style={styles.videoInfoText} numberOfLines={2}>
              {imageUris.length > 0
                ? t('upload.images.selectedCount', {
                    count: imageUris.length,
                    defaultValue: `${imageUris.length} fotoğraf seçildi`,
                  })
                : t('upload.images.notSelected', 'Fotoğraf seçilmedi')}
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
                  {t('upload.images.clearAll', 'Tümünü temizle')}
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
          title={previewTitle}
          description={
            cardDescription ||
            (selectedTask
              ? `${t('feed.labels.descriptionPrefix')} ${selectedTask.title}`
              : '')
          }
          platformIds={selectedPlatforms}
          plannedTimeLabel={plannedTimeLabel}
          hasVideo={!!videoUri}
          videoLabel={videoLabel}
          imageUris={imageUris}
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
              {selectedTask && !forceFreePost
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
  imageUris?: string[];
};

const TaskPreviewCard: React.FC<TaskPreviewCardProps> = ({
  title,
  description,
  platformIds,
  plannedTimeLabel,
  hasVideo,
  videoLabel,
  isFreePost,
  imageUris,
}) => {
  const { t } = useTranslation();
  const platforms = SOCIAL_PLATFORMS.filter(p => platformIds.includes(p.id));
  const safeImageUris = normalizeStringArray(imageUris);

  const titlePrefix = isFreePost
    ? t('upload.preview.freePrefix')
    : t('upload.preview.taskPrefix');

  const badgeText = isFreePost
    ? t('upload.preview.freeBadge')
    : t('upload.preview.taskBadge');

  const contentLabel = isFreePost
    ? t('upload.preview.contentLabelFree')
    : t('upload.preview.contentLabelTask');

  const videoText = videoLabel || t('upload.preview.videoFallback');

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
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  modeTabBtnPressed: {
    opacity: 0.9,
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  modeTabTextActive: {
    color: '#b27100',
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