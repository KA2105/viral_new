// src/store/useAuth.ts
import { create } from 'zustand';
import storage from '../storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import {
  postRegister,
  postLogin,
  getMe,
  putMe,
  setAuthToken, // ✅ token header için
} from '../config/api';

export type UserProfile = {
  fullName: string;
  email: string;
  phone: string;
  createdAt: number;
  isPhoneVerified: boolean;
  avatarUri?: string | null;

  displayName?: string | null;

  handle?: string | null;
  bio?: string | null;
  website?: string | null;
};

type UiErrorField = 'email' | 'phone' | 'identifier' | 'password' | null;

type StoredAccount = {
  identifier: string;
  password: string | null;
  backendUserId: number | null;
  profile: UserProfile | null;
  lastLoginAt?: number;

  // ✅ JWT
  token?: string | null;
};

type StoredAuthV2 = {
  version: 2;
  accounts: StoredAccount[];
  activeIdentifier: string | null;

  deviceId?: string | null;

  sessionActive?: boolean | null;

  prefillRegister?: boolean | null;
};

type AuthCompatResult =
  | { ok: true }
  | { ok: false; error: string };

// ✅ UYUMLULUK: FocusNetworkScreen auth.user.id bekliyor
type CompatUser = {
  id: number;
  displayName?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  handle?: string | null;
  bio?: string | null;
  website?: string | null;
  avatarUri?: string | null;
  isPhoneVerified?: boolean | null;
  createdAt?: number;
};

type AuthState = {
  userId: string | null;
  user: CompatUser | null;

  profile: UserProfile | null;
  password: string | null;

  accounts: StoredAccount[];
  activeIdentifier: string | null;

  phoneVerificationCode: string | null;

  resetCode: string | null;
  resetChannel: 'email' | 'phone' | null;

  backendUserId: number | null;
  deviceId: string | null;

  hydrated: boolean;
  sessionActive: boolean;

  isSyncing: boolean;

  lastError: string | null;

  uiError: string | null;
  uiErrorField: UiErrorField;

  prefillRegister: boolean;

  // ✅ JWT
  token: string | null;

  clearError: () => void;
  register: (p: { fullName: string; email: string; phone: string; password: string }) => Promise<AuthCompatResult>;
  login: (p: { identifier: string; password: string }) => Promise<AuthCompatResult>;

  clearUiError: () => void;

  hydrate: () => Promise<void>;
  init: () => Promise<void>;

  signIn: (uid: string) => void;

  saveProfile: (params: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    handle?: string;
    bio?: string;
    website?: string;
  }) => Promise<{ ok: boolean; error?: string; field?: UiErrorField }>;

  loginWithCredentials: (params: {
    identifier: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string; field?: UiErrorField }>;

  loginWithPassword: (password: string) => { ok: boolean; error?: string };

  requestPhoneCode: () => { ok: boolean; error?: string; code?: string };
  verifyPhoneCode: (code: string) => { ok: boolean; error?: string };

  requestPasswordReset: (params: {
    via: 'email' | 'phone';
    value: string;
  }) => { ok: boolean; error?: string; code?: string };

  resetPassword: (params: {
    code: string;
    newPassword: string;
  }) => { ok: boolean; error?: string };

  setAvatarUri: (uri: string | null) => void;

  signOut: () => void;
  switchUser: () => void;
  startFreshAccount: () => Promise<void>;
};

const STORAGE_KEY = 'auth_v2';

const generateDeviceId = () => `dev-${Math.random().toString(36).slice(2, 10)}`;

