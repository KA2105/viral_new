// src/store/useFocusNetwork.ts
import { create } from 'zustand';
import { API_BASE_URL } from '../config/api';

export type PublicUser = {
  id: number;
  deviceId: string;
  displayName: string;
  fullName?: string | null;
  handle?: string | null;
  bio?: string | null;
  website?: string | null;
  avatarUri?: string | null;
  email?: string | null;
  phone?: string | null;
  isPhoneVerified?: boolean | null;
  createdAt?: string;
  updatedAt?: string;

  // server: /users/search relationship
  relationship?: 'friend' | 'incoming' | 'outgoing' | 'none' | 'unknown';
};

export type IncomingRequest = {
  id: number; // requestId
  status: string;
  createdAt: string;
  fromUser: PublicUser | null;
};

type FocusNetworkState = {
  friends: PublicUser[];
  discover: PublicUser[];
  incomingRequests: IncomingRequest[];
  hydrated: boolean;

  // ✅ offline/hata fallback için
  hydrateError: boolean;

  // actions
  hydrateAll: (params: { userId: number | null }) => Promise<void>;
  searchUsers: (params: { userId: number | null; q: string }) => Promise<void>;
  sendFriendRequest: (params: { userId: number; toUserId: number }) => Promise<any>;
  acceptFriendRequest: (params: { userId: number; requestId: number }) => Promise<any>;
  declineFriendRequest: (params: { userId: number; requestId: number }) => Promise<any>;
  removeFriend: (params: { userId: number; otherUserId: number }) => Promise<any>;
};

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function header(userId: number | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof userId === 'number' && Number.isFinite(userId)) {
    h['x-user-id'] = String(userId);
  }
  return h;
}

function normalizeUserName(user: any): string {
  const fullName = user?.fullName != null ? String(user.fullName).trim() : '';
  const displayName = user?.displayName != null ? String(user.displayName).trim() : '';
  const handle = user?.handle != null ? String(user.handle).trim().replace(/^@/, '') : '';

  return (fullName || displayName || handle || '').toLocaleLowerCase('tr-TR');
}

function sortUsersByName<T extends any>(items: T[]): T[] {
  const arr = Array.isArray(items) ? [...items] : [];
  return arr.sort((a: any, b: any) => normalizeUserName(a).localeCompare(normalizeUserName(b), 'tr'));
}

function getUserKey(user: any): string {
  const candidates = [
    user?.id,
    user?.userId,
    user?.deviceId,
    user?.email,
    user?.phone,
    user?.handle,
    user?.displayName,
    user?.fullName,
  ];

  for (const c of candidates) {
    if (c == null) continue;
    const v = String(c).trim().toLowerCase();
    if (v) return v;
  }

  return '';
}

function mergeUsersByKey(...lists: any[][]): PublicUser[] {
  const map = new Map<string, any>();

  lists.forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(user => {
      if (!user || typeof user !== 'object') return;
      const key = getUserKey(user);
      if (!key) return;

      const existing = map.get(key);
      const existingRel = existing?.relationship != null ? String(existing.relationship) : '';
      const incomingRel = user?.relationship != null ? String(user.relationship) : '';
      const relationship =
        existingRel === 'friend' || incomingRel === 'friend'
          ? 'friend'
          : existingRel === 'incoming' || incomingRel === 'incoming'
          ? 'incoming'
          : existingRel === 'outgoing' || incomingRel === 'outgoing'
          ? 'outgoing'
          : incomingRel || existingRel || 'none';

      map.set(key, { ...(existing || {}), ...user, relationship });
    });
  });

  return sortUsersByName(Array.from(map.values())) as PublicUser[];
}

async function fetchUsersSearch(userId: number | null, q: string = ''): Promise<PublicUser[]> {
  const all: any[] = [];
  const seen = new Set<string>();
  const query = encodeURIComponent(q || '');
  const stamp = Date.now();

  const addItems = (items: any[]) => {
    let added = 0;
    if (!Array.isArray(items)) return added;

    items.forEach(item => {
      const key = getUserKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      all.push(item);
      added += 1;
    });

    return added;
  };

  const readUrl = async (url: string) => {
    const res = await fetch(url, {
      method: 'GET',
      headers: header(userId),
    });
    const json = await safeJson(res);
    const items = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
    return addItems(items);
  };

  // Büyük limit iste. Bazı server sürümlerinde parametre adı farklı olabilir diye birkaç varyasyon da deniyoruz.
  await readUrl(`${API_BASE_URL}/users/search?q=${query}&limit=5000&take=5000&perPage=5000&_=${stamp}`);

  // Eğer server 30 gibi bir üst sınır uyguluyorsa, sayfalama destekleniyorsa kalanları da toplar.
  for (let page = 2; page <= 20; page += 1) {
    const before = all.length;
    const added = await readUrl(`${API_BASE_URL}/users/search?q=${query}&limit=500&page=${page}&_=${stamp}`);
    if (added === 0 || all.length === before) break;
  }

  return sortUsersByName(all) as PublicUser[];
}

