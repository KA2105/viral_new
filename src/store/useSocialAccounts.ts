// src/store/useSocialAccounts.ts
import { create } from 'zustand';
import storage from '../storage';

export type SocialPlatform =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'nextsosyal'
  | 'tiktok'
  | 'youtube'
  | 'x';

export type SocialAccount = {
  id: SocialPlatform;
  name: string;
  isConnected: boolean;
};

type SocialAccountsState = {
  accounts: SocialAccount[];
  connectedPlatforms: SocialPlatform[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  toggleAccount: (id: SocialPlatform) => void;
  connectAll: () => void;
  disconnectAll: () => void;
};

const STORAGE_KEY = 'social_accounts_v1';

const initialAccounts: SocialAccount[] = [
  { id: 'facebook',   name: 'Facebook',   isConnected: false },
  { id: 'instagram',  name: 'Instagram',  isConnected: false },
  { id: 'linkedin',   name: 'LinkedIn',   isConnected: false },
  { id: 'nextsosyal', name: 'Nextsosyal', isConnected: false },
  { id: 'tiktok',     name: 'TikTok',     isConnected: false },
  { id: 'youtube',    name: 'YouTube',    isConnected: false },
  { id: 'x',          name: 'X',          isConnected: false },
];

// saved (eski) liste ile initialAccounts’ı birleştirip
// eksik platform varsa ekleyen küçük helper
function mergeWithInitial(
  saved: SocialAccount[] | null | undefined,
): SocialAccount[] {
  if (!saved || !Array.isArray(saved)) {
    return initialAccounts;
  }

  return initialAccounts.map(base => {
    const existing = saved.find(a => a.id === base.id);
    return existing ? { ...base, ...existing } : base;
  });
}

export const useSocialAccounts = create<SocialAccountsState>((set, get) => ({
  accounts: initialAccounts,
  connectedPlatforms: [],
  hydrated: false,

  // AsyncStorage üstünden kayıtlı hesapları yükle
  hydrate: async () => {
    try {
      const saved = await storage.loadJson<SocialAccount[]>(STORAGE_KEY);
      const merged = mergeWithInitial(saved);

      const connectedPlatforms = merged
        .filter(a => a.isConnected)
        .map(a => a.id);

      set({
        accounts: merged,
        connectedPlatforms,
        hydrated: true,
      });
    } catch (e) {
      console.warn('[SocialAccounts] hydrate failed:', e);
      const merged = mergeWithInitial(null);
      const connectedPlatforms = merged
        .filter(a => a.isConnected)
        .map(a => a.id);

      set({
        accounts: merged,
        connectedPlatforms,
        hydrated: true,
      });
    }
  },

  toggleAccount: (id) =>
    set((state) => {
      const updated = state.accounts.map((acc) =>
        acc.id === id ? { ...acc, isConnected: !acc.isConnected } : acc,
      );
      const connectedPlatforms = updated
        .filter((a) => a.isConnected)
        .map((a) => a.id);

      // kalıcı kaydet
      storage.saveJson(STORAGE_KEY, updated);

      return { accounts: updated, connectedPlatforms };
    }),

  connectAll: () =>
    set(() => {
      const updated = initialAccounts.map((acc) => ({
        ...acc,
        isConnected: true,
      }));
      const connectedPlatforms = updated.map((a) => a.id);

      storage.saveJson(STORAGE_KEY, updated);

      return { accounts: updated, connectedPlatforms };
    }),

  disconnectAll: () =>
    set(() => {
      const updated = initialAccounts.map((acc) => ({
        ...acc,
        isConnected: false,
      }));

      storage.saveJson(STORAGE_KEY, updated);

      return { accounts: updated, connectedPlatforms: [] };
    }),
}));
