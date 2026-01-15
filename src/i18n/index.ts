// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as RNLocalize from 'react-native-localize';
import storage from '../storage';
import AsyncStorage from '@react-native-async-storage/async-storage'; // ✅ eklendi (onboarding legacy key için)

import tr from './locales/tr.json';
import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';
import zh from './locales/zh.json';

export const LANGUAGE_STORAGE_KEY = 'app_language';

// ✅ OnboardingScreen’in kullandığı legacy key (AsyncStorage)
export const LEGACY_ONB_LANG_KEY = 'viral_language';

export const availableLanguages = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '中文' },
];

const resources = {
  tr: { translation: tr },
  en: { translation: en },
  de: { translation: de },
  fr: { translation: fr },
  es: { translation: es },
  pt: { translation: pt },
  ar: { translation: ar },
  hi: { translation: hi },
  zh: { translation: zh },
} as const;

type LangCode = keyof typeof resources;

function isSupported(code: string): code is LangCode {
  return Object.prototype.hasOwnProperty.call(resources, code);
}

function normalize(codeLike: string) {
  // ✅ küçük harf + "pt-BR" -> "pt" gibi normalize
  return (codeLike || 'tr').toLowerCase().split('-')[0];
}

function getDeviceLanguage(): LangCode {
  try {
    const locales = RNLocalize.getLocales();
    if (Array.isArray(locales) && locales.length > 0) {
      const code = normalize(locales[0].languageCode);
      if (isSupported(code)) return code;
    }
  } catch (e) {
    console.warn('[i18n] getDeviceLanguage error:', e);
  }
  return 'tr';
}

/**
 * ✅ Kritik fix:
 * - Dil dosyasında key eksikse fallback'e düşer ve UI "karışık" görünür.
 * - Daha önce fallback TR olduğu için (ve birçok defaultValue TR olduğu için) her dilde TR karışıyordu.
 * - Burada fallback'i "en" yapıyoruz: Eksik key varsa EN'e düşsün (TR'ye sapmasın).
 * - Ayrıca missingKeyHandler ile hangi key eksik, konsola yazdırıyoruz.
 */
const fallbackMap: Record<string, string[]> = {
  tr: ['tr', 'en'],
  en: ['en'],
  de: ['de', 'en'],
  fr: ['fr', 'en'],
  es: ['es', 'en'],
  pt: ['pt', 'en'],
  ar: ['ar', 'en'],
  hi: ['hi', 'en'],
  zh: ['zh', 'en'],
};

const initialLng = getDeviceLanguage();

// ✅ DEV’de missing key spam’ini kesmek için cache (aynı key’yi 1 kere uyar)
const __missingOnceCache = new Set<string>();

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLng,
    fallbackLng: fallbackMap,

    // RN’de JSON format uyumu
    compatibilityJSON: 'v3',
    interpolation: { escapeValue: false },

    // ✅ null/boş dönerse UI kaybolmasın
    returnNull: false,
    returnEmptyString: false,

    // ✅ Eksik key'leri logla: hangi dilde hangi key yok net görürsün
    // 🔧 Ama spam olmasın diye 1 kere yazdırıyoruz.
    saveMissing: __DEV__,
    missingKeyHandler: (__lngs, ns, key) => {
      if (!__DEV__) return;

      // __lngs bazen string[], bazen string olabilir
      const langs = Array.isArray(__lngs) ? __lngs.join(',') : String(__lngs);

      // ✅ Aynı uyarıyı tekrar tekrar basma
      const cacheKey = `${ns}:${key}@@${langs}`;
      if (__missingOnceCache.has(cacheKey)) return;
      __missingOnceCache.add(cacheKey);

      // ✅ İstersen SharePanel spam’ini tamamen sustur:
      // if (String(key).startsWith('sharePanel.')) return;

      console.warn(`[i18n] MISSING key: "${ns}:${key}" (langs=${langs})`);
    },

    // ✅ React hook’ları için önerilen
    react: {
      useSuspense: false,
    },
  })
  .catch(err => {
    console.warn('[i18n] init error:', err);
  });

// 🔁 App açıldığında storage'daki dili yükle
// ✅ Önce app_language (storage) -> yoksa viral_language (AsyncStorage)
(async () => {
  try {
    const codeRaw = await storage.loadJson<string | null>(LANGUAGE_STORAGE_KEY);
    const code = normalize(codeRaw || '');
    if (code && isSupported(code)) {
      i18n.changeLanguage(code).catch(e => {
        console.warn('[i18n] changeLanguage from storage error:', e);
      });
      return;
    }
  } catch (e) {
    console.warn('[i18n] LANGUAGE_STORAGE_KEY load error:', e);
  }

  // ✅ fallback: OnboardingScreen’in yazdığı legacy key
  try {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_ONB_LANG_KEY);
    const legacy = normalize(legacyRaw || '');
    if (legacy && isSupported(legacy)) {
      i18n.changeLanguage(legacy).catch(e => {
        console.warn('[i18n] changeLanguage from legacy error:', e);
      });
    }
  } catch (e) {
    console.warn('[i18n] LEGACY_ONB_LANG_KEY load error:', e);
  }
})();

/**
 * 🔥 Dili değiştirmek için ortak helper:
 *  - Storage'a yazar (app_language)
 *  - Legacy AsyncStorage’a da yazar (viral_language) -> onboarding ile aynı kalsın
 *  - i18n.changeLanguage çağırır
 */
export const changeAppLanguage = async (codeRaw: string) => {
  const code = normalize(codeRaw);
  if (!isSupported(code)) {
    console.warn('[i18n] Unsupported language code:', codeRaw);
    return;
  }

  try {
    await storage.saveJson(LANGUAGE_STORAGE_KEY, code);
  } catch (e) {
    console.warn('[i18n] LANGUAGE_STORAGE_KEY save failed:', e);
  }

  // ✅ Onboarding ile uyum için legacy key’e de yaz
  try {
    await AsyncStorage.setItem(LEGACY_ONB_LANG_KEY, code);
  } catch (e) {
    console.warn('[i18n] LEGACY_ONB_LANG_KEY save failed:', e);
  }

  try {
    await i18n.changeLanguage(code);
  } catch (e) {
    console.warn('[i18n] changeLanguage error:', e);
  }
};

// ✅ (İsteğe bağlı ama faydalı) Cihaz dili değişirse otomatik güncelle.
// Not: app_language/legacy ayarlıysa ona dokunmayız; sadece hiçbir şey seçilmemişse cihaz diline uyar.
try {
  const anyLocalize: any = RNLocalize as any;
  const handler = async () => {
    try {
      const saved = await storage.loadJson<string | null>(LANGUAGE_STORAGE_KEY).catch(() => null);
      const legacy = await AsyncStorage.getItem(LEGACY_ONB_LANG_KEY).catch(() => null);
      if (saved || legacy) return;

      const device = getDeviceLanguage();
      i18n.changeLanguage(device).catch(() => {});
    } catch {
      // ignore
    }
  };

  // RNLocalize sürümlerine göre değişiyor; ikisini de güvenli dene
  if (typeof anyLocalize.addEventListener === 'function') {
    anyLocalize.addEventListener('change', handler);
  } else if (typeof anyLocalize.on === 'function') {
    anyLocalize.on('change', handler);
  }
} catch {
  // ignore
}

export default i18n;
