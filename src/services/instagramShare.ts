// src/services/instagramShare.ts
import { NativeModules, Platform, Share } from 'react-native';


export type InstagramSharePayload = {
  caption: string;          // Gönderi metni (başlık/açıklama)
  videoUri?: string | null; // Seçilen videonun URI'si (varsa)
  username: string;         // Viral içindeki kullanıcı adı
};

/**
 * NOT:
 *  - Şu an bu fonksiyon sadece backend'e istek atmak için.
 *  - Gerçek otomatik paylaşım için, bu URL'de çalışan bir sunucuya ihtiyacımız var.
 *  - Bir sonraki adımda Node/Express örnek backend kodunu yazacağız.
 */
const BACKEND_URL = 'http://192.168.1.103:4000/api/instagram/share';

export async function requestInstagramShare(
  payload: InstagramSharePayload,
): Promise<void> {
  try {
    // Backend'e POST isteği gönder
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(
        '[Instagram] share request failed with status:',
        res.status,
      );
      return;
    }

    console.log('[Instagram] share request sent successfully', payload);
  } catch (e) {
    console.warn('[Instagram] share request error:', e);
  }
}

// -----------------------------------------------------------------------------
// Android Instagram paylaşımı — Hikâye / Gönderi / Mesaj
// -----------------------------------------------------------------------------
export type InstagramShareMode = 'story' | 'feed' | 'direct';

type InstagramNativePayload = {
  mode: InstagramShareMode;
  title?: string;
  body?: string;
  link?: string;
  message?: string;
};

const getNativeInstagramShare = (): any => (NativeModules as any)?.InstagramShare;

export async function shareToInstagram(payload: InstagramNativePayload): Promise<void> {
  const mode = payload.mode;
  const title = String(payload.title ?? '').trim();
  const body = String(payload.body ?? '').trim();
  const link = String(payload.link ?? '').trim();
  const message = String(payload.message ?? '').trim();

  if (Platform.OS === 'android') {
    const nativeModule = getNativeInstagramShare();
    if (!nativeModule || typeof nativeModule.share !== 'function') {
      throw new Error('Instagram paylaşım modülü bulunamadı.');
    }

    await nativeModule.share(mode, title, body, link, message);
    return;
  }

  // iOS tarafında mevcut sistem paylaşım davranışını koru.
  const fallbackMessage = message || [title, body, link].filter(Boolean).join('\n\n');
  await Share.share({ message: fallbackMessage, ...(link ? { url: link } : {}) });
}
