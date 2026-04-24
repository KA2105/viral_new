// src/store/useFeed.ts
import { create } from 'zustand';
import storage from '../storage';
import { INITIAL_FEED, type Post } from '../data/feed';

// ✅ NEW: userId'yi direkt store'dan almak için (en sağlam yol)
import { useAuth } from './useAuth';

const STORAGE_KEY = 'feed_v1';

// ✅ Kalıcılık (BUG FIX): remote hydrate sonrası kaybolmasın diye
// beğeni / repost etkilerini ayrı saklıyoruz.
const STORAGE_LIKES_KEY = 'feed_v1_like_overrides';
const STORAGE_RESHARES_KEY = 'feed_v1_reshare_overrides';
const STORAGE_LOCAL_POSTS_KEY = 'feed_v1_local_posts';

// ✅ NEW: yorum sayısı override (remote hydrate sonrası kaybolmasın)
const STORAGE_COMMENTCOUNTS_KEY = 'feed_v1_comment_overrides';

// ✅ B: Çoklu like olmasın (tek like) — kalıcı
const STORAGE_LIKED_BY_ME_KEY = 'feed_v1_liked_by_me'; // postId -> true

// ✅ NEW: Remote'a gidemeyen işlemler kaybolmasın (diğer kullanıcılar görsün diye sonra retry)
const STORAGE_PENDING_ACTIONS_KEY = 'feed_v1_pending_actions';

// 🔌 Backend tabanı
import { API_BASE_URL } from '../config/api';

// ================================
// ✅ Remote auto-sync (diğer kullanıcıların ekranında güncellenmesi için)
// ================================
const REMOTE_SYNC_INTERVAL_MS = 9000;
let _remoteSyncTimer: any = null;
let _remoteSyncInFlight = false;
let _remoteSyncLastHash = '';

// -------------------- Helpers --------------------

function safeParseStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean);

  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean);
      }
    } catch {
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

function safeParseImageUris(v: any): string[] {
  return safeParseStringArray(v);
}

function normalizeUriArray(arr: any): string[] {
  return safeParseImageUris(arr)
    .map(x => String(x).trim())
    .filter(Boolean);
}

function isLocalOnlyUri(uri: any): boolean {
  const s = typeof uri === 'string' ? uri.trim() : '';
  if (!s) return false;

  return (
    s.startsWith('file://') ||
    s.startsWith('content://') ||
    s.includes('/storage/') ||
    s.includes('sdcard/') ||
    s.startsWith('/data/')
  );
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function withNoCache(url: string) {
  try {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
  } catch {
    return url;
  }
}

// ✅ SÜRÜM 2: Övgü alanlarını normalize et
function normalizePraiseFields(raw: any) {
  const postType = String(raw?.postType ?? '').trim();
  const isPraisePost =
    postType === 'praise' ||
    raw?.isPraisePost === true ||
    String(raw?.type ?? '').trim() === 'praise';

  if (!isPraisePost) {
    return {};
  }

  return {
    postType: 'praise',
    isPraisePost: true,
    praiseFriendName:
      raw?.praiseFriendName === undefined || raw?.praiseFriendName === null
        ? ''
        : String(raw.praiseFriendName).trim(),
    praiseCategoryId:
      raw?.praiseCategoryId === undefined || raw?.praiseCategoryId === null
        ? ''
        : String(raw.praiseCategoryId).trim(),
    praiseCategoryLabel:
      raw?.praiseCategoryLabel === undefined || raw?.praiseCategoryLabel === null
        ? ''
        : String(raw.praiseCategoryLabel).trim(),
    praiseCategoryEmoji:
      raw?.praiseCategoryEmoji === undefined || raw?.praiseCategoryEmoji === null
        ? ''
        : String(raw.praiseCategoryEmoji).trim(),
    praiseTaggedUserId:
      raw?.praiseTaggedUserId === undefined || raw?.praiseTaggedUserId === null
        ? null
        : String(raw.praiseTaggedUserId).trim(),
    praiseTaggedUserName:
      raw?.praiseTaggedUserName === undefined || raw?.praiseTaggedUserName === null
        ? ''
        : String(raw.praiseTaggedUserName).trim(),
    praiseTaggedUserHandle:
      raw?.praiseTaggedUserHandle === undefined || raw?.praiseTaggedUserHandle === null
        ? ''
        : String(raw.praiseTaggedUserHandle).trim(),
    praiseTaggedUserAvatarUri:
      raw?.praiseTaggedUserAvatarUri === undefined || raw?.praiseTaggedUserAvatarUri === null
        ? null
        : String(raw.praiseTaggedUserAvatarUri).trim(),
    praiseMessage:
      raw?.praiseMessage === undefined || raw?.praiseMessage === null
        ? String(raw?.note ?? '').trim()
        : String(raw.praiseMessage).trim(),
  };
}

const normalizePost = (raw: any): Post => {
  const rawLikes =
    (typeof raw?.likes === 'number' && Number.isFinite(raw.likes) ? raw.likes : null) ??
    (typeof raw?.likeCount === 'number' && Number.isFinite(raw.likeCount) ? raw.likeCount : null) ??
    (typeof raw?.likesCount === 'number' && Number.isFinite(raw.likesCount) ? raw.likesCount : null);

  const rawCommentCount =
    (typeof raw?.commentCount === 'number' && Number.isFinite(raw.commentCount) ? raw.commentCount : null) ??
    (typeof raw?.commentsCount === 'number' && Number.isFinite(raw.commentsCount) ? raw.commentsCount : null) ??
    (typeof raw?.comments === 'number' && Number.isFinite(raw.comments) ? raw.comments : null);

  return {
    ...raw,

    id: raw?.id === undefined || raw?.id === null ? String(Date.now()) : String(raw.id),

    likes: typeof rawLikes === 'number' ? rawLikes : 0,

    archived: !!raw.archived,
    lastSharedAt:
      typeof raw.lastSharedAt === 'number' && Number.isFinite(raw.lastSharedAt) ? raw.lastSharedAt : undefined,
    lastSharedTargets: Array.isArray(raw.lastSharedTargets) ? raw.lastSharedTargets : undefined,

    shareTargets: safeParseStringArray((raw as any)?.shareTargets),

    videoUri: raw.videoUri === undefined || raw.videoUri === null ? null : String(raw.videoUri),

    imageUris: safeParseImageUris((raw as any)?.imageUris),

    time:
      typeof raw.time === 'string' && raw.time.trim().length > 0
        ? raw.time
        : formatRelativeTimeTR(raw?.createdAt ?? raw?.clientCreatedAt ?? raw?.updatedAt ?? null),

    commentCount: typeof rawCommentCount === 'number' ? rawCommentCount : 0,

    reshareCount:
      typeof (raw as any).reshareCount === 'number' && Number.isFinite((raw as any).reshareCount)
        ? (raw as any).reshareCount
        : 0,
    rootPostId: typeof (raw as any).rootPostId === 'string' ? (raw as any).rootPostId : undefined,
    repostOfId: typeof (raw as any).repostOfId === 'string' ? (raw as any).repostOfId : undefined,
    originalPostId: typeof (raw as any).originalPostId === 'string' ? (raw as any).originalPostId : undefined,

    authorAvatarUri:
      (raw as any)?.authorAvatarUri === undefined || (raw as any)?.authorAvatarUri === null
        ? (raw as any)?.avatarUri === undefined || (raw as any)?.avatarUri === null
          ? null
          : String((raw as any)?.avatarUri)
        : String((raw as any)?.authorAvatarUri),

    ...normalizePraiseFields(raw),
  } as any as Post;
};

async function tryRemoteFeed(): Promise<Post[] | null> {
  try {
    const url = withNoCache(`${API_BASE_URL}/feed`);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        console.log('[Feed] remote endpoint yok (404), lokal feed kullanılıyor.');
        return null;
      }

      if (res.status === 304) {
        console.log('[Feed] remote hydrate 304 (NOT MODIFIED) -> json yok, null dönüyorum.');
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
    console.log('[Feed] remote hydrate error:', err);
    return null;
  }
}

type LikeOverrides = Record<string, number>;
type ReshareOverrides = Record<string, number>;
type CommentCountOverrides = Record<string, number>;
type LikedByMe = Record<string, true>;

function safeId(v: any): string {
  return v === undefined || v === null ? '' : String(v);
}

function applyOverridesAndMerge(params: {
  basePosts: Post[];
  likeOverrides: LikeOverrides;
  reshareOverrides: ReshareOverrides;
  commentOverrides: CommentCountOverrides;
  localPosts: Post[];
}): Post[] {
  const { basePosts, likeOverrides, reshareOverrides, commentOverrides, localPosts } = params;

  const map = new Map<string, Post>();

  for (const p of basePosts) {
    const id = safeId((p as any).id);
    if (!id) continue;

    const next: any = { ...p, id };

    if (typeof likeOverrides[id] === 'number' && Number.isFinite(likeOverrides[id])) {
      next.likes = likeOverrides[id];
    }

    if (typeof reshareOverrides[id] === 'number' && Number.isFinite(reshareOverrides[id])) {
      next.reshareCount = reshareOverrides[id];
    }

    if (typeof commentOverrides[id] === 'number' && Number.isFinite(commentOverrides[id])) {
      const remoteCount =
        typeof (next as any).commentCount === 'number' && Number.isFinite((next as any).commentCount)
          ? Number((next as any).commentCount)
          : 0;

      next.commentCount = Math.max(remoteCount, Number(commentOverrides[id]));
    }

    map.set(id, next as Post);
  }

  const localNormalized = (localPosts || []).map(normalizePost);

  for (const lp of localNormalized) {
    const id = safeId((lp as any).id);
    if (!id) continue;

    // ✅ FIX: Local-temp kart server'da artık varsa local kopyayı ekleme.
    const sameRemote = basePosts.some(bp => looksSamePost(lp as any, bp as any));
    if (sameRemote) continue;

    // ✅ FIX: Aynı içerik map içinde başka id ile varsa tekrar ekleme.
    const sameExisting = Array.from(map.values()).some(p => {
      const existingId = safeId((p as any).id);
      if (existingId && existingId === id) return false;
      return looksSamePost(p as any, lp as any);
    });
    if (sameExisting) continue;

    if (!map.has(id)) {
      map.set(id, lp);
    }
  }

  const localsOnTop: Post[] = [];
  const pushedLocalIds = new Set<string>();

  for (const lp of localNormalized) {
    const id = safeId((lp as any).id);
    if (!id) continue;
    if (pushedLocalIds.has(id)) continue;

    if (basePosts.some(bp => looksSamePost(lp as any, bp as any))) continue;

    const got = map.get(id);
    if (!got) continue;

    const alreadyPushed = localsOnTop.some(p => looksSamePost(p as any, got as any));
    if (alreadyPushed) continue;

    localsOnTop.push(got);
    pushedLocalIds.add(id);
  }

  const localIds = new Set(localNormalized.map(p => safeId((p as any).id)));

  const rest: Post[] = [];
  for (const p of basePosts) {
    const id = safeId((p as any).id);
    if (!id) continue;
    if (localIds.has(id)) continue;
    const got = map.get(id);
    if (got) rest.push(got);
  }

  if (rest.length + localsOnTop.length < map.size) {
    for (const [id, p] of map.entries()) {
      const already =
        pushedLocalIds.has(id) ||
        rest.some(x => safeId((x as any).id) === id) ||
        basePosts.some(bp => safeId((bp as any).id) === id) ||
        localsOnTop.some(x => looksSamePost(x as any, p as any));

      if (!already) rest.push(p);
    }
  }

  return [...localsOnTop, ...rest];
}

function formatRelativeTimeTR(input: any): string {
  let ts: number | null = null;

  if (typeof input === 'number' && Number.isFinite(input)) {
    ts = input;
  } else if (typeof input === 'string') {
    const p = Date.parse(input);
    ts = Number.isFinite(p) ? p : null;
  } else if (input instanceof Date) {
    const p = input.getTime();
    ts = Number.isFinite(p) ? p : null;
  }

  if (!ts) return 'az önce';

  const diffMs = Date.now() - ts;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) return 'az önce';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} dk önce`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} sa önce`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} gün önce`;

  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} hf önce`;

  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} ay önce`;

  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear} yıl önce`;
}

