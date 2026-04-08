// C:\Users\Acer\viral_new\src\config\api.ts
import { Platform } from 'react-native';

export const API_PORT = 4000;

// ✅ Render backend (prod)
const RENDER_BASE_URL = 'https://viral-new.onrender.com';

// ✅ ÖNEMLİ:
// - Dev (Metro): İstersen yine localhost/adb reverse kullanabilirsin.
// - Release/Prod test: Render URL kullanılır.
// Bu dosyada amaç: "mode=adb" yüzünden tekrar localhost'a dönmeyi ENGELLEMEK.

type ApiBaseMode = 'adb' | 'lan' | 'custom' | 'render';

const API_CONFIG = {
  // ✅ PC'nin LAN IP'si (aynı Wi-Fi'de iken çalışır)
  // Örnek: 192.168.1.10
  LAN_HOST: '192.168.1.103',

  // ✅ İstersen manuel override (boş bırak = kullanılmaz)
  // Not: Buraya "https://viral-new.onrender.com" yazarsan custom ile de kullanılır.
  CUSTOM_BASE_URL: '',

  // ✅ Release'te LAN'a öncelik ver (istersen true yap)
  // - false: önce adb reverse (localhost), olmazsa LAN
  // - true : önce LAN, olmazsa adb reverse
  PREFER_LAN_IN_RELEASE: true,

  // ✅ DEV'de Render'ı zorla kullanmak istiyorsan true yap
  FORCE_RENDER_IN_DEV: true,
};

function buildBaseUrl(host: string) {
  return `http://${host}:${API_PORT}`;
}

function pickBaseUrl(): { baseUrl: string; mode: ApiBaseMode } {
  // 0) DEV'de Render zorla
  if (__DEV__ && API_CONFIG.FORCE_RENDER_IN_DEV) {
    return { baseUrl: RENDER_BASE_URL, mode: 'render' };
  }

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

  // 3) Release: Render kullan (LAN/adb yerine)
  return { baseUrl: RENDER_BASE_URL, mode: 'render' };
}

const picked = pickBaseUrl();

// ✅ İlk tercih
export const API_BASE_URL = picked.baseUrl;

// ✅ ALIAS: projede bazı yerler hâlâ API_URL kullanıyor olabilir (özellikle UploadScreen)
export const API_URL = API_BASE_URL;

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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
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
    let { res } = await doFetchOnce(API_BASE_URL);

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
  phone?: string | null;
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

export type ForgotPasswordPayload = {
  identifier: string;
};

export async function postForgotPassword(
  payload: ForgotPasswordPayload,
): Promise<{ ok: boolean; message: string }> {
  const json = await apiFetch<any>('/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: payload.identifier,
    }),
    timeoutMs: 20000,
  });

  return {
    ok: !!json?.ok,
    message: String(json?.message ?? 'Hesap varsa doğrulama kodu gönderildi.'),
  };
}

export type ResetPasswordPayload = {
  identifier: string;
  code: string;
  newPassword: string;
};

export async function postResetPassword(
  payload: ResetPasswordPayload,
): Promise<{ ok: boolean; message: string }> {
  const json = await apiFetch<any>('/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: payload.identifier,
      code: payload.code,
      newPassword: payload.newPassword,
    }),
    timeoutMs: 20000,
  });

  return {
    ok: !!json?.ok,
    message: String(json?.message ?? 'Şifren başarıyla güncellendi.'),
  };
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

// -------------------- Posts: Like / Comments helpers --------------------

// ✅ Like toggle
export async function postToggleLike(postId: string | number): Promise<{ ok: boolean; liked: boolean; likeCount: number }> {
  const pid = String(postId);
  const json = await apiFetch<any>(`/posts/${encodeURIComponent(pid)}/like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}), // server body istemiyor ama boş geçiyoruz
    timeoutMs: 15000,
  });

  // server: { ok:true, liked, likeCount }
  return {
    ok: !!json?.ok,
    liked: !!json?.liked,
    likeCount: Number.isFinite(Number(json?.likeCount)) ? Number(json.likeCount) : 0,
  };
}

// ✅ Comment create
export async function postCreateComment(
  postId: string | number,
  text: string,
): Promise<{ ok: boolean; comment?: any }> {
  const pid = String(postId);
  const json = await apiFetch<any>(`/posts/${encodeURIComponent(pid)}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    timeoutMs: 20000,
  });

  return { ok: !!json?.ok, comment: json?.comment };
}

// ✅ Comment list
export async function getPostComments(
  postId: string | number,
  limit = 50,
): Promise<{ ok: boolean; items: any[] }> {
  const pid = String(postId);
  const json = await apiFetch<any>(`/posts/${encodeURIComponent(pid)}/comments?limit=${limit}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: 20000,
  });

  return { ok: !!json?.ok, items: Array.isArray(json?.items) ? json.items : [] };
}

// ✅ NEW: Repost (server endpoint eklenince çalışır)
export async function postRepost(postId: string | number): Promise<{ ok: boolean; post?: any }> {
  const pid = String(postId);

  // Birden fazla alias deniyoruz (server tarafında hangisini eklediysen)
  try {
    const json = await apiFetch<any>(`/posts/${encodeURIComponent(pid)}/repost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      timeoutMs: 20000,
    });
    return { ok: !!json?.ok, post: json?.post ?? json?.item ?? null };
  } catch {
    // fallback
    const json2 = await apiFetch<any>(`/posts/${encodeURIComponent(pid)}/reshare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      timeoutMs: 20000,
    });
    return { ok: !!json2?.ok, post: json2?.post ?? json2?.item ?? null };
  }
}


export type AppVersionInfo = {
  latestVersion: string;
  minimumSupportedVersion?: string | null;
  forceUpdate: boolean;
  message?: string | null;
  androidStoreUrl?: string | null;
  iosStoreUrl?: string | null;
};

export async function getAppVersion(): Promise<AppVersionInfo> {
  const json = await apiFetch<any>('/app/version', {
    method: 'GET',
    timeoutMs: 10000,
  });

  return {
    latestVersion: String(json?.latestVersion ?? '0.0.0'),
    minimumSupportedVersion:
      json?.minimumSupportedVersion != null
        ? String(json.minimumSupportedVersion)
        : null,
    forceUpdate: !!json?.forceUpdate,
    message:
      json?.message != null && String(json.message).trim().length
        ? String(json.message)
        : null,
    androidStoreUrl:
      json?.androidStoreUrl != null && String(json.androidStoreUrl).trim().length
        ? String(json.androidStoreUrl)
        : null,
    iosStoreUrl:
      json?.iosStoreUrl != null && String(json.iosStoreUrl).trim().length
        ? String(json.iosStoreUrl)
        : null,
  };
}
