// src/storage/safeAsync.ts
import { LogBox } from 'react-native';

type Store = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const memory: Record<string, string> = {};

const memoryStore: Store = {
  async getItem(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  },
  async setItem(key, value) {
    memory[key] = value;
  },
  async removeItem(key) {
    delete memory[key];
  },
};

LogBox.ignoreLogs(['[@RNC/AsyncStorage]: NativeModule: AsyncStorage is null.']);

const isStoreLike = (x: any): x is Store =>
  !!x &&
  typeof x.getItem === 'function' &&
  typeof x.setItem === 'function' &&
  typeof x.removeItem === 'function';

function resolveAsyncStorage(): Store | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');

    // Bazı projelerde: mod.default, bazılarında: mod, bazılarında: mod.default.default
    const candidates = [
      mod,
      mod?.default,
      mod?.default?.default,
      mod?.AsyncStorage,
      mod?.default?.AsyncStorage,
    ].filter(Boolean);

    for (const c of candidates) {
      if (isStoreLike(c)) return c as Store;
    }

    console.warn(
      '[Storage] AsyncStorage bulundu ama beklenen API yok. Memory store kullanılacak.',
      { keys: Object.keys(mod ?? {}) },
    );
    return null;
  } catch (e) {
    console.warn('[Storage] AsyncStorage require başarısız. Memory store kullanılacak.', e);
    return null;
  }
}

const store: Store = resolveAsyncStorage() ?? memoryStore;

export default store;