function parseCreatedAtMs(p: any): number | null {
  if (typeof p?.clientCreatedAt === 'number' && Number.isFinite(p.clientCreatedAt)) {
    return p.clientCreatedAt;
  }
  if (typeof p?.createdAt === 'string') {
    const t = Date.parse(p.createdAt);
    return Number.isFinite(t) ? t : null;
  }
  if (p?.createdAt instanceof Date) {
    const t = p.createdAt.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof p?.createdAt === 'number' && Number.isFinite(p.createdAt)) {
    return p.createdAt;
  }
  return null;
}

function looksSamePost(a: any, b: any): boolean {
  const normalizeCompareText = (v: any) =>
    String(v ?? '')
      .trim()
      .replace(/^@+/, '')
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('tr-TR');

  const aPraise = normalizePraiseFields(a) as any;
  const bPraise = normalizePraiseFields(b) as any;

  const aIsPraise = aPraise?.postType === 'praise';
  const bIsPraise = bPraise?.postType === 'praise';

  const ta = parseCreatedAtMs(a);
  const tb = parseCreatedAtMs(b);
  const timeClose = ta && tb ? Math.abs(ta - tb) <= 10 * 60 * 1000 : true;

  // ✅ SÜRÜM 2 FIX: Övgü postlarında local-temp ile remote eşleşsin, duplicate görünmesin.
  // Not: Local kart ile server kartında author bazen fullName/@handle farkıyla gelebiliyor.
  // Bu yüzden praise eşleşmesinde asıl belirleyici: arkadaş + mesaj + kategori + yakın zaman.
  if (aIsPraise || bIsPraise) {
    if (!aIsPraise || !bIsPraise) return false;
    if (!timeClose) return false;

    const aFriend = normalizeCompareText(aPraise?.praiseFriendName);
    const bFriend = normalizeCompareText(bPraise?.praiseFriendName);

    const aMsg = normalizeCompareText(aPraise?.praiseMessage ?? a?.note);
    const bMsg = normalizeCompareText(bPraise?.praiseMessage ?? b?.note);

    const aCat = normalizeCompareText(aPraise?.praiseCategoryId ?? aPraise?.praiseCategoryLabel);
    const bCat = normalizeCompareText(bPraise?.praiseCategoryId ?? bPraise?.praiseCategoryLabel);

    const aTaggedId = normalizeCompareText(aPraise?.praiseTaggedUserId);
    const bTaggedId = normalizeCompareText(bPraise?.praiseTaggedUserId);
    const aTaggedName = normalizeCompareText(aPraise?.praiseTaggedUserName);
    const bTaggedName = normalizeCompareText(bPraise?.praiseTaggedUserName);
    const aTaggedHandle = normalizeCompareText(aPraise?.praiseTaggedUserHandle);
    const bTaggedHandle = normalizeCompareText(bPraise?.praiseTaggedUserHandle);

    if (aTaggedId && bTaggedId && aTaggedId !== bTaggedId) return false;
    if (aTaggedName && bTaggedName && aTaggedName !== bTaggedName) return false;
    if (aTaggedHandle && bTaggedHandle && aTaggedHandle !== bTaggedHandle) return false;
    if (aFriend && bFriend && aFriend !== bFriend) return false;
    if (aMsg && bMsg && aMsg !== bMsg) return false;
    if (aCat && bCat && aCat !== bCat) return false;

    if (aFriend && bFriend && aMsg && bMsg) return true;
    if (aMsg && bMsg && aMsg === bMsg) return true;

    return false;
  }

  const aAuthor = String(a?.author ?? '').trim();
  const bAuthor = String(b?.author ?? '').trim();
  if (!aAuthor || !bAuthor) return false;
  if (aAuthor !== bAuthor) return false;

  const aVid = a?.videoUri ?? null;
  const bVid = b?.videoUri ?? null;

  const aVidStr = typeof aVid === 'string' ? aVid.trim() : '';
  const bVidStr = typeof bVid === 'string' ? bVid.trim() : '';

  const aIsLocalOnlyVideo = isLocalOnlyUri(aVidStr);
  const bIsLocalOnlyVideo = isLocalOnlyUri(bVidStr);

  const hasExactVideoMatch = !!aVidStr && !!bVidStr && aVidStr === bVidStr;

  const aImages = normalizeUriArray(a?.imageUris);
  const bImages = normalizeUriArray(b?.imageUris);

  const hasAnyImages = aImages.length > 0 || bImages.length > 0;
  const hasExactImagesMatch = aImages.length > 0 && bImages.length > 0 && sameStringArray(aImages, bImages);

  const aHasLocalOnlyImages = aImages.some(isLocalOnlyUri);
  const bHasLocalOnlyImages = bImages.some(isLocalOnlyUri);

  const aTitle = String(a?.title ?? a?.taskTitle ?? '').trim();
  const bTitle = String(b?.title ?? b?.taskTitle ?? '').trim();
  const aNote = String(a?.note ?? '').trim();
  const bNote = String(b?.note ?? '').trim();

  if (aTitle && bTitle) {
    if (aTitle !== bTitle) return false;
    if (aNote !== bNote) return false;
    if (!timeClose) return false;

    if (hasExactVideoMatch) return true;
    if (hasExactImagesMatch) return true;

    if ((aIsLocalOnlyVideo && !bIsLocalOnlyVideo) || (!aIsLocalOnlyVideo && bIsLocalOnlyVideo)) {
      return true;
    }

    if (hasAnyImages && ((aHasLocalOnlyImages && !bHasLocalOnlyImages) || (!aHasLocalOnlyImages && bHasLocalOnlyImages))) {
      return true;
    }

    if (!aVidStr && !bVidStr && aImages.length === 0 && bImages.length === 0) return true;

    return false;
  }

  if (hasExactVideoMatch || hasExactImagesMatch) {
    if (!timeClose) return false;
    if (aNote && bNote && aNote !== bNote) return false;
    return true;
  }

  if (aNote && bNote && aNote === bNote && timeClose) {
    if ((aIsLocalOnlyVideo && !bIsLocalOnlyVideo) || (!aIsLocalOnlyVideo && bIsLocalOnlyVideo)) {
      return true;
    }

    if (hasAnyImages && ((aHasLocalOnlyImages && !bHasLocalOnlyImages) || (!aHasLocalOnlyImages && bHasLocalOnlyImages))) {
      return true;
    }

    if (!aVidStr && !bVidStr && aImages.length === 0 && bImages.length === 0) {
      return true;
    }
  }

  const aContentCandidates = [aTitle, aNote, String(a?.body ?? '').trim()].filter(Boolean);
  const bContentCandidates = [bTitle, bNote, String(b?.body ?? '').trim()].filter(Boolean);

  const hasSameTextContent =
    aContentCandidates.length > 0 &&
    bContentCandidates.length > 0 &&
    aContentCandidates.some(x => bContentCandidates.includes(x));

  if (
    hasSameTextContent &&
    timeClose &&
    !aVidStr &&
    !bVidStr &&
    aImages.length === 0 &&
    bImages.length === 0
  ) {
    return true;
  }

  return false;
}

