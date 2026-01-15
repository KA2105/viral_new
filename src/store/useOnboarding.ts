import { create } from 'zustand';
import storage from '../storage';

type OnboardingState = {
  hydrated: boolean;
  seen: boolean;

  hydrate: () => Promise<void>;
  markSeen: () => void;
  reset: () => void; // 🔥 eklendi
};

const STORAGE_KEY = 'onboarding_v2';

export const useOnboarding = create<OnboardingState>((set, get) => ({
  hydrated: false,
  seen: false,

  hydrate: async () => {
    try {
      const saved = await storage.loadJson<{ seen: boolean } | null>(
        STORAGE_KEY,
      );

      if (saved && typeof saved.seen === 'boolean') {
        set({ seen: saved.seen, hydrated: true });
      } else {
        set({ seen: false, hydrated: true });
      }
    } catch (e) {
      console.warn('[Onboarding] hydrate failed:', e);
      set({ hydrated: true });
    }
  },

  markSeen: () => {
    set({ seen: true });
    storage.saveJson(STORAGE_KEY, { seen: true });
  },

  // 🔥 Onboarding flag’ini sıfırla
  reset: () => {
    set({ seen: false });
    storage.saveJson(STORAGE_KEY, { seen: false });
  },
}));
