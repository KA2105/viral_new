// src/screens/OnboardingScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  Pressable,
  Image,
  TouchableOpacity,
  Alert,
  Platform, // ✅ eklendi (alt padding için)
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 🌍 i18n
import { useTranslation } from 'react-i18next';

// ✅ Backend
import { putMe } from '../config/api';
import { useAuth } from '../store/useAuth';

// Logoyu assets klasörüne eklediysen buna göre yolu ayarla
const VIRAL_LOGO = require('../assets/viral/logo.png');

type Props = {
  onFinish: () => void;
};

const { width, height } = Dimensions.get('window');

const LANG_STORAGE_KEY = 'viral_language';

type LangCode = 'tr' | 'en' | 'de' | 'fr' | 'es' | 'pt' | 'ar' | 'hi' | 'zh';

// ✅ Tek satır: sadece native isim (English satırı yok)
// ✅ label artık kullanılmıyor ama yapıyı bozmamak için tutuyoruz (gerekirse başka yerde kullanılır)
const LANGUAGE_OPTIONS: { code: LangCode; label: string; nativeLabel: string }[] = [
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'zh', label: 'Chinese', nativeLabel: '中文' },
];

// ✅ Onboarding slaytları sadece TR + EN (diğer diller EN slaytlarına düşer)
const ONB_IMAGES = {
  tr: {
    own: require('../assets/onboarding/tr/slide_own_screen.png'),
    tasks: require('../assets/onboarding/tr/slide_tasks.png'),
    video: require('../assets/onboarding/tr/slide_video.png'),
    accounts: require('../assets/onboarding/tr/slide_accounts.png'),
    free: require('../assets/onboarding/tr/slide_free_share.png'),
  },
  en: {
    own: require('../assets/onboarding/en/slide_own_screen.png'),
    tasks: require('../assets/onboarding/en/slide_tasks.png'),
    video: require('../assets/onboarding/en/slide_video.png'),
    accounts: require('../assets/onboarding/en/slide_accounts.png'),
    free: require('../assets/onboarding/en/slide_free_share.png'),
  },
} as const;

// 🧩 Slaytlar: 5. slayt EN BAŞTA
const getSlidesFor = (lang: 'tr' | 'en') => {
  const imgs = ONB_IMAGES[lang];
  return [
    { id: '5', image: imgs.own },
    { id: '1', image: imgs.tasks },
    { id: '2', image: imgs.video },
    { id: '3', image: imgs.accounts },
    { id: '4', image: imgs.free },
  ];
};

