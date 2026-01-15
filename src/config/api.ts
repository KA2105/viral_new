// C:\Users\Acer\viral_new\src\config\api.ts
import { Platform } from 'react-native';

export const API_PORT = 4000;

// ✅ ÖNEMLİ:
// Release build'te telefondaki "localhost" = telefonun kendisi demek.
// Bu yüzden gerçek kullanımda backend'e bağlanamazsın.
// Çözüm: USB (adb reverse) varsa localhost, yoksa LAN IP.
// Aşağıdaki yapı bunu otomatik seçer.

type ApiBaseMode = 'adb' | 'lan' | 'custom';

const API_CONFIG = {
  // ✅ PC'nin LAN IP'si (aynı Wi-Fi'de iken çalışır)
  // Örnek: 192.168.1.10
  LAN_HOST: '192.168.1.103',

  // ✅ İstersen manuel override (boş bırak = kullanılmaz)
  CUSTOM_BASE_URL: '',

  // ✅ Release'te LAN'a öncelik ver (istersen true yap)
  // - false: önce adb reverse (localhost), olmazsa LAN
  // - true : önce LAN, olmazsa adb reverse
  PREFER_LAN_IN_RELEASE: true,
};

function buildBaseUrl(host: string) {
  return `http://${host}:${API_PORT}`;
}

function pickBaseUrl(): { baseUrl: string; mode: ApiBaseMode } {
  // 1) Manuel override
  const custom = String(API_CONFIG.CUSTOM_BASE_URL || '').trim();
  if (custom.length) {
    return { baseUrl: custom, mode: 'custom' };
  }

  const adb = buildBaseUrl('localhost');
  const lan = buildBaseUrl(API_CONFIG.LAN_HOST);

  // 2) Dev: genelde adb reverse kullanıyorsun, localhost iyidir
  if (__DEV__) {
    return { baseUrl: adb, mode: 'adb' };
  }

  // 3) Release: istersen LAN öncelikli
  if (API_CONFIG.PREFER_LAN_IN_RELEASE) {
    return { baseUrl: lan, mode: 'lan' };
  }

  // 4) Default: önce adb reverse varsay (USB ile), yoksa LAN'a geçeceğiz
  // Not: Burada direkt "fallback" yapamıyoruz çünkü fetch atınca anlaşılır.
  // Ama baseUrl seçimini "adb" yapıp, network hatasında LAN'ı deneyeceğiz (apiFetch içinde).
  return { baseUrl: adb, mode: 'adb' };
}

const picked = pickBaseUrl();

// ✅ İlk tercih
export const API_BASE_URL = picked.baseUrl;

// ✅ Token: global (store hydrate/login/register sonrası set edilir)
let AUTH_TOKEN: string | null = null;

export function setAuthToken(token: string | null | undefined) {
  const t = typeof token === 'string' ? token.trim() : '';
  AUTH_TOKEN = t.length ? t : null;
  if (__DEV__) console.log('[API] setAuthToken =>', AUTH_TOKEN ? 'SET' : 'CLEARED');
}

// İstersen debug:
if (__DEV__) {
  console.log('[API] USING BASE URL =>', API_BASE_URL, `(mode=${picked.mode})`);
}

async function safeReadText(res: Response) {
  return await res.text().catch(() => '');
}

async function safeReadJson(res: Response) {
  const text = await safeReadText(res);
  if (!text) return { json: null as any, text: '' };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null as any, text };
  }
}

function toStr(v: any) {
  try {
    return String(v ?? '');
  } catch {
    return '';
  }
}

function inferBackendMessage(json: any, fallbackText: string) {
  const candidates = [
    json?.message,
    json?.error,
    json?.msg,
    json?.detail,
    json?.data?.message,
    json?.data?.error,
  ]
    .map(toStr)
    .map((s) => s.trim())
    .filter(Boolean);

  if (candidates.length > 0) return candidates[0];
  const t = toStr(fallbackText).trim();
  if (t) return t;
  return '';
}

export class ApiError extends Error {
  status?: number;
  endpoint?: string;
  userMessage: string;
  rawBody?: string;

  constructor(params: {
    message: string;
    userMessage: string;
    status?: number;
    endpoint?: string;
    rawBody?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.endpoint = params.endpoint;
    this.userMessage = params.userMessage;
    this.rawBody = params.rawBody;
  }
}

export function getUserMessage(err: unknown, fallback = 'Bir hata oluştu. Lütfen tekrar deneyin.') {
  if (err instanceof ApiError) return err.userMessage || fallback;
  if (err instanceof Error) {
    const msg = (err.message || '').trim();
    if (!msg) return fallback;
    if (msg.toLowerCase().includes('network request failed')) return 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.';
    if (msg.toLowerCase().includes('timeout')) return 'İşlem zaman aşımına uğradı. Lütfen tekrar dene.';
    return fallback;
  }
  return fallback;
}

type FetchOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
};