const isStrongPassword = (pwd: string) => {
  if (!pwd || pwd.length < 8) return false;
  if (!/[a-z]/.test(pwd)) return false;
  if (!/[A-Z]/.test(pwd)) return false;
  if (!/[0-9]/.test(pwd)) return false;
  if (!/[^A-Za-z0-9]/.test(pwd)) return false;
  return true;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const validateEmail = (email: string) => {
  const e = normalizeEmail(email);
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(e);
};

const cleanPhone = (phone: string) => phone.replace(/[^\d]/g, '');

const normalizeIdentifier = (raw: string) => raw.trim();

const isLikelyEmail = (id: string) => validateEmail(id);
const isLikelyPhone = (id: string) => {
  const p = cleanPhone(id);
  return p.length >= 10;
};

const normalizeHandle = (raw?: string) => {
  if (!raw) return '';
  return raw.trim().replace(/^@+/, '');
};

const isValidHandle = (handle: string) => {
  if (!handle) return true;
  return /^[a-zA-Z0-9_.]{3,24}$/.test(handle);
};

const buildCompatUser = (backendUserId: number | null, profile: UserProfile | null): CompatUser | null => {
  if (!(typeof backendUserId === 'number' && Number.isFinite(backendUserId) && backendUserId > 0)) return null;
  const p = profile;
  return {
    id: backendUserId,
    displayName: (p?.displayName ?? p?.fullName ?? null) as any,
    fullName: (p?.fullName ?? null) as any,
    email: (p?.email ?? null) as any,
    phone: (p?.phone ?? null) as any,
    handle: (p?.handle ?? null) as any,
    bio: (p?.bio ?? null) as any,
    website: (p?.website ?? null) as any,
    avatarUri: (p?.avatarUri ?? null) as any,
    isPhoneVerified: (typeof p?.isPhoneVerified === 'boolean' ? p.isPhoneVerified : null) as any,
    createdAt: (p?.createdAt ?? undefined) as any,
  };
};

const normalizeStoredProfile = (raw: any | null): UserProfile | null => {
  if (!raw || typeof raw !== 'object') return null;

  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now();

  const fullName = String(raw.fullName ?? raw.displayName ?? 'Kullanıcı');

  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim().length
      ? raw.displayName.trim()
      : fullName;

  return {
    fullName,
    email: String(raw.email ?? ''),
    phone: String(raw.phone ?? ''),
    createdAt,
    isPhoneVerified: !!raw.isPhoneVerified,
    avatarUri:
      typeof raw.avatarUri === 'string' || raw.avatarUri === null ? raw.avatarUri : null,

    displayName,

    handle:
      typeof raw.handle === 'string' && raw.handle.trim().length ? raw.handle : null,
    bio: typeof raw.bio === 'string' && raw.bio.trim().length ? raw.bio : null,
    website:
      typeof raw.website === 'string' && raw.website.trim().length ? raw.website : null,
  };
};

const mergeProfileWithBackend = (current: UserProfile | null, backend: any): UserProfile | null => {
  if (!backend || typeof backend !== 'object') return current;

  const now = Date.now();

  const base: UserProfile =
    current ?? {
      fullName: '',
      email: '',
      phone: '',
      createdAt: now,
      isPhoneVerified: false,
      avatarUri: null,

      displayName: '',

      handle: null,
      bio: null,
      website: null,
    };

  const pickStr = (localVal: any, backendVal: any) => {
    const l = typeof localVal === 'string' ? localVal.trim() : '';
    const b = typeof backendVal === 'string' ? backendVal.trim() : '';
    return l.length ? l : b.length ? b : '';
  };

  const pickNullableStr = (localVal: any, backendVal: any) => {
    const l = typeof localVal === 'string' ? localVal.trim() : '';
    if (l.length) return l;
    const b = typeof backendVal === 'string' ? backendVal.trim() : '';
    if (b.length) return b;
    return null;
  };

  const nextFullName =
    pickStr(base.fullName, backend.fullName) ||
    pickStr(base.fullName, backend.displayName) ||
    'Kullanıcı';

  const nextDisplayName =
    pickStr(base.displayName, backend.displayName) ||
    pickStr(base.displayName, backend.fullName) ||
    nextFullName;

  const next: UserProfile = {
    ...base,
    fullName: nextFullName,
    email: pickStr(base.email, backend.email) || base.email,
    phone: pickStr(base.phone, backend.phone) || base.phone,

    displayName: nextDisplayName,

    // ✅ avatarUri: local doluysa local, değilse backend
avatarUri: (() => {
  const local =
    typeof base.avatarUri === 'string' && base.avatarUri.trim().length ? base.avatarUri.trim() : null;

  const remote =
    typeof backend.avatarUri === 'string' && backend.avatarUri.trim().length
      ? backend.avatarUri.trim()
      : null;

  return local ?? remote ?? null;
})(),

    handle: (() => {
      const h = pickNullableStr(base.handle, backend.handle);
      return h ? h.replace(/^@+/, '') : null;
    })(),
    bio: pickNullableStr(base.bio, backend.bio),
    website: pickNullableStr(base.website, backend.website),
    isPhoneVerified:
      typeof backend.isPhoneVerified === 'boolean' ? backend.isPhoneVerified : base.isPhoneVerified,
  };

  return next;
};

const parseBackendTakenError = (
  err: any,
): { field: UiErrorField; message: string | null } => {
  const raw = String(err?.message ?? err ?? '');

  const m = raw.match(/\{[\s\S]*\}$/);
  if (m?.[0]) {
    try {
      const j = JSON.parse(m[0]);
      if (j?.error === 'email-taken' || j?.field === 'email') {
        return { field: 'email', message: j?.message || 'Bu e-posta başka bir hesapta kayıtlı.' };
      }
      if (j?.error === 'phone-taken' || j?.field === 'phone') {
        return { field: 'phone', message: j?.message || 'Bu telefon numarası başka bir hesapta kayıtlı.' };
      }
      if (j?.error === 'invalid-credentials' || j?.error === 'wrong-password') {
        return { field: 'identifier', message: j?.message || 'Giriş bilgileri hatalı.' };
      }
      if (typeof j?.message === 'string' && j.message.trim().length) {
        return { field: null, message: j.message };
      }
    } catch {}
  }

  if (raw.includes('email-taken') || raw.includes('"field":"email"')) {
    return { field: 'email', message: 'Bu e-posta başka bir hesapta kayıtlı.' };
  }
  if (raw.includes('phone-taken') || raw.includes('"field":"phone"')) {
    return { field: 'phone', message: 'Bu telefon numarası başka bir hesapta kayıtlı.' };
  }
  if (raw.toLowerCase().includes('invalid') && raw.toLowerCase().includes('credential')) {
    return { field: 'identifier', message: 'Giriş bilgileri hatalı.' };
  }

  if (raw.toLowerCase().includes('email') && raw.toLowerCase().includes('taken')) {
    return { field: 'email', message: 'Bu e-posta başka bir hesapta kayıtlı.' };
  }
  if (raw.toLowerCase().includes('phone') && raw.toLowerCase().includes('taken')) {
    return { field: 'phone', message: 'Bu telefon numarası başka bir hesapta kayıtlı.' };
  }

  return { field: null, message: null };
};

const upsertAccount = (accounts: StoredAccount[], next: StoredAccount) => {
  const id = next.identifier.trim().toLowerCase();
  const idx = accounts.findIndex(a => a.identifier.trim().toLowerCase() === id);
  if (idx >= 0) {
    const copy = [...accounts];
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }
  return [next, ...accounts];
};

const pickBestIdentifierForAccount = (profile: UserProfile | null) => {
  const email = (profile?.email ?? '').trim();
  if (email && validateEmail(email)) return email;
  const phone = cleanPhone(profile?.phone ?? '');
  if (phone.length >= 10) return phone;
  return '';
};

// ✅ Dil tercihi için: birden fazla olası key’i dene
const LANG_KEYS = ['viral_language', 'app_language', 'language', 'i18nextLng'];
const loadPreferredLanguage = async (): Promise<string | null> => {
  try {
    for (const k of LANG_KEYS) {
      const v = await AsyncStorage.getItem(k);
      const lang = (v ?? '').trim();
      if (lang) return lang;
    }
  } catch (e) {
    console.warn('[Auth] loadPreferredLanguage failed:', e);
  }
  return null;
};

export const useAuth = create<AuthState>((set, get) => ({
  userId: null,
  user: null,

  profile: null,
  password: null,

  accounts: [],
  activeIdentifier: null,

  phoneVerificationCode: null,
  resetCode: null,
  resetChannel: null,

  backendUserId: null,
  deviceId: null,

  hydrated: false,
  sessionActive: false,

  isSyncing: false,
  lastError: null,

  uiError: null,
  uiErrorField: null,
  prefillRegister: true,

  token: null,

  clearError: () => set({ lastError: null, uiError: null, uiErrorField: null }),

  register: async ({ fullName, email, phone, password }) => {
    const r = await get().saveProfile({ fullName, email, phone, password });
    if (r.ok) return { ok: true };
    return { ok: false, error: r.error || 'Kayıt oluşturulamadı.' };
  },

  login: async ({ identifier, password }) => {
    const r = await get().loginWithCredentials({ identifier, password });
    if (r.ok) return { ok: true };
    return { ok: false, error: r.error || 'Giriş yapılamadı.' };
  },

  clearUiError: () => set({ uiError: null, uiErrorField: null }),

  hydrate: async () => {
    try {
      // ✅ Dil tercihini en başta uygula (logout/switch sonrası TR’ye dönmesin)
      const preferredLang = await loadPreferredLanguage();
      if (preferredLang && i18n.language !== preferredLang) {
        try {
          await i18n.changeLanguage(preferredLang);
        } catch (e) {
          console.warn('[Auth] i18n.changeLanguage failed:', e);
        }
      }

      const saved = await storage.loadJson<any>(STORAGE_KEY);

      if (saved && typeof saved === 'object' && saved.version === 2) {
        const s = saved as StoredAuthV2;

        const storedDeviceId =
          typeof s.deviceId === 'string' && s.deviceId.trim().length ? s.deviceId.trim() : null;
        const deviceId = storedDeviceId ?? generateDeviceId();

        const prefillRegister = s.prefillRegister !== false;
        const accounts: StoredAccount[] = Array.isArray(s.accounts)
          ? s.accounts
              .map(a => ({
                identifier: String(a?.identifier ?? '').trim(),
                password: typeof a?.password === 'string' ? a.password : null,
                backendUserId: typeof a?.backendUserId === 'number' ? a.backendUserId : null,
                profile: normalizeStoredProfile(a?.profile ?? null),
                lastLoginAt: typeof a?.lastLoginAt === 'number' ? a.lastLoginAt : undefined,
                token: typeof (a as any)?.token === 'string' ? String((a as any).token) : null,
              }))
              .filter(a => a.identifier.length > 0)
          : [];

        const activeIdentifier =
          typeof s.activeIdentifier === 'string' && s.activeIdentifier.trim().length
            ? s.activeIdentifier.trim()
            : null;

        const activeAcc = activeIdentifier
          ? accounts.find(
              a => a.identifier.trim().toLowerCase() === activeIdentifier.trim().toLowerCase(),
            )
          : null;

        const sessionActive = !!activeAcc && s.sessionActive !== false;

        const profile = activeAcc?.profile ?? null;
        const password = activeAcc?.password ?? null;
        const backendUserId = activeAcc?.backendUserId ?? null;
        const token = (activeAcc?.token ?? null) as any;

        // ✅ Token’u API katmanına bas
        if (sessionActive && token) setAuthToken(token);
        else setAuthToken(null);

        const compatUser = sessionActive ? buildCompatUser(backendUserId, profile) : null;

        set({
          accounts,
          activeIdentifier,
          profile,
          password,
          backendUserId,
          deviceId,
          hydrated: true,
          sessionActive,
          isSyncing: false,
          lastError: null,
          uiError: null,
          uiErrorField: null,
          prefillRegister,
          user: compatUser,
          userId: sessionActive
            ? (profile?.displayName || profile?.fullName || profile?.email || null)
            : null,
          token: sessionActive ? token : null,
        });

        return;
      }

      // ✅ V1’den V2’ye göç (eski tek-profile yapın)
      if (saved && typeof saved === 'object' && ('profile' in saved || 'userId' in saved)) {
        const deviceId = generateDeviceId();

        const legacyProfile = normalizeStoredProfile((saved as any).profile ?? null);
        const legacyPassword =
          typeof (saved as any).password === 'string' ? (saved as any).password : null;
        const legacyBackendUserId =
          typeof (saved as any).backendUserId === 'number' ? (saved as any).backendUserId : null;

        const identifier = pickBestIdentifierForAccount(legacyProfile) || 'legacy';

        const accounts: StoredAccount[] = legacyProfile
          ? [
              {
                identifier,
                password: legacyPassword,
                backendUserId: legacyBackendUserId,
                profile: legacyProfile,
                lastLoginAt: Date.now(),
                token: null,
              },
            ]
          : [];

        const nextStore: StoredAuthV2 = {
          version: 2,
          accounts,
          activeIdentifier: accounts.length ? identifier : null,
          deviceId,
          sessionActive: false,
          prefillRegister: true,
        };
        storage.saveJson(STORAGE_KEY, nextStore);

        setAuthToken(null);

        set({
          accounts,
          activeIdentifier: nextStore.activeIdentifier,
          profile: legacyProfile,
          password: legacyPassword,
          backendUserId: legacyBackendUserId,
          deviceId,
          hydrated: true,
          sessionActive: false,
          isSyncing: false,
          lastError: null,
          uiError: null,
          uiErrorField: null,
          prefillRegister: true,
          user: null,
          userId: null,
          token: null,
        });

        return;
      }

      // ✅ Hiç kayıt yok
      const deviceId = generateDeviceId();
      const nextStore: StoredAuthV2 = {
        version: 2,
        accounts: [],
        activeIdentifier: null,
        deviceId,
        sessionActive: false,
        prefillRegister: true,
      };
      storage.saveJson(STORAGE_KEY, nextStore);

      setAuthToken(null);

      set({
        userId: null,
        user: null,
        profile: null,
        password: null,
        accounts: [],
        activeIdentifier: null,
        phoneVerificationCode: null,
        resetCode: null,
        resetChannel: null,
        backendUserId: null,
        deviceId,
        hydrated: true,
        sessionActive: false,
        isSyncing: false,
        lastError: null,
        uiError: null,
        uiErrorField: null,
        prefillRegister: true,
        token: null,
      });
    } catch (e: any) {
      console.warn('[Auth] hydrate failed:', e);
      set({ hydrated: true, lastError: String(e?.message ?? e) });
    }
  },

  init: async () => {
    await get().hydrate();
  },

  signIn: (uid: string) => {
    const trimmed = uid.trim();
    const finalName = trimmed || 'demo_kullanici';

    const now = Date.now();
    const profile: UserProfile = {
      fullName: finalName,
      email: '',
      phone: '',
      createdAt: now,
      isPhoneVerified: false,
      avatarUri: null,
      displayName: finalName,
      handle: null,
      bio: null,
      website: null,
    };

    // demo signIn -> token yok
    setAuthToken(null);

    set({
      userId: null,
      user: null,
      profile,
      sessionActive: false,
      uiError: null,
      uiErrorField: null,
      lastError: null,
      prefillRegister: true,
      token: null,
    });
  },

  // ✅ Register + backend (postRegister) - TOKEN’ı kaydet + setAuthToken
  saveProfile: async ({ fullName, email, phone, password, handle, bio, website }) => {
    const trimmedName = fullName.trim();
    const normalizedEmail = normalizeEmail(email);
    const cleanedPhone = cleanPhone(phone);
    const cleanedHandle = normalizeHandle(handle);
    const trimmedBio = bio?.trim() ?? '';
    const trimmedWebsite = website?.trim() ?? '';

    set({ uiError: null, uiErrorField: null });

    if (!trimmedName) return { ok: false, error: 'Ad Soyad boş olamaz.', field: null };
    if (!validateEmail(normalizedEmail))
      return { ok: false, error: 'Geçerli bir e-posta adresi gir.', field: 'email' };
    if (!cleanedPhone || cleanedPhone.length < 10)
      return { ok: false, error: 'Geçerli bir telefon numarası gir.', field: 'phone' };
    if (!isStrongPassword(password)) {
      return {
        ok: false,
        error: 'Şifre en az 8 karakter olmalı; büyük harf, küçük harf, rakam ve işaret içermeli.',
        field: 'password',
      };
    }
    if (!isValidHandle(cleanedHandle)) {
      return {
        ok: false,
        error:
          'Kullanıcı adı en az 3, en fazla 24 karakter olmalı; harf, rakam, alt çizgi veya nokta içerebilir.',
        field: null,
      };
    }

    const now = Date.now();
    const newProfile: UserProfile = {
      fullName: trimmedName,
      email: normalizedEmail,
      phone: cleanedPhone,
      createdAt: now,
      isPhoneVerified: false,
      avatarUri: null,

      displayName: trimmedName,

      handle: cleanedHandle ? cleanedHandle : null,
      bio: trimmedBio || null,
      website: trimmedWebsite || null,
    };

    set({
      profile: newProfile,
      password,
      sessionActive: false,
      isSyncing: true,
      lastError: null,
      uiError: null,
      uiErrorField: null,
      prefillRegister: true,
      userId: null,
      user: null,
      token: null,
    });

    try {
      let deviceId = get().deviceId;
      if (!deviceId) {
        deviceId = generateDeviceId();
        set({ deviceId });
      }

      const resp = await postRegister({
        fullName: newProfile.fullName,
        email: newProfile.email,
        phone: newProfile.phone,
        password,
        deviceId,
      });

      const userResp = resp.user;
      const token = resp.token;

      // ✅ Token’ı global API’ye bas
      if (token) setAuthToken(token);

      const backendUserId = Number(userResp.id);
      set({ backendUserId, token: token ?? null });

      let merged = newProfile;
      try {
        const me = await getMe(backendUserId);
        merged = (mergeProfileWithBackend(newProfile, me) ?? newProfile);
      } catch (e) {
        console.warn('[Auth] getMe after register failed:', e);
      }

      if (!merged.displayName || !String(merged.displayName).trim().length) {
        merged = { ...merged, displayName: merged.fullName };
      }

      try {
        const rawHandle = (merged.handle ?? '').toString().trim().replace(/^@+/, '');
        const willClearHandle = rawHandle.length === 0;

        const safeHandlePayload = willClearHandle
          ? { handle: null as string | null }
          : isValidHandle(rawHandle)
            ? { handle: rawHandle }
            : {};

        await putMe(backendUserId, {
          fullName: merged.fullName,
          ...safeHandlePayload,
          bio: merged.bio ?? null,
          website: merged.website ?? null,
          avatarUri: (merged.avatarUri ?? null) as any,
          email: merged.email,
          phone: merged.phone,
          displayName: merged.displayName ?? merged.fullName,
        } as any);
      } catch (e) {
        console.warn('[Auth] putMe after register failed:', e);
      }

      const identifier = merged.email || merged.phone;
      const nextAcc: StoredAccount = {
        identifier,
        password,
        backendUserId,
        profile: merged,
        lastLoginAt: Date.now(),
        token: token ?? null,
      };

      const accounts = upsertAccount(get().accounts, nextAcc);

      const nextStore: StoredAuthV2 = {
        version: 2,
        accounts,
        activeIdentifier: identifier,
        deviceId: get().deviceId,
        sessionActive: true,
        prefillRegister: true,
      };
      storage.saveJson(STORAGE_KEY, nextStore);

      const compatUser = buildCompatUser(backendUserId, merged);

      set({
        accounts,
        activeIdentifier: identifier,
        profile: merged,
        password,
        backendUserId,
        sessionActive: true,
        isSyncing: false,
        lastError: null,
        uiError: null,
        uiErrorField: null,
        prefillRegister: true,
        user: compatUser,
        userId: merged.displayName || merged.fullName || merged.email || null,
        token: token ?? null,
      });

      return { ok: true };
    } catch (e: any) {
      console.warn('[Auth] saveProfile backend register flow failed:', e);

      const parsed = parseBackendTakenError(e);
      if (parsed.message) {
        setAuthToken(null);
        set({
          sessionActive: false,
          userId: null,
          user: null,
          isSyncing: false,
          uiError: parsed.message,
          uiErrorField: parsed.field,
          lastError: null,
          token: null,
        });
        return { ok: false, error: parsed.message, field: parsed.field };
      }

      setAuthToken(null);
      set({
        sessionActive: false,
        userId: null,
        user: null,
        isSyncing: false,
        lastError: String(e?.message ?? e),
        uiError: 'Kayıt oluşturulamadı. Lütfen tekrar dene.',
        uiErrorField: null,
        token: null,
      });

      return { ok: false, error: 'Kayıt oluşturulamadı. Lütfen tekrar dene.', field: null };
    } finally {
      set({ isSyncing: false });
    }
  },

  // ✅ LOGIN (TOKEN)
  loginWithCredentials: async ({ identifier, password }) => {
    const id = normalizeIdentifier(identifier);
    const pwd = String(password ?? '');

    set({ uiError: null, uiErrorField: null, lastError: null });

    if (!id.length) {
      return { ok: false, error: 'E-posta veya telefon yazmalısın.', field: 'identifier' };
    }
    if (!pwd.length) {
      return { ok: false, error: 'Şifreni yazmalısın.', field: 'password' };
    }

    try {
      set({ isSyncing: true });

      const resp = await postLogin({ identifier: id, password: pwd });
      const userResp = resp.user;
      const token = resp.token;

      if (token) setAuthToken(token);

      const backendUserId = Number(userResp.id);

      let deviceId = get().deviceId;
      if (!deviceId) {
        deviceId = generateDeviceId();
        set({ deviceId });
      }

      let merged: UserProfile | null = null;
      try {
        const me = await getMe(backendUserId);
        merged = mergeProfileWithBackend(null, me);
      } catch (e) {
        merged = mergeProfileWithBackend(null, userResp);
      }

      const fallbackFullName = String((userResp as any).fullName ?? (userResp as any).displayName ?? 'Kullanıcı');

      const finalProfile: UserProfile = (merged ?? {
        fullName: fallbackFullName,
        email: String((userResp as any).email ?? ''),
        phone: String((userResp as any).phone ?? ''),
        createdAt: Date.now(),
        isPhoneVerified: !!(userResp as any).isPhoneVerified,
        avatarUri: (userResp as any).avatarUri ?? null,

        displayName: String((userResp as any).displayName ?? (userResp as any).fullName ?? fallbackFullName),

        handle: (userResp as any).handle ?? null,
        bio: (userResp as any).bio ?? null,
        website: (userResp as any).website ?? null,
      }) as UserProfile;

      if (!finalProfile.displayName || !String(finalProfile.displayName).trim().length) {
        finalProfile.displayName = finalProfile.fullName || fallbackFullName;
      }

      const normalizedId = isLikelyEmail(id)
        ? normalizeEmail(id)
        : isLikelyPhone(id)
          ? cleanPhone(id)
          : id;

      const nextAcc: StoredAccount = {
        identifier: normalizedId,
        password: pwd,
        backendUserId,
        profile: finalProfile,
        lastLoginAt: Date.now(),
        token: token ?? null,
      };

      const accounts = upsertAccount(get().accounts, nextAcc);

      const nextStore: StoredAuthV2 = {
        version: 2,
        accounts,
        activeIdentifier: normalizedId,
        deviceId,
        sessionActive: true,
        prefillRegister: true,
      };
      storage.saveJson(STORAGE_KEY, nextStore);

      const compatUser = buildCompatUser(backendUserId, finalProfile);

      set({
        accounts,
        activeIdentifier: normalizedId,
        profile: finalProfile,
        password: pwd,
        backendUserId,
        sessionActive: true,
        isSyncing: false,
        lastError: null,
        uiError: null,
        uiErrorField: null,
        prefillRegister: true,
        user: compatUser,
        userId: finalProfile.displayName || finalProfile.fullName || finalProfile.email || null,
        token: token ?? null,
      });

      return { ok: true };
    } catch (e: any) {
      console.warn('[Auth] loginWithCredentials failed:', e);

      const parsed = parseBackendTakenError(e);
      if (parsed.message) {
        setAuthToken(null);
        set({
          sessionActive: false,
          userId: null,
          user: null,
          isSyncing: false,
          uiError: parsed.message,
          uiErrorField: parsed.field ?? 'identifier',
          lastError: null,
          token: null,
        });
        return { ok: false, error: parsed.message, field: parsed.field ?? 'identifier' };
      }

      setAuthToken(null);
      set({
        sessionActive: false,
        userId: null,
        user: null,
        isSyncing: false,
        lastError: String(e?.message ?? e),
        uiError: 'Giriş yapılamadı. Bilgilerini kontrol et.',
        uiErrorField: 'identifier',
        token: null,
      });

      return { ok: false, error: 'Giriş yapılamadı. Bilgilerini kontrol et.', field: 'identifier' };
    } finally {
      set({ isSyncing: false });
    }
  },

  loginWithPassword: (password: string) => {
    const activeId = get().activeIdentifier;
    if (!activeId) {
      return { ok: false, error: 'Lütfen e-posta/telefon girerek giriş yap.' };
    }

    const acc = get().accounts.find(
      a => a.identifier.trim().toLowerCase() === activeId.trim().toLowerCase(),
    );

    if (!acc || !acc.profile || !acc.password) {
      return { ok: false, error: 'Bu hesap bu cihazda kayıtlı değil. E-posta/telefon ile giriş yap.' };
    }

    if (password !== acc.password) {
      return { ok: false, error: 'Şifre hatalı.' };
    }

    // ✅ Token varsa aktif et
    setAuthToken(acc.token ?? null);

    const compatUser = buildCompatUser(acc.backendUserId ?? null, acc.profile);

    set({
      profile: acc.profile,
      password: acc.password,
      backendUserId: acc.backendUserId ?? null,
      sessionActive: true,
      user: compatUser,
      userId: acc.profile.displayName || acc.profile.fullName || acc.profile.email || null,
      uiError: null,
      uiErrorField: null,
      lastError: null,
      prefillRegister: true,
      token: acc.token ?? null,
    });

    const nextStore: StoredAuthV2 = {
      version: 2,
      accounts: get().accounts,
      activeIdentifier: activeId,
      deviceId: get().deviceId,
      sessionActive: true,
      prefillRegister: true,
    };
    storage.saveJson(STORAGE_KEY, nextStore);

    return { ok: true };
  },

  requestPhoneCode: () => {
    const profile = get().profile;

    if (!profile || !profile.phone) {
      return { ok: false, error: 'Önce geçerli bir telefon numarası kaydetmelisin.' };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    set({ phoneVerificationCode: code });

    return { ok: true, code };
  },

  verifyPhoneCode: (code: string) => {
    const expected = get().phoneVerificationCode;
    const profile = get().profile;

    if (!profile) return { ok: false, error: 'Önce profil oluşturmalısın.' };
    if (!expected) return { ok: false, error: 'Aktif bir doğrulama kodu yok. Yeniden kod iste.' };
    if (code.trim() !== expected) return { ok: false, error: 'Doğrulama kodu hatalı.' };

    const updatedProfile: UserProfile = {
      ...profile,
      isPhoneVerified: true,
      displayName: profile.displayName ?? profile.fullName,
    };

    const compatUser = buildCompatUser(get().backendUserId, updatedProfile);

    set({
      profile: updatedProfile,
      user: compatUser,
      userId: get().sessionActive ? (updatedProfile.displayName || updatedProfile.fullName || updatedProfile.email || null) : null,
      phoneVerificationCode: null,
      lastError: null,
      uiError: null,
      uiErrorField: null,
    });

    const activeId = get().activeIdentifier;
    if (activeId) {
      const acc = get().accounts.find(a => a.identifier.trim().toLowerCase() === activeId.trim().toLowerCase());
      if (acc) {
        const accounts = upsertAccount(get().accounts, { ...acc, profile: updatedProfile });
        set({ accounts });

        const nextStore: StoredAuthV2 = {
          version: 2,
          accounts,
          activeIdentifier: activeId,
          deviceId: get().deviceId,
          sessionActive: get().sessionActive,
          prefillRegister: get().prefillRegister,
        };
        storage.saveJson(STORAGE_KEY, nextStore);
      }
    }

    const backendUserId = get().backendUserId;
    if (backendUserId && backendUserId > 0) {
      (async () => {
        try {
          set({ isSyncing: true });
          await putMe(backendUserId, {
            isPhoneVerified: true,
            phone: updatedProfile.phone,
          });
        } catch (e: any) {
          console.warn('[Auth] putMe failed (verifyPhoneCode):', e);
          set({ lastError: String(e?.message ?? e) });
        } finally {
          set({ isSyncing: false });
        }
      })();
    }

    return { ok: true };
  },

  requestPasswordReset: ({ via, value }) => {
    const v = via === 'email' ? normalizeEmail(value) : cleanPhone(value);

    const acc = get().accounts.find(a => {
      const id = a.identifier.trim().toLowerCase();
      if (via === 'email') return id === normalizeEmail(v);
      return cleanPhone(id) === cleanPhone(v);
    });

    if (!acc || !acc.profile) return { ok: false, error: 'Kayıtlı bir profil bulunamadı.' };

    const code = String(Math.floor(100000 + Math.random() * 900000));
    set({ resetCode: code, resetChannel: via });

    return { ok: true, code };
  },

  resetPassword: ({ code, newPassword }) => {
    const expected = get().resetCode;

    if (!expected) return { ok: false, error: 'Geçerli bir şifre sıfırlama kodu yok. Tekrar kod iste.' };
    if (code.trim() !== expected) return { ok: false, error: 'Şifre sıfırlama kodu hatalı.' };

    if (!isStrongPassword(newPassword)) {
      return {
        ok: false,
        error: 'Yeni şifre en az 8 karakter olmalı; büyük harf, küçük harf, rakam ve işaret içermeli.',
      };
    }

    const activeId = get().activeIdentifier;
    if (!activeId) return { ok: false, error: 'Önce giriş yapacağın hesabı seçmelisin (email/telefon).' };

    const acc = get().accounts.find(a => a.identifier.trim().toLowerCase() === activeId.trim().toLowerCase());
    if (!acc) return { ok: false, error: 'Hesap bulunamadı.' };

    const updatedAcc: StoredAccount = { ...acc, password: newPassword };
    const accounts = upsertAccount(get().accounts, updatedAcc);

    set({
      accounts,
      password: newPassword,
      resetCode: null,
      resetChannel: null,
      lastError: null,
      uiError: null,
      uiErrorField: null,
    });

    const nextStore: StoredAuthV2 = {
      version: 2,
      accounts,
      activeIdentifier: activeId,
      deviceId: get().deviceId,
      sessionActive: get().sessionActive,
      prefillRegister: get().prefillRegister,
    };
    storage.saveJson(STORAGE_KEY, nextStore);

    return { ok: true };
  },

  setAvatarUri: (uri: string | null) => {
    const current = get().profile;
    const now = Date.now();

    const updated: UserProfile = current
      ? { ...current, avatarUri: uri, displayName: current.displayName ?? current.fullName }
      : {
          fullName: 'Kullanıcı',
          email: '',
          phone: '',
          createdAt: now,
          isPhoneVerified: false,
          avatarUri: uri,
          displayName: 'Kullanıcı',
          handle: null,
          bio: null,
          website: null,
        };

    const compatUser = buildCompatUser(get().backendUserId, updated);

    set({
      profile: updated,
      user: compatUser,
      userId: get().sessionActive ? (updated.displayName || updated.fullName || updated.email || null) : null,
      lastError: null,
      uiError: null,
      uiErrorField: null,
    });

    const activeId = get().activeIdentifier;
    if (activeId) {
      const acc = get().accounts.find(a => a.identifier.trim().toLowerCase() === activeId.trim().toLowerCase());
      if (acc) {
        const accounts = upsertAccount(get().accounts, { ...acc, profile: updated });
        set({ accounts });

        const nextStore: StoredAuthV2 = {
          version: 2,
          accounts,
          activeIdentifier: activeId,
          deviceId: get().deviceId,
          sessionActive: get().sessionActive,
          prefillRegister: get().prefillRegister,
        };
        storage.saveJson(STORAGE_KEY, nextStore);
      }
    }

    const backendUserId = get().backendUserId;
    if (backendUserId && backendUserId > 0) {
      (async () => {
        try {
          set({ isSyncing: true });
          await putMe(backendUserId, { avatarUri: uri });
        } catch (e: any) {
          console.warn('[Auth] putMe failed (setAvatarUri):', e);
          set({ lastError: String(e?.message ?? e) });
        } finally {
          set({ isSyncing: false });
        }
      })();
    }
  },

  // ✅ Normal çıkış: token'ı da temizle
  signOut: () => {
    setAuthToken(null);

    set({
      userId: null,
      user: null,
      sessionActive: false,
      lastError: null,
      uiError: null,
      uiErrorField: null,
      phoneVerificationCode: null,
      resetCode: null,
      resetChannel: null,
      prefillRegister: true,
      token: null,
    });

    const nextStore: StoredAuthV2 = {
      version: 2,
      accounts: get().accounts,
      activeIdentifier: get().activeIdentifier,
      deviceId: get().deviceId,
      sessionActive: false,
      prefillRegister: get().prefillRegister,
    };
    storage.saveJson(STORAGE_KEY, nextStore);
  },

  // ✅ Kullanıcı değiştir: token temizle
  switchUser: () => {
    setAuthToken(null);

    set({
      userId: null,
      user: null,
      sessionActive: false,
      lastError: null,
      uiError: null,
      uiErrorField: null,
      phoneVerificationCode: null,
      resetCode: null,
      resetChannel: null,
      prefillRegister: false,
      activeIdentifier: null,
      profile: null,
      password: null,
      backendUserId: null,
      token: null,
    });

    const nextStore: StoredAuthV2 = {
      version: 2,
      accounts: get().accounts,
      activeIdentifier: null,
      deviceId: get().deviceId,
      sessionActive: false,
      prefillRegister: false,
    };
    storage.saveJson(STORAGE_KEY, nextStore);
  },

  // ✅ Yeni hesap oluştur: her şeyi temizle + token temizle
  startFreshAccount: async () => {
    const newDeviceId = generateDeviceId();

    setAuthToken(null);

    set({
      userId: null,
      user: null,
      profile: null,
      password: null,
      accounts: [],
      activeIdentifier: null,
      phoneVerificationCode: null,
      resetCode: null,
      resetChannel: null,
      backendUserId: null,
      deviceId: newDeviceId,
      hydrated: true,
      sessionActive: false,
      lastError: null,
      uiError: null,
      uiErrorField: null,
      isSyncing: false,
      prefillRegister: true,
      token: null,
    });

    const nextStore: StoredAuthV2 = {
      version: 2,
      accounts: [],
      activeIdentifier: null,
      deviceId: newDeviceId,
      sessionActive: false,
      prefillRegister: true,
    };
    storage.saveJson(STORAGE_KEY, nextStore);
  },
}));