function migrateLocalIdsToRemote(params: {
  remotePosts: Post[];
  localPosts: Post[];
  likeOverrides: LikeOverrides;
  reshareOverrides: ReshareOverrides;
  commentOverrides: CommentCountOverrides;
  likedByMe: LikedByMe;
}): {
  localPosts: Post[];
  likeOverrides: LikeOverrides;
  reshareOverrides: ReshareOverrides;
  commentOverrides: CommentCountOverrides;
  likedByMe: LikedByMe;
  pendingLikePostIds: string[];
} {
  const { remotePosts, localPosts, likeOverrides, reshareOverrides, commentOverrides, likedByMe } = params;

  const pendingLikePostIds: string[] = [];

  const nextLike = { ...likeOverrides };
  const nextReshare = { ...reshareOverrides };
  const nextComment = { ...commentOverrides };
  const nextLiked = { ...likedByMe };

  const remainingLocal: Post[] = [];

  for (const lp of localPosts || []) {
    const localId = String((lp as any)?.id ?? '');
    if (!localId) {
      remainingLocal.push(lp);
      continue;
    }

    const match = remotePosts.find(rp => looksSamePost(lp as any, rp as any));
    if (match) {
      const remoteId = String((match as any)?.id ?? '');
      if (!remoteId) continue;

      if (nextLike[localId] !== undefined && nextLike[remoteId] === undefined) {
        nextLike[remoteId] = nextLike[localId];
      }
      if (nextLike[localId] !== undefined) {
        delete nextLike[localId];
      }

      if (nextReshare[localId] !== undefined && nextReshare[remoteId] === undefined) {
        nextReshare[remoteId] = nextReshare[localId];
      }
      if (nextReshare[localId] !== undefined) {
        delete nextReshare[localId];
      }

      if (nextComment[localId] !== undefined && nextComment[remoteId] === undefined) {
        nextComment[remoteId] = nextComment[localId];
      }
      if (nextComment[localId] !== undefined) {
        delete nextComment[localId];
      }

      if (nextLiked[localId] && !nextLiked[remoteId]) {
        nextLiked[remoteId] = true;
        if (isProbablyRemoteNumericId(remoteId)) {
          pendingLikePostIds.push(remoteId);
        }
      }
      if (nextLiked[localId]) {
        delete nextLiked[localId];
      }

      continue;
    }

    remainingLocal.push(lp);
  }

  return {
    localPosts: remainingLocal,
    likeOverrides: nextLike,
    reshareOverrides: nextReshare,
    commentOverrides: nextComment,
    likedByMe: nextLiked,
    pendingLikePostIds,
  };
}