export const useFocusNetwork = create<FocusNetworkState>((set, get) => ({
  friends: [],
  discover: [],
  incomingRequests: [],
  hydrated: false,

  hydrateError: false,

  hydrateAll: async ({ userId }) => {
    try {
      // 1) discover (q boş) - tüm kullanıcıları toplamaya çalış
      const discoverItems = await fetchUsersSearch(userId, '');

      // 2) friends list (userId varsa)
      let friendsItems: any[] = [];
      if (typeof userId === 'number' && Number.isFinite(userId)) {
        const friendsRes = await fetch(`${API_BASE_URL}/friends/list`, {
          method: 'GET',
          headers: header(userId),
        });
        const friendsJson = await safeJson(friendsRes);
        friendsItems = sortUsersByName(Array.isArray(friendsJson?.items) ? friendsJson.items : []);
      }

      // 3) incoming requests
      let incomingItems: any[] = [];
      if (typeof userId === 'number' && Number.isFinite(userId)) {
        const reqRes = await fetch(`${API_BASE_URL}/friends/requests`, {
          method: 'GET',
          headers: header(userId),
        });
        const reqJson = await safeJson(reqRes);
        incomingItems = Array.isArray(reqJson?.items) ? reqJson.items : [];
      }

      // Keşfet listesi, ağdaki kişileri de içermeli. Server eksik dönerse en azından friends ile birleştiriyoruz.
      // Friends endpoint'inden gelen kullanıcılar relationship taşımıyorsa bile Keşfet'te kesin 'Ağımda' görünsün.
      const friendsMarked = friendsItems.map((u: any) => ({ ...u, relationship: 'friend' }));
      const mergedDiscover = mergeUsersByKey(discoverItems, friendsMarked);

      set({
        discover: mergedDiscover,
        friends: friendsItems,
        incomingRequests: incomingItems,
        hydrated: true,
        hydrateError: false,
      });
    } catch (e) {
      console.warn('[useFocusNetwork] hydrateAll failed:', e);
      // offline -> hydrated true kalsın ama UI fallback anlayabilsin
      set({ hydrated: true, hydrateError: true });
    }
  },

  searchUsers: async ({ userId, q }) => {
    try {
      const items = await fetchUsersSearch(userId, q || '');
      const friendsMarked = get().friends.map((u: any) => ({ ...u, relationship: 'friend' }));
      const mergedItems = q && q.trim() ? mergeUsersByKey(items, friendsMarked) : mergeUsersByKey(items, friendsMarked);
      set({ discover: mergedItems, hydrateError: false });
    } catch (e) {
      console.warn('[useFocusNetwork] searchUsers failed:', e);
      // burada hydrateError'u zorla true yapmıyoruz; çünkü kullanıcı offline olabilir ama
      // zaten ekranda fallback listesi gösteriliyor olabilir.
    }
  },

  sendFriendRequest: async ({ userId, toUserId }) => {
    const res = await fetch(`${API_BASE_URL}/friends/request`, {
      method: 'POST',
      headers: header(userId),
      body: JSON.stringify({ toUserId }),
    });
    const json = await safeJson(res);

    // UI güncelle: discover relationship değişebilir, istek listesi değişebilir
    // Hızlı yol: refresh
    await get().hydrateAll({ userId });

    return json;
  },

  acceptFriendRequest: async ({ userId, requestId }) => {
    const res = await fetch(`${API_BASE_URL}/friends/accept`, {
      method: 'POST',
      headers: header(userId),
      body: JSON.stringify({ requestId }),
    });
    const json = await safeJson(res);

    await get().hydrateAll({ userId });

    return json;
  },

  declineFriendRequest: async ({ userId, requestId }) => {
    const res = await fetch(`${API_BASE_URL}/friends/decline`, {
      method: 'POST',
      headers: header(userId),
      body: JSON.stringify({ requestId }),
    });
    const json = await safeJson(res);

    await get().hydrateAll({ userId });

    return json;
  },

  removeFriend: async ({ userId, otherUserId }) => {
    const res = await fetch(`${API_BASE_URL}/friends/remove`, {
      method: 'POST',
      headers: header(userId),
      body: JSON.stringify({ otherUserId }),
    });
    const json = await safeJson(res);

    await get().hydrateAll({ userId });

    return json;
  },
}));
