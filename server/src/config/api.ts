// src/config/api.ts
export const API_BASE_URL = 'http://localhost:4000';
console.log('[API] BASE URL =', API_BASE_URL);


export async function postAnonymousLogin(deviceId: string) {
  const res = await fetch(`${API_BASE_URL}/auth/anonymous`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deviceId }),
  });

  if (!res.ok) {
    throw new Error(`Auth error: ${res.status}`);
  }

  const json = await res.json();
  // Beklenen şekil:
  // { ok: true, user: { id, deviceId, displayName, fullName?, language, createdAt, ... } }

  if (!json.ok || !json.user) {
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

export type MeUser = {
  id: number;
  deviceId: string;
  displayName: string; // alias: backend fullName döner, ama displayName de gönderiyoruz
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
  const res = await fetch(`${API_BASE_URL}/me?userId=${userId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': String(userId),
    },
  });

  if (!res.ok) {
    throw new Error(`GET /me error: ${res.status}`);
  }

  const json = await res.json();
  if (!json.ok || !json.user) {
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
  const res = await fetch(`${API_BASE_URL}/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': String(userId),
    },
    body: JSON.stringify({
      userId,
      ...patch,
    }),
  });

  if (!res.ok) {
    throw new Error(`PUT /me error: ${res.status}`);
  }

  const json = await res.json();
  if (!json.ok || !json.user) {
    throw new Error('Invalid /me update response');
  }

  return json.user as MeUser;
}