function isProbablyRemoteNumericId(id: any): boolean {
  const s = String(id ?? '').trim();
  if (!s) return false;
  return /^\d+$/.test(s);
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

let _cachedAuthToken: string | null = null;
let _cachedAuthTokenAt = 0;

let _cachedAuthUserId: number | null = null;
let _cachedAuthUserIdAt = 0;

function pickTokenFromAnyShape(v: any): string | null {
  try {
    if (v && typeof v === 'object' && v.version === 2 && Array.isArray(v.accounts)) {
      const activeIdentifier =
        typeof v.activeIdentifier === 'string' ? v.activeIdentifier.trim().toLowerCase() : '';

      const activeAcc = activeIdentifier
        ? v.accounts.find((a: any) => String(a?.identifier ?? '').trim().toLowerCase() === activeIdentifier)
        : null;

      const t1 = activeAcc?.token;
      if (typeof t1 === 'string' && t1.trim().length) return t1.trim();

      const t2 = v.accounts?.[0]?.token;
      if (typeof t2 === 'string' && t2.trim().length) return t2.trim();
    }

    const candidates = [
      v?.token,
      v?.accessToken,
      v?.authToken,
      v?.data?.token,
      v?.data?.accessToken,
      v?.user?.token,
      v?.session?.token,
    ]
      .map((x: any) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);

    if (candidates.length) return candidates[0];
  } catch {}
  return null;
}

async function getAuthTokenFromStorage(): Promise<string | null> {
  try {
    const now = Date.now();
    if (_cachedAuthToken && now - _cachedAuthTokenAt < 5000) return _cachedAuthToken;

    const possibleKeys = ['auth_v2', 'auth_v1', 'auth', 'session_v1', 'session', 'token', 'auth_token'];

    for (const k of possibleKeys) {
      const obj = await storage.loadJson<any>(k);
      const t = pickTokenFromAnyShape(obj);
      if (t) {
        _cachedAuthToken = t;
        _cachedAuthTokenAt = now;
        return t;
      }
    }
  } catch (e) {
    console.log('[Feed][Remote] auth token load failed:', e);
  }
  return null;
}

function pickUserIdFromAnyShape(v: any): number | null {
  try {
    if (v && typeof v === 'object' && v.version === 2 && Array.isArray(v.accounts)) {
      const activeIdentifier =
        typeof v.activeIdentifier === 'string' ? v.activeIdentifier.trim().toLowerCase() : '';

      const activeAcc = activeIdentifier
        ? v.accounts.find((a: any) => String(a?.identifier ?? '').trim().toLowerCase() === activeIdentifier)
        : null;

      const candidatesV2 = [
        activeAcc?.backendUserId,
        activeAcc?.user?.id,
        v.accounts?.[0]?.backendUserId,
        v.accounts?.[0]?.user?.id,
      ];

      for (const c of candidatesV2) {
        const n = typeof c === 'string' ? Number(c.trim()) : typeof c === 'number' ? c : NaN;
        if (Number.isFinite(n) && n > 0) return n;
      }
    }

    const candidates = [
      v?.user?.id,
      v?.user?.userId,
      v?.backendUser?.id,
      v?.backendUserId,
      v?.id,
      v?.data?.user?.id,
      v?.data?.userId,
    ];

    for (const c of candidates) {
      const n = typeof c === 'string' ? Number(c.trim()) : typeof c === 'number' ? c : NaN;
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {}
  return null;
}

async function getAuthUserId(): Promise<number | null> {
  try {
    const now = Date.now();
    if (_cachedAuthUserId && now - _cachedAuthUserIdAt < 2000) return _cachedAuthUserId;

    try {
      const st: any = useAuth.getState?.() as any;

      const n1 = typeof st?.backendUserId === 'number' ? st.backendUserId : Number(st?.backendUserId);
      if (Number.isFinite(n1) && n1 > 0) {
        _cachedAuthUserId = n1;
        _cachedAuthUserIdAt = now;
        return n1;
      }

      const n2 = typeof st?.user?.id === 'number' ? st.user.id : Number(st?.user?.id);
      if (Number.isFinite(n2) && n2 > 0) {
        _cachedAuthUserId = n2;
        _cachedAuthUserIdAt = now;
        return n2;
      }
    } catch {}

    const possibleKeys = ['auth_v2', 'auth_v1', 'auth', 'session_v1', 'session', 'user', 'me'];
    for (const k of possibleKeys) {
      const obj = await storage.loadJson<any>(k);
      const id = pickUserIdFromAnyShape(obj);
      if (id) {
        _cachedAuthUserId = id;
        _cachedAuthUserIdAt = now;
        return id;
      }
    }
  } catch (e) {
    console.log('[Feed][Remote] auth userId load failed:', e);
  }
  return null;
}

async function tryRemoteAction(params: {
  path: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  label: string;
}): Promise<{ ok: boolean; status?: number; json?: any }> {
  const { path, method = 'POST', body, label } = params;

  try {
    const url = `${String(API_BASE_URL || '').replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

    console.log(`[Feed][Remote] ${label} ->`, method, url);

    const token = await getAuthTokenFromStorage();
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

    const uid = await getAuthUserId();
    const userIdHeader = uid ? { 'x-user-id': String(uid) } : {};

    let finalBody = body;

    if (finalBody === undefined && uid) {
      finalBody = { userId: uid };
    } else if (finalBody && typeof finalBody === 'object' && !Array.isArray(finalBody)) {
      if ((finalBody as any).userId === undefined && uid) {
        finalBody = { ...(finalBody as any), userId: uid };
      }
    }

    console.log('[Feed][Remote] uid:', uid, 'token?', !!token);

    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        ...authHeader,
        ...userIdHeader,
      },
      body: finalBody !== undefined ? JSON.stringify(finalBody) : undefined,
    });

    const json = await safeJson(res);

    if (!res.ok) {
      console.log(`[Feed][Remote] ${label} non-200:`, res.status, res.statusText, json);
      return { ok: false, status: res.status, json };
    }

    console.log(`[Feed][Remote] ${label} OK:`, res.status, json);
    return { ok: true, status: res.status, json };
  } catch (e) {
    console.log(`[Feed][Remote] ${label} error:`, e);
    return { ok: false };
  }
}

type PendingAction =
  | { type: 'like'; postId: string; ts: number }
  | { type: 'comment'; postId: string; ts: number; text: string; parentId?: string | null }
  | { type: 'repost'; postId: string; ts: number }
  | { type: 'archive'; postId: string; ts: number }
  | { type: 'markShared'; postId: string; ts: number; targets: string[]; lastSharedAt: number; lastSharedTargets: string[] }
  | { type: 'delete'; postId: string; ts: number };

async function loadPendingActions(): Promise<PendingAction[]> {
  const arr = (await storage.loadJson<PendingAction[]>(STORAGE_PENDING_ACTIONS_KEY)) || [];
  return Array.isArray(arr) ? arr.filter(x => x && typeof x === 'object') : [];
}

async function savePendingActions(actions: PendingAction[]) {
  try {
    const cleaned = Array.isArray(actions) ? actions.slice(0, 250) : [];
    await storage.saveJson(STORAGE_PENDING_ACTIONS_KEY, cleaned);
  } catch {}
}

async function enqueuePendingAction(a: PendingAction) {
  try {
    const prev = await loadPendingActions();

    if ((a as any).type === 'comment') {
      const pid = String((a as any).postId ?? '').trim();
      const text = String((a as any).text ?? '').trim();
      const parentId = (a as any).parentId ?? null;
      const now = Date.now();

      const exists = prev.some(x => {
        if ((x as any).type !== 'comment') return false;
        const xp = String((x as any).postId ?? '').trim();
        const xt = String((x as any).text ?? '').trim();
        const xpar = (x as any).parentId ?? null;
        const xts = typeof (x as any).ts === 'number' ? (x as any).ts : 0;

        if (!xp || !xt) return false;
        if (xp !== pid) return false;
        if (xt !== text) return false;
        if ((xpar ?? null) !== (parentId ?? null)) return false;

        return now - xts <= 60 * 1000;
      });

      if (exists) {
        console.log('[Feed][Pending] comment DUP SKIP (same within 60s):', pid);
        return;
      }

      const next = [a, ...prev].slice(0, 250);
      await savePendingActions(next);
      return;
    }

    const key = `${(a as any).type}:${(a as any).postId}`;
    const next = [a, ...prev.filter(x => `${(x as any).type}:${(x as any).postId}` !== key)];
    await savePendingActions(next);
  } catch {}
}

async function flushPendingActions(): Promise<void> {
  const pending = await loadPendingActions();
  if (!pending.length) return;

  const remaining: PendingAction[] = [];

  const commentOverrideIdsToClear = new Set<string>();

  for (const a of pending) {
    try {
      const pid = String((a as any).postId ?? '').trim();
      if (!pid) continue;

      if ((a as any).type !== 'delete' && !isProbablyRemoteNumericId(pid)) {
        continue;
      }

      if (a.type === 'like') {
        const r1 = await tryRemoteAction({
          label: 'like(pending)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/like`,
        });
        if (r1.ok) continue;

        const r2 = await tryRemoteAction({
          label: 'like(pending-fallback)',
          method: 'POST',
          path: `/posts/${encodeURIComponent(pid)}/like`,
        });
        if (r2.ok) continue;

        remaining.push(a);
        continue;
      }

      if (a.type === 'comment') {
        const text = String((a as any).text ?? '').trim();
        if (!text) continue;

        const parentId = (a as any).parentId ?? null;

        const r1 = await tryRemoteAction({
          label: 'comment(pending)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/comment`,
          body: { text, parentId },
        });
        if (r1.ok) {
          commentOverrideIdsToClear.add(pid);
          continue;
        }

        const r2 = await tryRemoteAction({
          label: 'comment(pending-fallback)',
          method: 'POST',
          path: `/posts/${encodeURIComponent(pid)}/comment`,
          body: { text, parentId },
        });
        if (r2.ok) {
          commentOverrideIdsToClear.add(pid);
          continue;
        }

        const r3 = await tryRemoteAction({
          label: 'comment(pending-fallback2)',
          method: 'POST',
          path: `/posts/${encodeURIComponent(pid)}/comments`,
          body: { text, parentId },
        });
        if (r3.ok) {
          commentOverrideIdsToClear.add(pid);
          continue;
        }

        remaining.push(a);
        continue;
      }

      if (a.type === 'repost') {
        const r1 = await tryRemoteAction({
          label: 'repost(pending)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/repost`,
        });
        if (r1.ok) continue;

        const r2 = await tryRemoteAction({
          label: 'repost(pending-fallback)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/reshare`,
        });
        if (r2.ok) continue;

        remaining.push(a);
        continue;
      }

      if (a.type === 'archive') {
        const r1 = await tryRemoteAction({
          label: 'archive(pending)',
          method: 'PATCH',
          path: `/feed/${encodeURIComponent(pid)}/archive`,
          body: { archived: true },
        });
        if (r1.ok) continue;

        const r2 = await tryRemoteAction({
          label: 'archive(pending-fallback)',
          method: 'PATCH',
          path: `/feed/${encodeURIComponent(pid)}`,
          body: { archived: true },
        });
        if (r2.ok) continue;

        remaining.push(a);
        continue;
      }

      if (a.type === 'markShared') {
        const now = (a as any).lastSharedAt ?? Date.now();
        const targets = safeParseStringArray((a as any).targets ?? (a as any).lastSharedTargets ?? []);

        const r1 = await tryRemoteAction({
          label: 'markShared(pending)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/shared`,
          body: { targets, ts: now },
        });
        if (r1.ok) continue;

        const r2 = await tryRemoteAction({
          label: 'markShared(pending-fallback)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/share`,
          body: { targets, ts: now },
        });
        if (r2.ok) continue;

        const r3 = await tryRemoteAction({
          label: 'markShared(pending-fallback2)',
          method: 'PATCH',
          path: `/feed/${encodeURIComponent(pid)}`,
          body: { lastSharedAt: now, lastSharedTargets: targets },
        });
        if (r3.ok) continue;

        remaining.push(a);
        continue;
      }

      if (a.type === 'delete') {
        try {
          const res = await fetch(withNoCache(`${API_BASE_URL}/feed/${encodeURIComponent(pid)}`), { method: 'DELETE' });
          if (res.ok) continue;
          remaining.push(a);
        } catch {
          remaining.push(a);
        }
      }
    } catch {
      remaining.push(a);
    }
  }

  if (commentOverrideIdsToClear.size > 0) {
    try {
      const overrides =
        ((await storage.loadJson<Record<string, number>>(STORAGE_COMMENTCOUNTS_KEY)) || {}) as Record<string, number>;

      let changed = false;
      for (const id of commentOverrideIdsToClear) {
        if (overrides[id] !== undefined) {
          delete overrides[id];
          changed = true;
        }
      }

      if (changed) {
        await storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, overrides);
      }
    } catch (e) {
      console.log('[Feed][Pending] comment override clear failed:', e);
    }
  }

  await savePendingActions(remaining);
}

