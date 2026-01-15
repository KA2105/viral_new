// src/store/useFeed.ts
import { create } from 'zustand';
import storage from '../storage';
import { INITIAL_FEED, type Post } from '../data/feed';

const STORAGE_KEY = 'feed_v1';

// ✅ Kalıcılık (BUG FIX): remote hydrate sonrası kaybolmasın diye
// beğeni / repost etkilerini ayrı saklıyoruz.
const STORAGE_LIKES_KEY = 'feed_v1_like_overrides';
const STORAGE_RESHARES_KEY = 'feed_v1_reshare_overrides';
const STORAGE_LOCAL_POSTS_KEY = 'feed_v1_local_posts';

// 🔌 Backend tabanı – şimdilik lokal
import { API_BASE_URL } from '../config/api';

// -------------------- Helpers --------------------

// ✅ Remote/DB tarafında shareTargets bazen:
// - array: ["Instagram","X"]
// - string JSON: '["Instagram","X"]'
// - string: '[]'
// - undefined / null
// Bu helper her durumda güvenli string[] döndürür.
function safeParseStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string');

  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.filter(x => typeof x === 'string');
    } catch {
      // JSON değilse (örn "Instagram,X") gibi saçma bir şey gelirse parçalamayı dene
      if (s.includes(',')) {
        return s
          .split(',')
          .map(x => x.trim())
          .filter(Boolean);
      }
    }
  }

  return [];
}

// Remote'dan gelen postları normalize ederken aynı helper'ı kullanacağız
const normalizePost = (raw: any): Post => ({
  ...raw,

  // ✅ DB (Int) -> RN (string) uyumu: karşılaştırmalar sağlam olsun
  id: raw?.id === undefined || raw?.id === null ? String(Date.now()) : String(raw.id),

  likes: typeof raw.likes === 'number' && Number.isFinite(raw.likes) ? raw.likes : 0,
  archived: !!raw.archived,
  lastSharedAt: typeof raw.lastSharedAt === 'number' && Number.isFinite(raw.lastSharedAt) ? raw.lastSharedAt : undefined,
  lastSharedTargets: Array.isArray(raw.lastSharedTargets) ? raw.lastSharedTargets : undefined,

  // ✅ CRASH FIX: shareTargets her zaman string[] olsun (join güvenli)
  shareTargets: safeParseStringArray((raw as any)?.shareTargets),

  videoUri: raw.videoUri === undefined || raw.videoUri === null ? null : raw.videoUri,
  time: typeof raw.time === 'string' && raw.time.trim().length > 0 ? raw.time : 'az önce',
  commentCount:
    typeof (raw as any).commentCount === 'number' && Number.isFinite((raw as any).commentCount)
      ? (raw as any).commentCount
      : 0,
  reshareCount:
    typeof (raw as any).reshareCount === 'number' && Number.isFinite((raw as any).reshareCount)
      ? (raw as any).reshareCount
      : 0,
  rootPostId: typeof (raw as any).rootPostId === 'string' ? (raw as any).rootPostId : undefined,
  repostOfId: typeof (raw as any).repostOfId === 'string' ? (raw as any).repostOfId : undefined,
  originalPostId: typeof (raw as any).originalPostId === 'string' ? (raw as any).originalPostId : undefined,

  // ✅ NEW: Avatar snapshot alanı (post'a bağlı kalsın)
  // Remote farklı isimle döndürürse de yakalayalım:
  authorAvatarUri:
    (raw as any)?.authorAvatarUri === undefined || (raw as any)?.authorAvatarUri === null
      ? (raw as any)?.avatarUri === undefined || (raw as any)?.avatarUri === null
        ? null
        : String((raw as any)?.avatarUri)
      : String((raw as any)?.authorAvatarUri),
});

