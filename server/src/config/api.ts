// src/config/api.ts

export const API_BASE_URL = 'https://viral-new.onrender.com';
console.log('[API] BASE URL =', API_BASE_URL);

// --------------------
// Helpers
// --------------------
async function safeReadText(res: Response) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function withTimeout(ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(id) };
}

/**
 * fetch + timeout + daha iyi hata mesajı
 * - timeout_ms: kart için 30-45sn, video için 2-5dk mantıklı
 */
async function apiFetch(
  url: string,
  init: RequestInit & { timeout_ms?: number } = {},
) {
  const timeout_ms = init.timeout_ms ?? 45000;
  const { controller, clear } = withTimeout(timeout_ms);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });

    if (!res.ok) {
      const bodyText = await safeReadText(res);
      // Bu log PlayStore sürümünde de işe yarar (adb logcat)
      console.log('[API] ERROR', res.status, url, bodyText?.slice(0, 800));
      throw new Error(`API error: ${res.status} ${bodyText ? `- ${bodyText.slice(0, 120)}` : ''}`);
    }

    return res;
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('aborted') || msg.includes('AbortError')) {
      throw new Error(`API timeout after ${timeout_ms}ms: ${url}`);
    }
    throw e;
  } finally {
    clear();
  }
}

// --------------------
// Auth
// --------------------
export async function postAnonymousLogin(deviceId: string) {
  const res = await apiFetch(`${API_BASE_URL}/auth/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
    timeout_ms: 30000,
  });

  const json = await res.json();

  if (!json.ok || !json.user) {
    console.log('[API] Invalid auth response:', json);
    throw new Error('Invalid auth response');
  }

  return json.user as {
    id: number;
    deviceId: string;
    displayName: string;
    fullName?: string;
    language: string | null;
    createdAt: string;
  };
}

// --------------------
// Me
// --------------------
export type MeUser = {
  id: number;
  deviceId: string;
  displayName: string;
  fullName: string;
  language: string | null;
  createdAt: string;
  updatedAt?: string;

  handle?: string | null;
  bio?: string | null;
  website?: string | null;
  avatarUri?: string | null;
  email?: string | null;
  phone?: string | null;
  isPhoneVerified?: boolean;
};

export async function getMe(userId: number): Promise<MeUser> {
  const res = await apiFetch(`${API_BASE_URL}/me?userId=${userId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': String(userId),
    },
    timeout_ms: 30000,
  });

  const json = await res.json();
  if (!json.ok || !json.user) {
    console.log('[API] Invalid /me response:', json);
    throw new Error('Invalid /me response');
  }

  return json.user as MeUser;
}

export type MePatch = Partial<{
  fullName: string;
  language: string;
  handle: string | null;
  bio: string | null;
  website: string | null;
  avatarUri: string | null;
  email: string | null;
  phone: string | null;
  isPhoneVerified: boolean;
}>;

export async function putMe(userId: number, patch: MePatch): Promise<MeUser> {
  const res = await apiFetch(`${API_BASE_URL}/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': String(userId),
    },
    body: JSON.stringify({ userId, ...patch }),
    timeout_ms: 45000,
  });

  const json = await res.json();
  if (!json.ok || !json.user) {
    console.log('[API] Invalid /me update response:', json);
    throw new Error('Invalid /me update response');
  }

  return json.user as MeUser;
}