function buildPostsHash(posts: Post[]): string {
  try {
    const parts = (Array.isArray(posts) ? posts : [])
      .slice(0, 500)
      .map(p => {
        const anyP: any = p as any;
        return [
          String(anyP?.id ?? ''),
          String(anyP?.postType ?? ''),
          String(anyP?.praiseFriendName ?? ''),
          String(anyP?.praiseCategoryId ?? ''),
          String(anyP?.praiseMessage ?? ''),
          Number(anyP?.likes ?? 0),
          Number(anyP?.commentCount ?? 0),
          Number(anyP?.reshareCount ?? 0),
          anyP?.archived ? 1 : 0,
          Number(anyP?.lastSharedAt ?? 0),
          String(anyP?.videoUri ?? ''),
          normalizeUriArray(anyP?.imageUris).join(','),
        ].join(':');
      });
    return parts.join('|');
  } catch {
    return String(Date.now());
  }
}

async function performRemoteSync(set: any, get: any) {
  if (_remoteSyncInFlight) return;
  _remoteSyncInFlight = true;

  try {
    await flushPendingActions();

    const remote = await tryRemoteFeed();
    if (!remote || remote.length === 0) return;

    const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
    const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
    const commentOverrides = (await storage.loadJson<CommentCountOverrides>(STORAGE_COMMENTCOUNTS_KEY)) || {};
    const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];
    const likedByMe = (await storage.loadJson<LikedByMe>(STORAGE_LIKED_BY_ME_KEY)) || {};

    const normalizedRemote = remote.map(normalizePost);

    const migrated = migrateLocalIdsToRemote({
      remotePosts: normalizedRemote,
      localPosts,
      likeOverrides,
      reshareOverrides,
      commentOverrides,
      likedByMe,
    });

    const merged = applyOverridesAndMerge({
      basePosts: normalizedRemote,
      likeOverrides: migrated.likeOverrides,
      reshareOverrides: migrated.reshareOverrides,
      commentOverrides: migrated.commentOverrides,
      localPosts: migrated.localPosts,
    });

    const nextHash = buildPostsHash(merged);
    if (nextHash === _remoteSyncLastHash) return;

    _remoteSyncLastHash = nextHash;

    set({ posts: merged, hydrated: true });
    storage.saveJson(STORAGE_KEY, merged);

    storage.saveJson(STORAGE_LIKES_KEY, migrated.likeOverrides);
    storage.saveJson(STORAGE_RESHARES_KEY, migrated.reshareOverrides);
    storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, migrated.commentOverrides);
    storage.saveJson(STORAGE_LOCAL_POSTS_KEY, migrated.localPosts);
    storage.saveJson(STORAGE_LIKED_BY_ME_KEY, migrated.likedByMe);

    if (Array.isArray(migrated.pendingLikePostIds) && migrated.pendingLikePostIds.length > 0) {
      migrated.pendingLikePostIds.forEach(postId => {
        enqueuePendingAction({ type: 'like', postId, ts: Date.now() });
      });
    }
  } catch (e) {
    console.log('[Feed] remote sync error:', e);
  } finally {
    _remoteSyncInFlight = false;
  }
}