// ✅ Tek yerden fetch standardı (timeout + hata ayrıştırma)
// ✅ EK: Release'te "localhost" network fail olursa LAN'a 1 kez otomatik düş
async function apiFetch<T = any>(endpoint: string, options: FetchOptions): Promise<T> {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000;

  const doFetchOnce = async (baseUrl: string): Promise<{ res: Response; baseUrl: string }> => {
    const url = `${baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: options.method,
        headers: {
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
          ...(options.headers ?? {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      return { res, baseUrl };
    } finally {
      clearTimeout(timer);
    }
  };

  const tryLanFallback =
    !__DEV__ &&
    picked.mode === 'adb' && // ilk seçim adb (localhost) ise
    String(API_CONFIG.LAN_HOST || '').trim().length > 0;

  try {
    // 1) İlk deneme (seçilen base)
    let { res, baseUrl } = await doFetchOnce(API_BASE_URL);

    // Eğer res.ok değilse normal hata akışı
    if (res.ok) {
      const { json, text } = await safeReadJson(res);
      if (json !== null) return json as T;
      return (text as any) as T;
    }

    // HTTP hata: burada LAN'a düşmek genelde anlamlı değil (sunucuya ulaştın demektir)
    const { json, text } = await safeReadJson(res);
    const backendMsg = inferBackendMessage(json, text);

    let userMessage = 'İşlem başarısız oldu. Lütfen tekrar deneyin.';
    if (res.status === 401 || res.status === 403) {
      userMessage = 'Oturum doğrulanamadı. Lütfen tekrar giriş yap.';
    } else if (res.status === 404) {
      userMessage = 'İstek bulunamadı (404).';
    } else if (res.status >= 500) {
      userMessage = 'Sunucu hatası oluştu. Lütfen tekrar dene.';
    }

    const tech = `${options.method} ${endpoint} failed: ${res.status}${backendMsg ? ` - ${backendMsg}` : ''}`;

    throw new ApiError({
      message: tech,
      userMessage,
      status: res.status,
      endpoint,
      rawBody: text,
    });
  } catch (e: any) {
    // Timeout
    if (e?.name === 'AbortError') {
      throw new ApiError({
        message: `${options.method} ${endpoint} timeout after ${timeoutMs}ms`,
        userMessage: 'İşlem zaman aşımına uğradı. Lütfen tekrar dene.',
        endpoint,
      });
    }

    // Network fail => release'te localhost seçilmişse LAN'a 1 kez otomatik dene
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('network request failed') && tryLanFallback) {
      try {
        const lanBase = buildBaseUrl(API_CONFIG.LAN_HOST);
        if (__DEV__) console.log('[API] localhost failed, trying LAN =>', lanBase);

        const { res } = await (async () => {
          const url = `${lanBase}${endpoint}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const r = await fetch(url, {
              method: options.method,
              headers: {
                ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
                ...(options.headers ?? {}),
              },
              body: options.body,
              signal: controller.signal,
            });
            return { res: r };
          } finally {
            clearTimeout(timer);
          }
        })();

        if (res.ok) {
          const { json, text } = await safeReadJson(res);
          if (json !== null) return json as T;
          return (text as any) as T;
        }

        const { json, text } = await safeReadJson(res);
        const backendMsg = inferBackendMessage(json, text);
        const tech = `${options.method} ${endpoint} failed on LAN: ${res.status}${backendMsg ? ` - ${backendMsg}` : ''}`;

        throw new ApiError({
          message: tech,
          userMessage: 'İşlem başarısız oldu. Lütfen tekrar deneyin.',
          status: res.status,
          endpoint,
          rawBody: text,
        });
      } catch (e2: any) {
        // LAN da olmadı -> net mesaj
        throw new ApiError({
          message: `${options.method} ${endpoint} network failed (adb+lan): ${e2?.message || ''}`,
          userMessage: 'Sunucuya bağlanılamadı. Aynı Wi-Fi ağında olduğundan ve backend’in açık olduğundan emin ol.',
          endpoint,
        });
      }
    }

    // Direkt network fail
    if (msg.includes('network request failed')) {
      throw new ApiError({
        message: `${options.method} ${endpoint} network failed: ${e?.message || ''}`,
        userMessage: 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.',
        endpoint,
      });
    }

    throw new ApiError({
      message: `${options.method} ${endpoint} unexpected error: ${e?.message || String(e)}`,
      userMessage: 'Beklenmeyen bir hata oluştu. Lütfen tekrar dene.',
      endpoint,
    });
  }
}

export type BackendUser = {
  id: number;
  deviceId: string;
  displayName: string;
  language: string | null;
  createdAt: string;

  fullName?: string | null;
  handle?: string | null;
  bio?: string | null;
  website?: string | null;
  avatarUri?: string | null;
  email?: string | null;
  phone?: string | null;
  isPhoneVerified?: boolean | null;
  updatedAt?: string;
};

export type AuthRegisterPayload = {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  deviceId?: string | null; // (server destekli; istersen yollayabilirsin)
};

export type AuthLoginPayload = {
  identifier: string; // email | phone | handle
  password: string;
};

// ✅ putMe için opsiyonel payload tipi
export type PutMePayload = Partial<{
  fullName: string;
  handle: string | null;
  bio: string | null;
  website: string | null;
  avatarUri: string | null;
  email: string | null;
  phone: string | null;
  isPhoneVerified: boolean;
  language: string | null;
}>;

