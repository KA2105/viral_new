// src/components/SharePanel.tsx
import React, { useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableWithoutFeedback,
  Image,
  ScrollView,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSocialAccounts } from '../store/useSocialAccounts';
import { API_BASE_URL } from '../config/api';

// Dış paylaşım paneli
type SharePanelProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * Kullanıcı "Hesaplarımı Bağla" dediğinde çağrılır.
   * FeedScreen şu an bunu göndermediği için OPTIONAL.
   */
  onRequestConnectAccounts?: () => void;

  /**
   * ✅ Opsiyonel gerçek paylaşım payload'ı (FeedScreen isterse gönderebilir)
   * - shareText: kullanıcıya gösterilecek metin
   * - shareUrl : video URL / link (http(s) veya /uploads/... yerine zaten absolute olmalı)
   */
  shareText?: string;
  shareUrl?: string;
};

// Basit ikon map'i
const ICONS: Record<string, any> = {
  facebook: require('../assets/icons/facebook.png'),
  instagram: require('../assets/icons/instagram.png'),
  linkedin: require('../assets/icons/linkedin.png'),
  nextsosyal: require('../assets/icons/nextsosyal.png'),
  tiktok: require('../assets/icons/tiktok.png'),
  x: require('../assets/icons/x.png'),
  youtube: require('../assets/icons/youtube.png'),
};