function startRemoteAutoSync(set: any, get: any) {
  if (_remoteSyncTimer) return;

  try {
    const cur = get()?.posts;
    _remoteSyncLastHash = buildPostsHash(Array.isArray(cur) ? cur : []);
  } catch {}

  _remoteSyncTimer = setInterval(() => {
    performRemoteSync(set, get);
  }, REMOTE_SYNC_INTERVAL_MS);

  performRemoteSync(set, get);
}

function stopRemoteAutoSync() {
  try {
    if (_remoteSyncTimer) clearInterval(_remoteSyncTimer);
  } catch {}
  _remoteSyncTimer = null;
  _remoteSyncInFlight = false;
}

type AddTaskCardParams = {
  taskTitle: string;
  note: string;
  author: string;
  shareTargets: string[];
  videoUri?: string | null;
  imageUris?: string[];
  isFreePost?: boolean;
  authorAvatarUri?: string | null;

  // ✅ SÜRÜM 2: Övgü Paylaşımı alanları
  postType?: string;
  isPraisePost?: boolean;
  praiseFriendName?: string;
  praiseCategoryId?: string;
  praiseCategoryLabel?: string;
  praiseCategoryEmoji?: string;
  praiseTaggedUserId?: string | number | null;
  praiseTaggedUserName?: string;
  praiseTaggedUserHandle?: string;
  praiseTaggedUserAvatarUri?: string | null;
  praiseMessage?: string;
};