// 🌐 Remote feed'i sessizce çekmeye çalışan helper.
// 404 veya hata durumunda NULL döner, app'i bozmadan devam eder.
async function tryRemoteFeed(): Promise<Post[] | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/feed`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      // 404 => endpoint henüz yok; sarı ekran istemiyoruz
      if (res.status === 404) {
        console.log('[Feed] remote endpoint yok (404), lokal feed kullanılıyor.');
        return null;
      }

      console.log('[Feed] remote hydrate non-200:', res.status, res.statusText);
      return null;
    }

    const json = await res.json();

    if (!Array.isArray(json)) {
      console.log('[Feed] remote hydrate: beklenmeyen cevap, dizi değil.');
      return null;
    }

    const normalized = json.map(normalizePost);
    console.log('[Feed] remote hydrate OK, kayıt sayısı:', normalized.length);
    return normalized;
  } catch (err) {
    // Burada da sadece log; hata fırlatıp sarı ekrana düşürmüyoruz
    console.log('[Feed] remote hydrate error:', err);
    return null;
  }
}

// ✅ Kalıcılık için override tipleri
type LikeOverrides = Record<string, number>; // postId -> likes
type ReshareOverrides = Record<string, number>; // postId -> reshareCount

function safeId(v: any): string {
  return v === undefined || v === null ? '' : String(v);
}

// ✅ Remote hydrate geldiğinde:
// - likes / reshareCount override uygula
// - local postları (repost vb.) listeye geri ekle
// - "replace + dedupe" mantığı: temel kaynak basePosts’tur, localPosts sadece base’de olmayanları ekler
function applyOverridesAndMerge(params: {
  basePosts: Post[];
  likeOverrides: LikeOverrides;
  reshareOverrides: ReshareOverrides;
  localPosts: Post[];
}): Post[] {
  const { basePosts, likeOverrides, reshareOverrides, localPosts } = params;

  const map = new Map<string, Post>();

  // 1) base posts (remote veya lokal kaynak)
  for (const p of basePosts) {
    const id = safeId((p as any).id);
    if (!id) continue;

    const next: any = { ...p, id };

    // ✅ likes override
    if (typeof likeOverrides[id] === 'number' && Number.isFinite(likeOverrides[id])) {
      next.likes = likeOverrides[id];
    }

    // ✅ reshareCount override
    if (typeof reshareOverrides[id] === 'number' && Number.isFinite(reshareOverrides[id])) {
      next.reshareCount = reshareOverrides[id];
    }

    map.set(id, next as Post);
  }

  // 2) local posts (repost vb.) base’de yoksa ekle
  // localPosts’u üstte göstermek istiyoruz => ayrıca diziye eklerken başa alacağız
  const localNormalized = (localPosts || []).map(normalizePost);
  for (const lp of localNormalized) {
    const id = safeId((lp as any).id);
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, lp);
    }
  }

  // 3) sıralama: local postlar en üstte; geri kalanı mevcut sırayı korusun
  const localIds = new Set(localNormalized.map(p => safeId((p as any).id)));

  const localsOnTop: Post[] = [];
  for (const lp of localNormalized) {
    const id = safeId((lp as any).id);
    const got = map.get(id);
    if (got) localsOnTop.push(got);
  }

  const rest: Post[] = [];
  for (const p of basePosts) {
    const id = safeId((p as any).id);
    if (!id) continue;
    if (localIds.has(id)) continue; // local olan zaten üstte
    const got = map.get(id);
    if (got) rest.push(got);
  }

  // basePosts’ta olmayan ama map’te olan (nadir) ekleri sona ekle
  if (rest.length + localsOnTop.length < map.size) {
    for (const [id, p] of map.entries()) {
      const already = localIds.has(id) || basePosts.some(bp => safeId((bp as any).id) === id);
      if (!already) rest.push(p);
    }
  }

  return [...localsOnTop, ...rest];
}

// ✅ Temp local id -> server id migrate helpers
function parseCreatedAtMs(p: any): number | null {
  if (typeof p?.clientCreatedAt === 'number' && Number.isFinite(p.clientCreatedAt)) {
    return p.clientCreatedAt;
  }
  if (typeof p?.createdAt === 'string') {
    const t = Date.parse(p.createdAt);
    return Number.isFinite(t) ? t : null;
  }
  // bazı backend’lerde createdAt Date objesi gelebilir:
  if (p?.createdAt instanceof Date) {
    const t = p.createdAt.getTime();
    return Number.isFinite(t) ? t : null;
  }
  // bazı backend’lerde createdAt number ms olabilir:
  if (typeof p?.createdAt === 'number' && Number.isFinite(p.createdAt)) {
    return p.createdAt;
  }
  // bazı backend’lerde time alanı string "az önce" vb. olur; onu kullanmıyoruz
  return null;
}

// ✅ İki post “aynı paylaşım” mı? (local temp -> remote gerçek eşleştirme için)
// Bu fonksiyon, boş başlık/not gibi durumlarda da (özellikle serbest video) güvenli eşleştirme yapmalı.
function looksSamePost(a: any, b: any): boolean {
  const aAuthor = String(a?.author ?? '').trim();
  const bAuthor = String(b?.author ?? '').trim();
  if (!aAuthor || !bAuthor) return false;
  if (aAuthor !== bAuthor) return false;

  const aVid = a?.videoUri ?? null;
  const bVid = b?.videoUri ?? null;

  // ✅ Video varsa: videoUri birebir eşleşiyorsa güçlü sinyal
  const hasVideoMatch = aVid && bVid && aVid === bVid;

  const aTitle = String(a?.title ?? a?.taskTitle ?? '').trim();
  const bTitle = String(b?.title ?? b?.taskTitle ?? '').trim();
  const aNote = String(a?.note ?? '').trim();
  const bNote = String(b?.note ?? '').trim();

  // zaman yakınlığı (±10 dk) — serbest paylaşımlarda title/note boş olabildiği için biraz geniş tuttuk
  const ta = parseCreatedAtMs(a);
  const tb = parseCreatedAtMs(b);
  const timeClose = ta && tb ? Math.abs(ta - tb) <= 10 * 60 * 1000 : true;

  // 1) Normal durum: title+note+video eşleşmesi
  if (aTitle && bTitle) {
    if (aTitle !== bTitle) return false;
    if (aNote !== bNote) return false;
    if ((aVid ?? null) !== (bVid ?? null)) return false;
    if (!timeClose) return false;
    return true;
  }

  // 2) ✅ Serbest video gibi: title boş olabilir → videoUri + author + time yakınlığı ile eşle
  if (hasVideoMatch) {
    if (!timeClose) return false;

    // note varsa da eşleştirmeyi güçlendirelim; yoksa takılma
    if (aNote && bNote && aNote !== bNote) return false;

    return true;
  }

  // 3) Video yoksa, ama title boşsa (zayıf sinyal) -> eşleştirmeyelim
  return false;
}

function migrateLocalIdsToRemote(params: {
  remotePosts: Post[];
  localPosts: Post[];
  likeOverrides: LikeOverrides;
  reshareOverrides: ReshareOverrides;
}): {
  localPosts: Post[];
  likeOverrides: LikeOverrides;
  reshareOverrides: ReshareOverrides;
} {
  const { remotePosts, localPosts, likeOverrides, reshareOverrides } = params;

  const nextLike = { ...likeOverrides };
  const nextReshare = { ...reshareOverrides };

  const remainingLocal: Post[] = [];

  for (const lp of localPosts || []) {
    const localId = String((lp as any)?.id ?? '');
    if (!localId) {
      remainingLocal.push(lp);
      continue;
    }

    // remote’da aynı post var mı?
    const match = remotePosts.find(rp => looksSamePost(lp as any, rp as any));
    if (match) {
      const remoteId = String((match as any)?.id ?? '');
      if (!remoteId) continue;

      // likes override taşınsın
      if (nextLike[localId] !== undefined && nextLike[remoteId] === undefined) {
        nextLike[remoteId] = nextLike[localId];
      }
      if (nextLike[localId] !== undefined) {
        delete nextLike[localId];
      }

      // reshare override taşınsın
      if (nextReshare[localId] !== undefined && nextReshare[remoteId] === undefined) {
        nextReshare[remoteId] = nextReshare[localId];
      }
      if (nextReshare[localId] !== undefined) {
        delete nextReshare[localId];
      }

      // ✅ local temp post’u artık tutma (sunucuda var)
      continue;
    }

    remainingLocal.push(lp);
  }

  return { localPosts: remainingLocal, likeOverrides: nextLike, reshareOverrides: nextReshare };
}

type FeedState = {
  posts: Post[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  likePost: (id: string) => void;
  clearAll: () => void;

  // Yükle ekranından GÖREV KARTI veya SERBEST PAYLAŞIM oluşturmak için
  addTaskCardFromTask: (params: {
    taskTitle: string;
    note: string;
    author: string;
    shareTargets: string[];
    videoUri?: string | null;
    isFreePost?: boolean;

    // ✅ NEW: post'a avatar snapshot koy
    authorAvatarUri?: string | null;
  }) => void;

  // Kart işlemleri
  removePost: (id: string) => void;
  archivePost: (id: string) => void;

  // Belirli bir görevden üretilen kartları topluca sil
  removeTaskCardsByTaskTitle: (taskTitle: string) => void;

  // Paylaşım sonrası işaretleme
  markPostShared: (id: string, targets: string[]) => void;

  // 🔁 Gönderiyi tekrar paylaş
  repostPost: (id: string) => void;
};

export const useFeed = create<FeedState>((set, get) => ({
  posts: [],
  hydrated: false,

  // Storage'dan ve (varsa) backend'den feed'i yükle
  // ✅ "replace + dedupe": remote varsa remote temel kaynak; localPosts sadece remote’da olmayanları ekler.
  hydrate: async () => {
    try {
      // 1) Lokal storage (eski)
      const saved = await storage.loadJson<Post[]>(STORAGE_KEY);

      // ✅ 1.1) Override storage (yeni)
      const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
      const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
      const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];

      // 2) Aynı anda remote'u yokla (endpoint hazırsa)
      const remote = await tryRemoteFeed();

      if (remote && remote.length > 0) {
        // Remote başarılıysa onu temel kaynak kabul ediyoruz (REPLACE)
        const normalizedRemote = remote.map(normalizePost);

        // ✅ NEW: local temp id -> server id migrate (likes/reshare + localPosts temizliği)
        // (özellikle serbest video: title boşsa bile videoUri+author+time ile eşleştir)
        const migrated = migrateLocalIdsToRemote({
          remotePosts: normalizedRemote,
          localPosts,
          likeOverrides,
          reshareOverrides,
        });

        // ✅ BUG FIX: beğeniler + repostlar refresh/app restart sonrası kaybolmasın
        // ✅ REPLACE + local ekleri sadece "remote'da olmayanlar" olarak ekle
        const merged = applyOverridesAndMerge({
          basePosts: normalizedRemote,
          likeOverrides: migrated.likeOverrides,
          reshareOverrides: migrated.reshareOverrides,
          localPosts: migrated.localPosts,
        });

        set({ posts: merged, hydrated: true });

        // ✅ merged’i yaz (eskisi gibi)
        storage.saveJson(STORAGE_KEY, merged);

        // ✅ migrate edilmiş override/localPosts’ları kaydet
        storage.saveJson(STORAGE_LIKES_KEY, migrated.likeOverrides);
        storage.saveJson(STORAGE_RESHARES_KEY, migrated.reshareOverrides);
        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, migrated.localPosts);

        return;
      }

      // Remote yoksa / boşsa: eskisi gibi lokal + INITIAL_FEED
      if (saved && Array.isArray(saved)) {
        const normalized = saved.map(normalizePost);

        const merged = applyOverridesAndMerge({
          basePosts: normalized,
          likeOverrides,
          reshareOverrides,
          localPosts,
        });

        set({ posts: merged, hydrated: true });
        storage.saveJson(STORAGE_KEY, merged);

        storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
        storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, localPosts);
      } else {
        const normalizedInitial = INITIAL_FEED.map(normalizePost);

        const merged = applyOverridesAndMerge({
          basePosts: normalizedInitial,
          likeOverrides,
          reshareOverrides,
          localPosts,
        });

        set({ posts: merged, hydrated: true });
        storage.saveJson(STORAGE_KEY, merged);

        storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
        storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, localPosts);
      }
    } catch (e) {
      console.log('[Feed] hydrate failed, INITIAL_FEED fallback:', e);

      // ✅ fallback’ta da override’ları yüklemeye çalışalım (sessiz)
      const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
      const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
      const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];

      const normalizedInitial = INITIAL_FEED.map(p => ({
        ...p,

        // ✅ fallback path: id her zaman string
        id: (p as any)?.id === undefined || (p as any)?.id === null ? String(Date.now()) : String((p as any).id),

        likes: typeof p.likes === 'number' && Number.isFinite(p.likes) ? p.likes : 0,
        archived: !!p.archived,
        lastSharedAt:
          typeof (p as any).lastSharedAt === 'number' && Number.isFinite((p as any).lastSharedAt)
            ? (p as any).lastSharedAt
            : undefined,
        lastSharedTargets: Array.isArray((p as any).lastSharedTargets) ? (p as any).lastSharedTargets : undefined,

        // ✅ CRASH FIX (fallback path): shareTargets her zaman array
        shareTargets: safeParseStringArray((p as any)?.shareTargets),

        videoUri: (p as any).videoUri === undefined || (p as any).videoUri === null ? null : (p as any).videoUri,
        time: typeof p.time === 'string' && p.time.trim().length > 0 ? p.time : 'az önce',
        commentCount:
          typeof (p as any).commentCount === 'number' && Number.isFinite((p as any).commentCount)
            ? (p as any).commentCount
            : 0,
        reshareCount:
          typeof (p as any).reshareCount === 'number' && Number.isFinite((p as any).reshareCount)
            ? (p as any).reshareCount
            : 0,
        rootPostId: typeof (p as any).rootPostId === 'string' ? (p as any).rootPostId : undefined,
        repostOfId: typeof (p as any).repostOfId === 'string' ? (p as any).repostOfId : undefined,
        originalPostId: typeof (p as any).originalPostId === 'string' ? (p as any).originalPostId : undefined,

        // ✅ NEW (fallback path): avatar snapshot
        authorAvatarUri:
          (p as any)?.authorAvatarUri === undefined || (p as any)?.authorAvatarUri === null
            ? (p as any)?.avatarUri === undefined || (p as any)?.avatarUri === null
              ? null
              : String((p as any)?.avatarUri)
            : String((p as any)?.authorAvatarUri),
      }));

      const merged = applyOverridesAndMerge({
        basePosts: (normalizedInitial as any) as Post[],
        likeOverrides,
        reshareOverrides,
        localPosts,
      });

      set({ posts: merged as any, hydrated: true });

      storage.saveJson(STORAGE_KEY, merged as any);
      storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
      storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
      storage.saveJson(STORAGE_LOCAL_POSTS_KEY, localPosts);
    }
  },

  likePost: (id: string) => {
    const pid = String(id);

    const prevPosts = get().posts;
    const hit = prevPosts.find(p => p.id === pid);

    // likes baz değeri
    const baseLikes = hit && typeof hit.likes === 'number' && Number.isFinite(hit.likes) ? hit.likes : 0;

    const nextLikes = baseLikes + 1;

    const next = prevPosts.map(p => (p.id === pid ? { ...p, likes: nextLikes } : p));

    set({ posts: next });

    // ✅ Eski davranış: feed’i kaydet
    storage.saveJson(STORAGE_KEY, next);

    // ✅ BUG FIX: beğeni override’ı ayrıca kaydet (remote hydrate gelince sıfırlanmasın)
    ;(async () => {
      try {
        const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
        likeOverrides[pid] = nextLikes;
        storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
      } catch (e) {
        console.log('[Feed] like override save failed:', e);
      }
    })();
  },

  clearAll: () => {
    set({ posts: [] });
    storage.saveJson(STORAGE_KEY, []);

    // ✅ override’ları da temizle
    storage.saveJson(STORAGE_LIKES_KEY, {});
    storage.saveJson(STORAGE_RESHARES_KEY, {});
    storage.saveJson(STORAGE_LOCAL_POSTS_KEY, []);
  },

  // 🔥 GÖREV KARTI / SERBEST PAYLAŞIM OLUŞTURMA
  addTaskCardFromTask: ({ taskTitle, note, author, shareTargets, videoUri, isFreePost, authorAvatarUri }) => {
    const isFree = !!isFreePost;

    // Başlık artık i18n tarafında hazırlanmış halde geliyor
    const title = (taskTitle || '').trim();

    const newPost = {
      id: String(Date.now()),
      clientCreatedAt: Date.now(), // ✅ NEW: temp->remote eşleştirme için
      title,
      body: '',
      note,

      // ✅ Burada zaten string[] geliyor ama yine de normalize edelim
      shareTargets: safeParseStringArray(shareTargets),

      author,

      // ✅ NEW: avatar snapshot (post'a bağlı)
      authorAvatarUri: authorAvatarUri ?? null,

      time: 'az önce',
      isTaskCard: !isFree,
      likes: 0,
      archived: false,
      lastSharedAt: undefined,
      lastSharedTargets: undefined,
      videoUri: videoUri ?? null,
      commentCount: 0,
      reshareCount: 0,
      rootPostId: undefined,
      repostOfId: undefined,
      originalPostId: undefined,
    } as any as Post;

    const next = [newPost, ...get().posts];
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    // ✅ BUG FIX: Bu da "local post" sayılır.
    // Remote hydrate / refresh sonrası kaybolmasın + repost’un üstüne çıkıp onu aşağı itsin.
    ;(async () => {
      try {
        const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];

        const normalizedNew = normalizePost(newPost as any);

        // aynı id varsa tekrar ekleme
        const exists = localPosts.some(p => String((p as any).id) === String((normalizedNew as any).id));

        const nextLocalPosts = exists ? localPosts : [normalizedNew, ...localPosts];

        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, nextLocalPosts);
      } catch (e) {
        console.log('[Feed] localPosts save (task/free) failed:', e);
      }
    })();
  },

  // Kart SIL
  removePost: (id: string) => {
    const pid = String(id);

    // ✅ UI'da anında kaldır (optimistic)
    const prev = get().posts;
    const next = prev.filter(p => p.id !== pid);
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    // ✅ localPosts/override’lardan da temizle (yenileyince geri gelmesin)
    ;(async () => {
      try {
        const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];
        const filteredLocal = localPosts.filter(p => String((p as any).id) !== pid);
        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, filteredLocal);

        const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
        if (likeOverrides[pid] !== undefined) {
          delete likeOverrides[pid];
          storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
        }

        const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
        if (reshareOverrides[pid] !== undefined) {
          delete reshareOverrides[pid];
          storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
        }
      } catch (e) {
        console.log('[Feed] local cleanup failed:', e);
      }
    })();

    // ✅ Remote da sil (yenileyince geri gelmesin)
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/feed/${encodeURIComponent(pid)}`, { method: 'DELETE' });

        if (!res.ok) {
          console.log('[Feed] remote delete non-200:', res.status, res.statusText);
          // İstersen rollback:
          // set({ posts: prev });
          // storage.saveJson(STORAGE_KEY, prev);
          return;
        }

        console.log('[Feed] remote delete OK:', pid);
      } catch (err) {
        console.log('[Feed] remote delete error:', err);
        // İstersen rollback:
        // set({ posts: prev });
        // storage.saveJson(STORAGE_KEY, prev);
      }
    })();
  },

  // Kart ARŞİVLE (listeden kaldır ama storage’da kalsın)
  archivePost: (id: string) => {
    const pid = String(id);
    const next = get().posts.map(p => (p.id === pid ? { ...p, archived: true } : p));
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);
  },

  // Belirli bir görevden üretilen kartları topluca sil
  removeTaskCardsByTaskTitle: (taskTitle: string) => {
    const needle = (taskTitle || '').trim();

    const next = get().posts.filter(p => {
      if (!p.isTaskCard) return true;

      const titleMatches = typeof p.title === 'string' && p.title.includes(needle);
      const noteMatches = typeof p.note === 'string' && p.note.includes(needle);

      return !(titleMatches || noteMatches);
    });

    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);
  },

  // Paylaşım yapıldı olarak işaretle
  markPostShared: (id: string, targets: string[]) => {
    const pid = String(id);
    const now = Date.now();

    // ✅ targets emniyetli olsun
    const safeTargets = safeParseStringArray(targets);

    const next = get().posts.map(p => (p.id === pid ? { ...p, lastSharedAt: now, lastSharedTargets: safeTargets } : p));
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);
  },

  // 🔁 Gönderiyi tekrar paylaş
  repostPost: (id: string) => {
    const pid = String(id);
    const { posts } = get();
    const original = posts.find(p => p.id === pid);
    if (!original) return;

    const base: any = original;
    const rootPostId: string = base.rootPostId || original.id;
    const now = Date.now();
    const clonedId = String(now);

    const updatedOriginal = {
      ...original,
      reshareCount: (base.reshareCount ?? 0) + 1,
      rootPostId,
      originalPostId: base.originalPostId || rootPostId,

      // ✅ authorAvatarUri korunur
      authorAvatarUri: (base as any)?.authorAvatarUri ?? null,
    } as any as Post;

    const cloned = {
      ...original,
      id: clonedId,
      clientCreatedAt: Date.now(), // ✅ NEW: temp->remote eşleştirme için
      time: 'az önce',
      reshareCount: 0,
      repostOfId: original.id,
      rootPostId,
      originalPostId: rootPostId,

      // ✅ NEW: authorAvatarUri snapshot clone'a da taşınır
      authorAvatarUri: (base as any)?.authorAvatarUri ?? null,
    } as any as Post;

    const next = [cloned, ...posts.map(p => (p.id === original.id ? updatedOriginal : p))];

    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    // ✅ BUG FIX: repost sonrası refresh/app restart ile kaybolmaması için localPosts + reshare override kaydet
    ;(async () => {
      try {
        // 1) cloned post’u localPosts’a yaz
        const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];
        const normalizedCloned = normalizePost(cloned as any);

        // aynı id varsa tekrar ekleme
        const exists = localPosts.some(p => String((p as any).id) === String((normalizedCloned as any).id));
        const nextLocalPosts = exists ? localPosts : [normalizedCloned, ...localPosts];

        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, nextLocalPosts);

        // 2) original’ın reshareCount artışını override olarak yaz
        const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
        reshareOverrides[String(original.id)] = Number((updatedOriginal as any).reshareCount) || 0;
        storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
      } catch (e) {
        console.log('[Feed] repost persistence failed:', e);
      }
    })();
  },
}));
