// src/data/feed.ts

export type Post = {
  id: string;
  title: string;          // Kart başlığı (Akış’ta büyük görünen)
  body: string;           // Gövde metni (Görev kartında "İçim")
  author: string;         // Arda, misafir vs.
  time: string;           // "az önce" vb.
  likes: number;          // 👍 sayısı
  isTaskCard?: boolean;   // Görev kartı ise true
  note?: string;          // "Açıklama: ..." kısmı
  shareTargets?: string[]; // Planlanan paylaşım: Facebook, Instagram...
  archived?: boolean;     // Arşivlenen kartlar listede gösterilmeyecek

  // Paylaşım geçmişi
  lastSharedAt?: number;
  lastSharedTargets?: string[];

  // 🔥 Yeni: video bilgisi (opsiyonel)
  videoUri?: string | null;
};

export const INITIAL_FEED: Post[] = [];
