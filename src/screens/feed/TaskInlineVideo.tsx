// src/screens/feed/TaskInlineVideo.tsx
import React from 'react';
import { View, Text, Pressable, Alert, Image } from 'react-native';
import Video from 'react-native-video';
import { isValidVideoUri, safeTrim } from './utils';

type Props = {
  t: (k: string, fallback?: any) => string;
  styles: any;

  uri: any;
  isActive: boolean;
  isPaused: boolean;

  onToggle: () => void;
  onStop: () => void;

  watermarkSource: any;
};

export default function TaskInlineVideo({
  t,
  styles,
  uri,
  isActive,
  isPaused,
  onToggle,
  onStop,
  watermarkSource,
}: Props) {
  const taskVideoUri = safeTrim(uri);
  if (!isValidVideoUri(taskVideoUri)) return null;

  return (
    <View style={styles.videoInfoRow}>
      <Text style={styles.videoInfo}>{t('feed.video.info', '📹 Bu kartla birlikte bir video planlandı.')}</Text>

      <Pressable
        style={({ pressed }) => [styles.videoPlayBtn, pressed && styles.videoPlayBtnPressed]}
        onPress={(e: any) => {
          e?.stopPropagation?.();

          if (!isValidVideoUri(taskVideoUri)) {
            Alert.alert(t('common.error', 'Hata'), t('feed.video.missing', 'Bu kartta geçerli bir video yok.'));
            return;
          }
          onToggle();
        }}
      >
        <Text style={styles.videoPlayText}>
          {isActive ? t('feed.video.closeInline', 'Videoyu kapat') : t('feed.video.watch', 'Videoyu izle')}
        </Text>
      </Pressable>

      {isActive ? (
        <View style={[styles.freeVideoPlayerWrapper, { marginTop: 10 }]}>
          <View style={styles.freeVideoPlayer}>
            <Video
              source={{ uri: taskVideoUri }}
              style={{ width: '100%', height: '100%' }}
              controls
              resizeMode="contain"
              paused={isPaused}
              repeat={false}
              playInBackground={false}
              playWhenInactive={false}
              useTextureView={true} // ✅ Android siyah ekran fix
              onError={e => {
                console.warn('[Feed] inline task video error:', e);
                onStop();
              }}
              onEnd={() => onStop()}
            />
          </View>

          <View style={styles.videoWatermark}>
            <Image source={watermarkSource} style={styles.videoWatermarkLogo} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