function mapBackendUser(jsonUser: any): BackendUser {
  return {
    id: Number(jsonUser?.id),
    deviceId: String(jsonUser?.deviceId ?? ''),
    displayName: String(jsonUser?.displayName ?? jsonUser?.fullName ?? 'Viral user'),
    language: typeof jsonUser?.language === 'string' ? jsonUser.language : null,
    createdAt: String(jsonUser?.createdAt ?? new Date().toISOString()),

    fullName: typeof jsonUser?.fullName === 'string' ? jsonUser.fullName : null,
    handle: typeof jsonUser?.handle === 'string' ? jsonUser.handle : null,
    bio: typeof jsonUser?.bio === 'string' ? jsonUser.bio : null,
    website: typeof jsonUser?.website === 'string' ? jsonUser.website : null,
    avatarUri: typeof jsonUser?.avatarUri === 'string' ? jsonUser.avatarUri : null,
    email: typeof jsonUser?.email === 'string' ? jsonUser.email : null,
    phone: typeof jsonUser?.phone === 'string' ? jsonUser.phone : null,
    isPhoneVerified:
      typeof jsonUser?.isPhoneVerified === 'boolean' ? jsonUser.isPhoneVerified : null,
    updatedAt: jsonUser?.updatedAt ? String(jsonUser.updatedAt) : undefined,
  };
}

function pickUserFromResponse(json: any): any | null {
  if (!json || typeof json !== 'object') return null;
  if (json.user) return json.user;
  if (json.me) return json.me;
  if (json.data?.user) return json.data.user;
  if (json.data?.me) return json.data.me;

  if (typeof (json as any).id !== 'undefined') return json;
  return null;
}

function pickTokenFromResponse(json: any): string | null {
  const t =
    (typeof json?.token === 'string' ? json.token : null) ??
    (typeof json?.data?.token === 'string' ? json.data.token : null);
  const s = (t ?? '').trim();
  return s.length ? s : null;
}

// ✅ REGISTER
export async function postRegister(payload: AuthRegisterPayload): Promise<{ user: BackendUser; token: string | null }> {
  const json = await apiFetch<any>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      password: payload.password,
      deviceId: payload.deviceId ?? undefined, // server destekli
    }),
    timeoutMs: 20000,
  });

  const u = pickUserFromResponse(json);
  if (!u) {
    throw new ApiError({
      message: 'Invalid register response',
      userMessage: 'Kayıt işlemi tamamlanamadı. Lütfen tekrar dene.',
      endpoint: '/auth/register',
    });
  }

  const token = pickTokenFromResponse(json);
  return { user: mapBackendUser(u), token };
}

// ✅ LOGIN
export async function postLogin(payload: AuthLoginPayload): Promise<{ user: BackendUser; token: string | null }> {
  const json = await apiFetch<any>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: payload.identifier,
      password: payload.password,
    }),
    timeoutMs: 20000,
  });

  const u = pickUserFromResponse(json);
  if (!u) {
    throw new ApiError({
      message: 'Invalid login response',
      userMessage: 'Giriş işlemi tamamlanamadı. Lütfen tekrar dene.',
      endpoint: '/auth/login',
    });
  }

  const token = pickTokenFromResponse(json);
  return { user: mapBackendUser(u), token };
}

// ✅ GET ME
export async function getMe(userId?: number | null): Promise<BackendUser> {
  // Token varsa zaten /me token ile çalışır; yine de compat için query+header tutuyorum.
  const qs = typeof userId === 'number' && userId > 0 ? `?userId=${userId}` : '';
  const json2 = await apiFetch<any>(`/me${qs}`, {
    method: 'GET',
    headers: {
      ...(typeof userId === 'number' && userId > 0 ? { 'x-user-id': String(userId) } : {}),
    },
    timeoutMs: 15000,
  });

  const u2 = pickUserFromResponse(json2);
  if (!u2) {
    throw new ApiError({
      message: 'Invalid getMe(/me) response',
      userMessage: 'Kullanıcı bilgileri alınamadı. Lütfen tekrar dene.',
      endpoint: `/me${qs}`,
    });
  }
  return mapBackendUser(u2);
}

// ✅ PUT ME
export async function putMe(
  userId: number | null | undefined,
  payload: PutMePayload,
): Promise<BackendUser> {
  const uid =
    typeof userId === 'number' && Number.isFinite(userId) && userId > 0 ? userId : null;

  const qs = uid ? `?userId=${uid}` : '';
  const json2 = await apiFetch<any>(`/me${qs}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(uid ? { 'x-user-id': String(uid) } : {}),
    },
    body: JSON.stringify({ ...(payload ?? {}), ...(uid ? { userId: uid } : {}) }),
    timeoutMs: 20000,
  });

  const u2 = pickUserFromResponse(json2);
  if (!u2) {
    throw new ApiError({
      message: 'Invalid putMe(/me) response',
      userMessage: 'Profil güncellenemedi. Lütfen tekrar dene.',
      endpoint: `/me${qs}`,
    });
  }
  return mapBackendUser(u2);
}
