// src/services/instagramShare.ts

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
