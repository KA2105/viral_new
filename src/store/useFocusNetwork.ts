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

export const useFocusNetwork = create<FocusNetworkState>((set, get) => ({
  friends: [],
  discover: [],
  incomingRequests: [],
  hydrated: false,

  hydrateError: false,

  hydrateAll: async ({ userId }) => {
    try {
      // 1) discover (q boş)
      const discoverRes = await fetch(`${API_BASE_URL}/users/search?limit=30`, {
        method: 'GET',
        headers: header(userId),
      });
      const discoverJson = await safeJson(discoverRes);
      const discoverItems = Array.isArray(discoverJson?.items) ? discoverJson.items : [];

      // 2) friends list (userId varsa)
      let friendsItems: any[] = [];
      if (typeof userId === 'number' && Number.isFinite(userId)) {
        const friendsRes = await fetch(`${API_BASE_URL}/friends/list`, {
          method: 'GET',
          headers: header(userId),
        });
        const friendsJson = await safeJson(friendsRes);
        friendsItems = Array.isArray(friendsJson?.items) ? friendsJson.items : [];
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

      set({
        discover: discoverItems,
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
      const url = `${API_BASE_URL}/users/search?q=${encodeURIComponent(q || '')}&limit=50`;
      const res = await fetch(url, {
        method: 'GET',
        headers: header(userId),
      });
      const json = await safeJson(res);
      const items = Array.isArray(json?.items) ? json.items : [];
      set({ discover: items, hydrateError: false });
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