const SharePanel: React.FC<SharePanelProps> = ({
  visible,
  onClose,
  onRequestConnectAccounts,
  shareText,
  shareUrl,
}) => {
  const { t } = useTranslation();
  const socialStore: any = useSocialAccounts();

  const { accounts, connectedPlatforms, hydrated, hydrate } = socialStore;

  // store hydrate
  useEffect(() => {
    if (!hydrated && typeof hydrate === 'function') {
      hydrate();
    }
  }, [hydrated, hydrate]);

  const connectedAccounts = Array.isArray(accounts)
    ? accounts.filter((a: any) => a.isConnected)
    : [];

  // Bazı projelerde sadece connectedPlatforms dolu olabiliyor → fallback
  const connectedFromPlatforms = useMemo(() => {
    if (Array.isArray(connectedPlatforms) && connectedPlatforms.length) {
      // connectedPlatforms örn: ['instagram','facebook']
      return connectedPlatforms.map((p: any) => ({
        id: String(p),
        name: String(p),
        isConnected: true,
      }));
    }
    return [];
  }, [connectedPlatforms]);

  const finalConnected = connectedAccounts.length ? connectedAccounts : connectedFromPlatforms;

  const hasConnected = finalConnected.length > 0;

  const handlePressConnect = () => {
    onClose();

    if (typeof onRequestConnectAccounts === 'function') {
      // İleride FeedScreen'den gerçek navigasyon göndeririz
      onRequestConnectAccounts();
    } else {
      // Şimdilik bilgilendirici bir pencere aç
      Alert.alert(
        t('sharePanel.connectFallbackTitle', 'Hesaplarını bağla'),
        t(
          'sharePanel.connectFallbackBody',
          'Profil ekranındaki "Hesaplarımı Bağla" bölümünden dış hesaplarını ekleyebilirsin.',
        ),
      );
    }
  };

  const handlePressInfo = () => {
    Alert.alert(
      t('sharePanel.infoTitle', 'Dış hesaplarda paylaşım hakkında'),
      t(
        'sharePanel.infoBody',
        'Viral’de oluşturduğun kartları, bağladığın hesaplarda da paylaşabilmen için alt tarafta bir özet görüyorsun. Bu sürümde paylaşım, telefonunun paylaş menüsü üzerinden yapılır.',
      ),
    );
  };

  // ✅ Gerçek native paylaşım (Share API)
  const doNativeShare = async (platformLabel?: string) => {
    try {
      // Paneli kapatmak daha temiz (özellikle Android’de)
      onClose();

      const baseText =
        (typeof shareText === 'string' && shareText.trim().length
          ? shareText.trim()
          : t('feed.share.defaultText', 'Shared from Viral')) + '';

      const viralDownloadUrl = `${String(API_BASE_URL).replace(/\/+$/, '')}/download`;
      const promo = `\n\nCreated on Viral 🎯\n\nDiscover Viral:\n${viralDownloadUrl}`;

      const message = platformLabel
        ? t('feed.share.shareText', {
            defaultValue: '{{platform}} paylaşımı:\n{{text}}',
            platform: platformLabel,
            text: baseText + promo,
          })
        : baseText + promo;

      const url = typeof shareUrl === 'string' && shareUrl.trim().length ? shareUrl.trim() : undefined;

      // RN Share: Android’de url ayrı alan olarak gider, iOS’ta da destekli.
      // Video dosyasını “dosya olarak” paylaşmak istiyorsan ek native modül gerekir.
      await Share.share(url ? { message, url } : { message });
    } catch (e: any) {
      // Kullanıcı iptali veya hata
      console.warn('[SharePanel] Share.share error:', e);
      Alert.alert(
        t('feed.share.errorTitle', 'Paylaşım'),
        t('feed.share.errorMessage', 'Paylaşım iptal edildi veya bir hata oluştu.'),
      );
    }
  };

  const handleShareAll = () => {
    // ✅ Simülasyon yerine gerçek share sheet
    // “Tüm hesaplarda” = tek seferde share menüsü aç, kullanıcı istediği app’i seçsin.
    const label = t('sharePanel.shareAllButton', 'Tüm hesaplarda paylaş');
    doNativeShare(label);
  };

  const renderConnectedLogos = () => {
    if (!hasConnected) return null;

    return (
      <View style={styles.logoRow}>
        {finalConnected.map((acc: any) => {
          const id = String(acc.id || '').toLowerCase();
          const iconSource = ICONS[id] ?? ICONS.instagram;

          const label =
            typeof acc.name === 'string' && acc.name.trim().length ? acc.name.trim() : id || 'platform';

          return (
            <Pressable
              key={String(acc.id)}
              onPress={() => doNativeShare(label)}
              style={({ pressed }) => [styles.logoItem, pressed && styles.logoItemPressed]}
            >
              <Image source={iconSource} style={styles.logoIcon} resizeMode="contain" />
              <Text style={styles.logoLabel} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <View style={styles.handle} />

        {!hasConnected ? (
          <>
            <Text style={styles.title}>
              {t('share.requireAccounts.title', 'Önce hesaplarını bağlamalısın')}
            </Text>
            <Text style={styles.subtitle}>
              {t('share.requireAccounts.desc', 'Dış platformlarda paylaşmak için önce hesaplarını bağlamalısın.')}
            </Text>

            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
                onPress={handlePressConnect}
              >
                <Text style={styles.primaryBtnText}>
                  {t('sharePanel.connectButton', 'Hesaplarımı Bağla')}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                onPress={onClose}
              >
                <Text style={styles.secondaryBtnText}>
                  {t('common.cancel', 'İptal')}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.infoBtn, pressed && styles.infoBtnPressed]}
                onPress={handlePressInfo}
              >
                <Text style={styles.infoBtnText}>i</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>
              {t('sharePanel.shareTitle', 'Dış hesaplarda paylaş')}
            </Text>
            <Text style={styles.subtitle}>
              {t(
                'sharePanel.shareBody',
                'Bağlı hesapların aşağıda listeleniyor. Birine dokunup paylaş menüsünü açabilirsin.',
              )}
            </Text>

            <ScrollView style={{ maxHeight: 180, marginTop: 8 }} contentContainerStyle={{ paddingBottom: 4 }}>
              {renderConnectedLogos()}
            </ScrollView>

            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
                onPress={handleShareAll}
              >
                <Text style={styles.primaryBtnText}>
                  {t('sharePanel.shareAllButton', 'Tüm hesaplarda paylaş')}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
                onPress={onClose}
              >
                <Text style={styles.secondaryBtnText}>
                  {t('common.cancel', 'Vazgeç')}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.infoBtn, pressed && styles.infoBtnPressed]}
                onPress={handlePressInfo}
              >
                <Text style={styles.infoBtnText}>i</Text>
              </Pressable>
            </View>

            {/* küçük not */}
            <Text style={styles.miniNote}>
              {t(
                'sharePanel.nativeShareNote',
                Platform.OS === 'android'
                  ? 'Not: Paylaşım telefonunun paylaş menüsü ile yapılır.'
                  : 'Not: Paylaşım iOS paylaş menüsü ile yapılır.',
              )}
            </Text>
          </>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 8,
    elevation: 6,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#ddd',
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#666',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#E50914', // Viral kırmızısı
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: {
    opacity: 0.9,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  secondaryBtnPressed: {
    backgroundColor: '#f0f0f0',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
  },
  infoBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  infoBtnPressed: {
    backgroundColor: '#f5f5f5',
  },
  infoBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#555',
  },
  logoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  logoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f5f5f5',
  },
  logoItemPressed: {
    backgroundColor: '#ececec',
  },
  logoIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 6,
  },
  logoLabel: {
    fontSize: 12,
    color: '#333',
    maxWidth: 110,
  },
  miniNote: {
    marginTop: 10,
    fontSize: 11,
    color: '#999',
  },
});

export default SharePanel;
