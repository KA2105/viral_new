// src/storage/index.ts
import store from './safeAsync';

async function saveJson(key: string, value: any) {
  try {
    const json = JSON.stringify(value);
    await store.setItem(key, json);
    return true;
  } catch (err) {
    console.warn('[Storage] saveJson failed:', err);
    return false;
  }
}

async function loadJson<T = any>(key: string): Promise<T | null> {
  try {
    const json = await store.getItem(key);
    if (!json) return null;
    return JSON.parse(json) as T;
  } catch (err) {
    console.warn('[Storage] loadJson failed:', err);
    return null;
  }
}

export default {
  saveJson,
  loadJson,
};
