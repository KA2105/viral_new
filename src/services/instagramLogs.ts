// src/services/instagramLogs.ts

export type InstagramLogItem = {
  id: number;
  time: string;        // ISO string
  caption: string;
  username: string;
  videoUri: string | null;
};

export type InstagramLogsResponse = {
  count: number;
  items: InstagramLogItem[];
};

// ⚠ Buradaki IP + port'u instagramShare.ts ile aynı tut
const LOGS_URL = 'http://192.168.1.103:4000/api/instagram/logs';

export async function fetchInstagramLogs(): Promise<InstagramLogItem[]> {
  try {
    const res = await fetch(LOGS_URL);

    if (!res.ok) {
      console.warn(
        '[InstagramLogs] failed with status:',
        res.status,
        res.statusText,
      );
      return [];
    }

    const data: InstagramLogsResponse = await res.json();

    if (!data || !Array.isArray(data.items)) {
      console.warn('[InstagramLogs] invalid response shape:', data);
      return [];
    }

    return data.items;
  } catch (e) {
    console.warn('[InstagramLogs] network error:', e);
    return [];
  }
}