const OnboardingScreen: React.FC<Props> = ({ onFinish }) => {
  const { t, i18n } = useTranslation();
  const [index, setIndex] = useState(0);

  // ✅ Onboarding her zaman dil ekranı ile başlasın
  const [showLanguageScreen, setShowLanguageScreen] = useState(true);

  // ✅ i18n dili TR değilse (de/fr/es/pt/ar/hi/zh vs) onboarding slaytları EN gösterilsin
  const currentSlidesLang: 'tr' | 'en' = useMemo(() => {
    const lng = String(i18n.language || '').toLowerCase();
    return lng.startsWith('tr') ? 'tr' : 'en';
  }, [i18n.language]);

  const slides = useMemo(() => getSlidesFor(currentSlidesLang), [currentSlidesLang]);

  const handleNext = () => {
    if (index < slides.length - 1) {
      setIndex(prev => prev + 1);
    } else {
      onFinish();
    }
  };

  const handleSkip = () => {
    onFinish();
  };

  const handleMomentumScrollEnd = (event: any) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / width);
    setIndex(pageIndex);
  };

  // ✅ DİL EKRANI BAŞLIKLARI: onboarding.language.* (JSON'a ekledik)
  const languageTitle = t('onboarding.language.title', 'Select Language');
  const languageSubtitle = t(
    'onboarding.language.subtitle',
    'Choose your language to continue',
  );

  // ✅ KRİTİK DÜZELTME:
  // Butonlar artık common.* değil onboarding.buttons.* (JSON'a ekledik)
  // Fallback EN (diğer dillerde onboarding çevirisi yoksa TR kalmasın)
  const skipLabel = t('onboarding.buttons.skip', 'Skip');
  const nextLabel = t('onboarding.buttons.next', 'Next');
  const startLabel = t('onboarding.buttons.start', 'Start');

  const applyLanguage = async (lang: LangCode) => {
    try {
      // 1) i18n uygula
      try {
        await i18n.changeLanguage(lang);
      } catch (e) {
        console.warn('[Onboarding] changeLanguage failed:', e);
      }

      // 2) local storage
      try {
        await AsyncStorage.setItem(LANG_STORAGE_KEY, lang);
      } catch (e) {
        console.warn('[Onboarding] language save failed:', e);
      }

      // 3) backend’e yaz (varsa)
      try {
        const authState = useAuth.getState();
        const backendUserId = authState?.backendUserId;
        if (backendUserId) {
          await putMe(backendUserId, { language: lang });
        }
      } catch (e) {
        console.warn('[Onboarding] PUT /me language failed:', e);
        // kullanıcı akışını bozmayalım
      }

      // 4) Dil seçimi bitti -> slaytlara geç
      setIndex(0);
      setShowLanguageScreen(false);
    } catch (e) {
      console.warn('[Onboarding] applyLanguage error:', e);
      Alert.alert(
        t('common.error', 'Error'),
        t('onboarding.language.error', 'Language selection could not be applied.'),
      );
    }
  };

  // Dil ekranı
  if (showLanguageScreen) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.langTop}>
          <View style={styles.logoRow}>
            <View style={styles.logoBubble}>
              <Image source={VIRAL_LOGO} style={styles.logoImage} />
            </View>
            <Text style={styles.logoText}>Viral</Text>
          </View>

          <Text style={styles.langTitle}>{languageTitle}</Text>
          <Text style={styles.langSubtitle}>{languageSubtitle}</Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: Platform.OS === 'android' ? 24 : 16,
          }}
        >
          <View style={styles.langList}>
            {LANGUAGE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.code}
                style={styles.langBtn}
                activeOpacity={0.85}
                onPress={() => applyLanguage(opt.code)}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.langBtnNative,
                      (opt.code === 'ar' ? { textAlign: 'right' as const } : null),
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {opt.nativeLabel}
                  </Text>
                </View>
                <Text style={styles.langChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.langBottomHint}>
            <Text style={styles.langBottomHintText}>
              {t(
                'onboarding.language.hint',
                'You can change language later from Profile screen.',
              )}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Onboarding slaytları
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Üstte küçük logo satırı */}
      <View style={styles.logoRow}>
        <View style={styles.logoBubble}>
          <Image source={VIRAL_LOGO} style={styles.logoImage} />
        </View>
        <Text style={styles.logoText}>Viral</Text>
      </View>

      {/* Slaytlar: sadece görsel */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        contentOffset={{ x: index * width, y: 0 }}
        style={styles.scroll}
      >
        {slides.map(slide => (
          <View key={slide.id} style={[styles.slide, { width }]}>
            <Image source={slide.image} style={styles.slideImage} />
          </View>
        ))}
      </ScrollView>

      {/* Sayfa noktaları + butonlar */}
      <View style={styles.bottomArea}>
        <View style={styles.dotsRow}>
          {slides.map((s, i) => (
            <View key={s.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.bottomButtonsRow}>
          <Pressable
            style={({ pressed }) => [styles.skipBtn, pressed && styles.skipBtnPressed]}
            onPress={handleSkip}
          >
            <Text style={styles.skipText}>{skipLabel}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.nextBtn, pressed && styles.nextBtnPressed]}
            onPress={handleNext}
          >
            <Text style={styles.nextText}>
              {index === slides.length - 1 ? startLabel : nextLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default OnboardingScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },

  // Logo
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  logoBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    overflow: 'hidden',
  },
  logoImage: {
    width: 32,
    height: 32,
    resizeMode: 'contain',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },

  // Dil ekranı
  langTop: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  langTitle: {
    marginTop: 16,
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
  },
  langSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#B7B7B7',
  },
  langList: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
  },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    backgroundColor: '#0B0B0B',
    paddingHorizontal: 14,
    paddingVertical: 0,
    height: 56,
  },
  langBtnNative: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  // ❌ İkinci satır kalktı (kullanılmıyor ama stil kalsın diye silmiyoruz)
  langBtnLabel: {
    marginTop: 2,
    fontSize: 12,
    color: '#A6A6A6',
  },
  langChevron: {
    fontSize: 26,
    color: '#E50914',
    marginLeft: 10,
    marginTop: -2,
  },
  langBottomHint: {
    marginTop: 14,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  langBottomHintText: {
    fontSize: 12,
    color: '#888',
  },

  // Onboarding scroll
  scroll: {
    flex: 1,
    marginTop: 8,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideImage: {
    width: width,
    height: height * 0.74,
    resizeMode: 'contain',
  },

  bottomArea: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
    backgroundColor: '#444',
  },
  dotActive: {
    width: 14,
    backgroundColor: '#E50914',
  },

  bottomButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  skipBtnPressed: {
    backgroundColor: '#181818',
  },
  skipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#bbb',
  },
  nextBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#E50914',
  },
  nextBtnPressed: {
    backgroundColor: '#B70710',
  },
  nextText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
});