type FeedState = {
  posts: Post[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  likePost: (id: string) => void;

  addCommentToPost: (params: { postId: string; text: string; parentId?: string | null }) => void;

  clearAll: () => void;

  addTaskCardFromTask: (params: AddTaskCardParams) => void;

  removePost: (id: string) => void;
  archivePost: (id: string) => void;

  removeTaskCardsByTaskTitle: (taskTitle: string) => void;

  markPostShared: (id: string, targets: string[]) => void;

  repostPost: (id: string) => void;
};

export const useFeed = create<FeedState>((set, get) => ({
  posts: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const saved = await storage.loadJson<Post[]>(STORAGE_KEY);

      const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
      const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
      const commentOverrides = (await storage.loadJson<CommentCountOverrides>(STORAGE_COMMENTCOUNTS_KEY)) || {};
      const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];

      const likedByMe = (await storage.loadJson<LikedByMe>(STORAGE_LIKED_BY_ME_KEY)) || {};

      const remote = await tryRemoteFeed();

      if (remote && remote.length > 0) {
        const normalizedRemote = remote.map(normalizePost);

        const migrated = migrateLocalIdsToRemote({
          remotePosts: normalizedRemote,
          localPosts,
          likeOverrides,
          reshareOverrides,
          commentOverrides,
          likedByMe,
        });

        const merged = applyOverridesAndMerge({
          basePosts: normalizedRemote,
          likeOverrides: migrated.likeOverrides,
          reshareOverrides: migrated.reshareOverrides,
          commentOverrides: migrated.commentOverrides,
          localPosts: migrated.localPosts,
        });

        set({ posts: merged, hydrated: true });

        storage.saveJson(STORAGE_KEY, merged);

        storage.saveJson(STORAGE_LIKES_KEY, migrated.likeOverrides);
        storage.saveJson(STORAGE_RESHARES_KEY, migrated.reshareOverrides);
        storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, migrated.commentOverrides);
        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, migrated.localPosts);

        storage.saveJson(STORAGE_LIKED_BY_ME_KEY, migrated.likedByMe);

    if (Array.isArray(migrated.pendingLikePostIds) && migrated.pendingLikePostIds.length > 0) {
      migrated.pendingLikePostIds.forEach(postId => {
        enqueuePendingAction({ type: 'like', postId, ts: Date.now() });
      });
    }

        startRemoteAutoSync(set, get);

        return;
      }

      if (saved && Array.isArray(saved)) {
        const normalized = saved.map(normalizePost);

        const merged = applyOverridesAndMerge({
          basePosts: normalized,
          likeOverrides,
          reshareOverrides,
          commentOverrides,
          localPosts,
        });

        set({ posts: merged, hydrated: true });
        storage.saveJson(STORAGE_KEY, merged);

        storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
        storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
        storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, commentOverrides);
        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, localPosts);

        storage.saveJson(STORAGE_LIKED_BY_ME_KEY, likedByMe);

        startRemoteAutoSync(set, get);
      } else {
        const normalizedInitial = INITIAL_FEED.map(normalizePost);

        const merged = applyOverridesAndMerge({
          basePosts: normalizedInitial,
          likeOverrides,
          reshareOverrides,
          commentOverrides,
          localPosts,
        });

        set({ posts: merged, hydrated: true });
        storage.saveJson(STORAGE_KEY, merged);

        storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
        storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
        storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, commentOverrides);
        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, localPosts);

        storage.saveJson(STORAGE_LIKED_BY_ME_KEY, likedByMe);

        startRemoteAutoSync(set, get);
      }
    } catch (e) {
      console.log('[Feed] hydrate failed, INITIAL_FEED fallback:', e);

      const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
      const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
      const commentOverrides = (await storage.loadJson<CommentCountOverrides>(STORAGE_COMMENTCOUNTS_KEY)) || {};
      const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];
      const likedByMe = (await storage.loadJson<LikedByMe>(STORAGE_LIKED_BY_ME_KEY)) || {};

      const normalizedInitial = INITIAL_FEED.map(normalizePost);

      const merged = applyOverridesAndMerge({
        basePosts: (normalizedInitial as any) as Post[],
        likeOverrides,
        reshareOverrides,
        commentOverrides,
        localPosts,
      });

      set({ posts: merged as any, hydrated: true });

      storage.saveJson(STORAGE_KEY, merged as any);
      storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
      storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
      storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, commentOverrides);
      storage.saveJson(STORAGE_LOCAL_POSTS_KEY, localPosts);
      storage.saveJson(STORAGE_LIKED_BY_ME_KEY, likedByMe);

      startRemoteAutoSync(set, get);
    }
  },

  likePost: (id: string) => {
    const pid = String(id);

    (async () => {
      try {
        const likedByMe = (await storage.loadJson<LikedByMe>(STORAGE_LIKED_BY_ME_KEY)) || {};
        if (likedByMe[pid]) {
          console.log('[Feed] like SKIP (already liked):', pid);
          return;
        }

        const prevPosts = get().posts;
        const hit = prevPosts.find(p => p.id === pid);

        const baseLikes = hit && typeof hit.likes === 'number' && Number.isFinite(hit.likes) ? hit.likes : 0;
        const nextLikes = baseLikes + 1;

        const next = prevPosts.map(p => (p.id === pid ? { ...p, likes: nextLikes } : p));
        set({ posts: next });

        storage.saveJson(STORAGE_KEY, next);

        try {
          const likeOverrides = (await storage.loadJson<LikeOverrides>(STORAGE_LIKES_KEY)) || {};
          likeOverrides[pid] = nextLikes;
          storage.saveJson(STORAGE_LIKES_KEY, likeOverrides);
        } catch (e) {
          console.log('[Feed] like override save failed:', e);
        }

        likedByMe[pid] = true;
        storage.saveJson(STORAGE_LIKED_BY_ME_KEY, likedByMe);

        try {
          if (!isProbablyRemoteNumericId(pid)) {
            console.log('[Feed][Remote] like SKIP (local/temp id):', pid);
            return;
          }

          const r1 = await tryRemoteAction({ label: 'like', method: 'POST', path: `/feed/${encodeURIComponent(pid)}/like` });
          if (r1.ok) {
            performRemoteSync(set, get);
            return;
          }

          const r2 = await tryRemoteAction({ label: 'like(fallback)', method: 'POST', path: `/posts/${encodeURIComponent(pid)}/like` });
          if (r2.ok) {
            performRemoteSync(set, get);
            return;
          }

          await enqueuePendingAction({ type: 'like', postId: pid, ts: Date.now() });
        } catch (e) {
          console.log('[Feed] remote like error:', e);
          await enqueuePendingAction({ type: 'like', postId: pid, ts: Date.now() });
        }
      } catch (e) {
        console.log('[Feed] likedByMe load failed:', e);
      }
    })();
  },

  addCommentToPost: (params: { postId: string; text: string; parentId?: string | null }) => {
    const pid = String(params?.postId ?? '').trim();
    const text = String(params?.text ?? '').trim();
    const parentId = params?.parentId ?? null;

    if (!pid || !text) return;

    try {
      const prev = get().posts;
      const hit = prev.find(p => String(p.id) === pid);
      const baseCount =
        hit && typeof (hit as any).commentCount === 'number' && Number.isFinite((hit as any).commentCount)
          ? (hit as any).commentCount
          : 0;
      const nextCount = baseCount + 1;

      const next = prev.map(p => (String(p.id) === pid ? { ...p, commentCount: nextCount } : p));
      set({ posts: next });
      storage.saveJson(STORAGE_KEY, next);

      (async () => {
        try {
          const commentOverrides = (await storage.loadJson<CommentCountOverrides>(STORAGE_COMMENTCOUNTS_KEY)) || {};
          commentOverrides[pid] = nextCount;
          storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, commentOverrides);
        } catch {}
      })();
    } catch {}

    (async () => {
      try {
        if (!isProbablyRemoteNumericId(pid)) {
          console.log('[Feed][Remote] comment SKIP (local/temp id):', pid);
          return;
        }

        const body = { text, parentId };

        const r1 = await tryRemoteAction({
          label: 'comment',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/comment`,
          body,
        });
        if (r1.ok) {
          performRemoteSync(set, get);
          return;
        }

        const r2 = await tryRemoteAction({
          label: 'comment(fallback)',
          method: 'POST',
          path: `/posts/${encodeURIComponent(pid)}/comment`,
          body,
        });
        if (r2.ok) {
          performRemoteSync(set, get);
          return;
        }

        const r3 = await tryRemoteAction({
          label: 'comment(fallback2)',
          method: 'POST',
          path: `/posts/${encodeURIComponent(pid)}/comments`,
          body,
        });
        if (r3.ok) {
          performRemoteSync(set, get);
          return;
        }

        await enqueuePendingAction({ type: 'comment', postId: pid, ts: Date.now(), text, parentId });
      } catch (e) {
        console.log('[Feed] remote comment error:', e);
        await enqueuePendingAction({ type: 'comment', postId: pid, ts: Date.now(), text, parentId });
      }
    })();
  },

  clearAll: () => {
    set({ posts: [] });
    storage.saveJson(STORAGE_KEY, []);

    storage.saveJson(STORAGE_LIKES_KEY, {});
    storage.saveJson(STORAGE_RESHARES_KEY, {});
    storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, {});
    storage.saveJson(STORAGE_LOCAL_POSTS_KEY, []);

    storage.saveJson(STORAGE_LIKED_BY_ME_KEY, {});
    storage.saveJson(STORAGE_PENDING_ACTIONS_KEY, []);

    stopRemoteAutoSync();
  },

  addTaskCardFromTask: params => {
    const {
      taskTitle,
      note,
      author,
      shareTargets,
      videoUri,
      imageUris,
      isFreePost,
      authorAvatarUri,
      ...extra
    } = params;

    const isFree = !!isFreePost;
    const title = (taskTitle || '').trim();

    const praiseFields = normalizePraiseFields({
      ...extra,
      note,
    });

    const newPost = {
      id: String(Date.now()),
      clientCreatedAt: Date.now(),
      title,
      body: '',
      note,

      shareTargets: safeParseStringArray(shareTargets),

      author,

      authorAvatarUri: authorAvatarUri ?? null,

      time: 'az önce',
      isTaskCard: !isFree && (praiseFields as any).postType !== 'praise',
      likes: 0,
      archived: false,
      lastSharedAt: undefined,
      lastSharedTargets: undefined,
      videoUri: videoUri ?? null,
      imageUris: normalizeUriArray(imageUris),
      commentCount: 0,
      reshareCount: 0,
      rootPostId: undefined,
      repostOfId: undefined,
      originalPostId: undefined,

      ...praiseFields,
    } as any as Post;

    const normalizedNewPost = normalizePost(newPost as any);

    const currentPosts = get().posts || [];
    const withoutDuplicate = currentPosts.filter(p => {
      const sameId = String((p as any)?.id ?? '') === String((normalizedNewPost as any)?.id ?? '');
      if (sameId) return false;
      return !looksSamePost(p as any, normalizedNewPost as any);
    });

    const next = [normalizedNewPost, ...withoutDuplicate];
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    (async () => {
      try {
        const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];

        const cleanedLocalPosts = localPosts.filter(p => {
          const sameId = String((p as any).id) === String((normalizedNewPost as any).id);
          if (sameId) return false;
          return !looksSamePost(p as any, normalizedNewPost as any);
        });

        const nextLocalPosts = [normalizedNewPost, ...cleanedLocalPosts];

        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, nextLocalPosts);
      } catch (e) {
        console.log('[Feed] localPosts save (task/free/praise) failed:', e);
      }
    })();
  },

  removePost: (id: string) => {
    const pid = String(id);

    const prev = get().posts;
    const next = prev.filter(p => p.id !== pid);
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    (async () => {
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

        const commentOverrides =
          (await storage.loadJson<CommentCountOverrides>(STORAGE_COMMENTCOUNTS_KEY)) || {};
        if (commentOverrides[pid] !== undefined) {
          delete commentOverrides[pid];
          storage.saveJson(STORAGE_COMMENTCOUNTS_KEY, commentOverrides);
        }

        const likedByMe = (await storage.loadJson<LikedByMe>(STORAGE_LIKED_BY_ME_KEY)) || {};
        if (likedByMe[pid]) {
          delete likedByMe[pid];
          storage.saveJson(STORAGE_LIKED_BY_ME_KEY, likedByMe);
        }
      } catch (e) {
        console.log('[Feed] local cleanup failed:', e);
      }
    })();

    (async () => {
      try {
        if (!isProbablyRemoteNumericId(pid)) {
          console.log('[Feed][Remote] delete SKIP (local/temp id):', pid);
          return;
        }

        const r1 = await tryRemoteAction({
          label: 'delete',
          method: 'DELETE',
          path: `/feed/${encodeURIComponent(pid)}`,
        });

        if (r1.ok) {
          console.log('[Feed] remote delete OK:', pid);
          performRemoteSync(set, get);
          return;
        }

        console.log('[Feed] remote delete non-200');
        await enqueuePendingAction({ type: 'delete', postId: pid, ts: Date.now() });
      } catch (err) {
        console.log('[Feed] remote delete error:', err);
        await enqueuePendingAction({ type: 'delete', postId: pid, ts: Date.now() });
      }
    })();
  },

  archivePost: (id: string) => {
    const pid = String(id);
    const next = get().posts.map(p => (p.id === pid ? { ...p, archived: true } : p));
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    (async () => {
      try {
        if (!isProbablyRemoteNumericId(pid)) {
          console.log('[Feed][Remote] archive SKIP (local/temp id):', pid);
          return;
        }

        const r1 = await tryRemoteAction({
          label: 'archive',
          method: 'PATCH',
          path: `/feed/${encodeURIComponent(pid)}/archive`,
          body: { archived: true },
        });
        if (r1.ok) {
          performRemoteSync(set, get);
          return;
        }

        const r2 = await tryRemoteAction({
          label: 'archive(fallback)',
          method: 'PATCH',
          path: `/feed/${encodeURIComponent(pid)}`,
          body: { archived: true },
        });
        if (r2.ok) {
          performRemoteSync(set, get);
          return;
        }

        await enqueuePendingAction({ type: 'archive', postId: pid, ts: Date.now() });
      } catch (e) {
        console.log('[Feed] remote archive error:', e);
        await enqueuePendingAction({ type: 'archive', postId: pid, ts: Date.now() });
      }
    })();
  },

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

  markPostShared: (id: string, targets: string[]) => {
    const pid = String(id);
    const now = Date.now();

    const safeTargets = safeParseStringArray(targets);

    const next = get().posts.map(p => (p.id === pid ? { ...p, lastSharedAt: now, lastSharedTargets: safeTargets } : p));
    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    (async () => {
      try {
        if (!isProbablyRemoteNumericId(pid)) {
          console.log('[Feed][Remote] markShared SKIP (local/temp id):', pid);
          return;
        }

        const r1 = await tryRemoteAction({
          label: 'markShared',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/shared`,
          body: { targets: safeTargets, ts: now },
        });
        if (r1.ok) {
          performRemoteSync(set, get);
          return;
        }

        const r2 = await tryRemoteAction({
          label: 'markShared(fallback)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(pid)}/share`,
          body: { targets: safeTargets, ts: now },
        });
        if (r2.ok) {
          performRemoteSync(set, get);
          return;
        }

        const r3 = await tryRemoteAction({
          label: 'markShared(fallback2)',
          method: 'PATCH',
          path: `/feed/${encodeURIComponent(pid)}`,
          body: { lastSharedAt: now, lastSharedTargets: safeTargets },
        });
        if (r3.ok) {
          performRemoteSync(set, get);
          return;
        }

        await enqueuePendingAction({
          type: 'markShared',
          postId: pid,
          ts: Date.now(),
          targets: safeTargets,
          lastSharedAt: now,
          lastSharedTargets: safeTargets,
        });
      } catch (e) {
        console.log('[Feed] remote markShared error:', e);
        await enqueuePendingAction({
          type: 'markShared',
          postId: pid,
          ts: Date.now(),
          targets: safeTargets,
          lastSharedAt: now,
          lastSharedTargets: safeTargets,
        });
      }
    })();
  },

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
      authorAvatarUri: (base as any)?.authorAvatarUri ?? null,
      imageUris: normalizeUriArray((base as any)?.imageUris),
    } as any as Post;

    const cloned = normalizePost({
      ...original,
      id: clonedId,
      clientCreatedAt: Date.now(),
      time: 'az önce',
      reshareCount: 0,
      repostOfId: original.id,
      rootPostId,
      originalPostId: rootPostId,
      authorAvatarUri: (base as any)?.authorAvatarUri ?? null,
      imageUris: normalizeUriArray((base as any)?.imageUris),
    } as any) as any as Post;

    const next = [cloned, ...posts.map(p => (p.id === original.id ? updatedOriginal : p))];

    set({ posts: next });
    storage.saveJson(STORAGE_KEY, next);

    (async () => {
      try {
        const localPosts = (await storage.loadJson<Post[]>(STORAGE_LOCAL_POSTS_KEY)) || [];
        const normalizedCloned = normalizePost(cloned as any);

        const exists = localPosts.some(p => String((p as any).id) === String((normalizedCloned as any).id));
        const nextLocalPosts = exists ? localPosts : [normalizedCloned, ...localPosts];

        storage.saveJson(STORAGE_LOCAL_POSTS_KEY, nextLocalPosts);

        const reshareOverrides = (await storage.loadJson<ReshareOverrides>(STORAGE_RESHARES_KEY)) || {};
        reshareOverrides[String(original.id)] = Number((updatedOriginal as any).reshareCount) || 0;
        storage.saveJson(STORAGE_RESHARES_KEY, reshareOverrides);
      } catch (e) {
        console.log('[Feed] repost persistence failed:', e);
      }
    })();

    (async () => {
      try {
        const originalId = String((original as any)?.id ?? '');
        if (!isProbablyRemoteNumericId(originalId)) {
          console.log('[Feed][Remote] repost SKIP (local/temp original id):', originalId);
          return;
        }

        const r1 = await tryRemoteAction({
          label: 'repost',
          method: 'POST',
          path: `/feed/${encodeURIComponent(originalId)}/repost`,
        });
        if (r1.ok) {
          performRemoteSync(set, get);
          return;
        }

        const r2 = await tryRemoteAction({
          label: 'repost(fallback)',
          method: 'POST',
          path: `/feed/${encodeURIComponent(originalId)}/reshare`,
        });
        if (r2.ok) {
          performRemoteSync(set, get);
          return;
        }

        const r3 = await tryRemoteAction({
          label: 'repost(fallback2)',
          method: 'PATCH',
          path: `/feed/${encodeURIComponent(originalId)}`,
          body: { reshareCount: (base.reshareCount ?? 0) + 1 },
        });
        if (r3.ok) {
          performRemoteSync(set, get);
          return;
        }

        await enqueuePendingAction({ type: 'repost', postId: originalId, ts: Date.now() });
      } catch (e) {
        console.log('[Feed] remote repost error:', e);
        await enqueuePendingAction({ type: 'repost', postId: String((original as any)?.id ?? ''), ts: Date.now() });
      }
    })();
  },
}));