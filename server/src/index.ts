// C:\Users\Acer\viral_new\server\src\index.ts
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// ✅ EK: uploads + dosya upload için
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';

const prisma = new PrismaClient();
const app = express();

// ✅ Render/Proxy ortamlarında proto/host doğru gelsin (x-forwarded-proto)
app.set('trust proxy', 1);

// ✅ Prisma bağlantısını erken doğrula + düzgün kapat
prisma
  .$connect()
  .then(() => console.log('[PRISMA] connected'))
  .catch(e => console.error('[PRISMA] connect failed:', e));

const shutdown = async (signal: string) => {
  try {
    console.log(`[PRISMA] disconnecting (${signal})...`);
    await prisma.$disconnect();
    console.log('[PRISMA] disconnected');
  } catch (e) {
    console.error('[PRISMA] disconnect error:', e);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Orijin kısıtlarını gevşek bırakıyoruz, ileride prod ortamında sıkıştırırız.
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ✅ Request + Response logger (express.json'dan sonra koy)
app.use((req, res, next) => {
  const start = Date.now();

  // Request
  console.log(`[REQ] ${req.method} ${req.url}`);

  // Response (status + süre)
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[RES] ${req.method} ${req.url} -> ${res.statusCode} (${ms}ms)`);
  });

  next();
});

// ✅ Root route: telefonda http://IP:4000/ açınca bunu göreceksin
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'viral-server', time: new Date().toISOString() });
});

// -------------------- JWT (Token) --------------------

// ✅ Prod’da ENV’den ver: JWT_SECRET
const JWT_SECRET: string = String(process.env.JWT_SECRET || 'dev-secret-change-me');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

type JwtPayload = {
  sub: number; // userId
};

function signToken(userId: number) {
  return jwt.sign({ sub: userId } as JwtPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// req içine authUserId ekleyelim
declare global {
  namespace Express {
    interface Request {
      authUserId?: number | null;
    }
  }
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (!auth || typeof auth !== 'string') {
      req.authUserId = null;
      return next();
    }

    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m?.[1]) {
      req.authUserId = null;
      return next();
    }

    const token = m[1].trim();
    if (!token) {
      req.authUserId = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const sub = Number(decoded?.sub);
    if (Number.isFinite(sub) && sub > 0) {
      req.authUserId = sub;
    } else {
      req.authUserId = null;
    }

    return next();
  } catch (e) {
    // Token geçersiz/expired vs -> oturumu yok say
    req.authUserId = null;
    return next();
  }
}

// ✅ Her istekte token varsa çöz
app.use(authMiddleware);

// -------------------- Helpers --------------------

const parseUserIdFromReq = (req: express.Request): number | null => {
  // 0) JWT: Authorization Bearer <token>
  if (typeof req.authUserId === 'number' && Number.isFinite(req.authUserId) && req.authUserId > 0) {
    return req.authUserId;
  }

  // 1) Header: x-user-id
  const h = req.headers['x-user-id'];
  if (typeof h === 'string') {
    const n = Number(h);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 2) Query: ?userId=3
  const q = req.query.userId;
  if (typeof q === 'string') {
    const n = Number(q);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 3) Body: { userId: 3 }
  const b: any = (req.body ?? {}) as any;
  if (typeof b.userId === 'number' && Number.isFinite(b.userId) && b.userId > 0) {
    return b.userId;
  }

  return null;
};

const normalizeHandle = (raw: any): string | null => {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^@+/, '');
  if (!cleaned) return null;
  // 3–24 karakter: harf/rakam/._ (frontend ile uyumlu)
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(cleaned)) return null;
  return cleaned;
};

const normalizeEmail = (raw: any): string | null => {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (!e) return null;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(e)) return null;
  return e;
};

// ✅ TR telefon normalize (yayınlık sağlam çözüm)
// Kabul: 0532XXXXXXXX, +90532XXXXXXXX, 90532XXXXXXXX, 532XXXXXXXX
// Çıkış: 10 hane (532XXXXXXXX)
const normalizeTrPhone = (raw: any): string | null => {
  if (raw === undefined) return null;

  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;

  let local10 = digits;

  // 0XXXXXXXXXX (11 hane) => XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0')) {
    local10 = digits.slice(1);
  }
  // 90XXXXXXXXXX (12 hane) => XXXXXXXXXX
  else if (digits.length === 12 && digits.startsWith('90')) {
    local10 = digits.slice(2);
  }

  // artık 10 hane olmalı
  if (local10.length !== 10) return null;

  return local10;
};

// ✅ Login için telefon adayları üret (eski DB formatlarıyla eşleşme için)
function phoneCandidates(rawIdentifier: string): string[] {
  const digits = String(rawIdentifier ?? '').replace(/[^\d]/g, '');
  if (!digits) return [];

  const set = new Set<string>();

  // raw digits (DB geçmişte böyle kalmış olabilir)
  set.add(digits);

  // normalize 10 hane
  const local10 = normalizeTrPhone(digits);
  if (local10) {
    set.add(local10); // 532XXXXXXXX
    set.add('0' + local10); // 0532XXXXXXXX (eski kayıt)
    set.add('90' + local10); // 90532XXXXXXXX (eski kayıt)
  }

  return Array.from(set).filter(Boolean);
}

// 🌍 Desteklenen dil kodları
const SUPPORTED_LANGUAGES = ['tr', 'en', 'de', 'fr', 'es', 'pt', 'ar', 'hi', 'zh'];

const normalizeLanguage = (raw: any): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (!SUPPORTED_LANGUAGES.includes(v)) return undefined;
  return v;
};

// ✅ DB'de shareTargets string (JSON) saklanıyor olabilir.
// Feed endpoint'i "array" bekleyen RN tarafı için her zaman string[] döndürelim.
function safeParseStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string');
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.filter(x => typeof x === 'string');
    } catch {
      if (s.includes(',')) {
        return s
          .split(',')
          .map(x => x.trim())
          .filter(Boolean);
      }
    }
  }
  return [];
}

// -------------------- Uploads (Video/Avatar) Helpers --------------------

// ✅ Prod'da bunu ENV ile sabitleyebilirsin: https://api.viral.app
// Local testte otomatik req üzerinden üretiriz.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

function getPublicBaseUrl(req: express.Request): string {
  if (PUBLIC_BASE_URL && typeof PUBLIC_BASE_URL === 'string' && PUBLIC_BASE_URL.trim().length) {
    return PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}`;
}

function ensureUploadsDirs() {
  const root = path.join(process.cwd(), 'uploads');
  const videos = path.join(root, 'videos');
  const avatars = path.join(root, 'avatars');
  try {
    fs.mkdirSync(videos, { recursive: true });
    fs.mkdirSync(avatars, { recursive: true });
  } catch (e) {
    console.error('[UPLOADS] mkdir failed:', e);
  }
}
ensureUploadsDirs();

// ✅ Static yayın: /uploads/... artık tüm cihazlardan erişilebilir
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

function isLocalOnlyUri(uri: string): boolean {
  const u = String(uri || '').trim().toLowerCase();
  if (!u) return false;
  return (
    u.startsWith('file://') ||
    u.startsWith('content://') ||
    u.includes('/storage/') ||
    u.includes('sdcard/') ||
    u.startsWith('/data/')
  );
}

function toAbsoluteIfPath(req: express.Request, maybePathOrUrl: any): string | null {
  if (typeof maybePathOrUrl !== 'string') return null;
  const s = maybePathOrUrl.trim();
  if (!s) return null;
  // zaten full URL ise
  if (/^https?:\/\//i.test(s)) return s;
  // path ise (uploads altında bekliyoruz)
  if (s.startsWith('/uploads/')) {
    return `${getPublicBaseUrl(req)}${s}`;
  }
  return s;
}

// ✅ Multer storage'lar
const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads/videos')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4') || '.mp4';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads/avatars')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB örnek
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB örnek
});

// ✅ Video upload: client bunu çağıracak, dönüşte URL alacak
app.post('/uploads/video', uploadVideo.single('file'), async (req, res) => {
  try {
    const f = (req as any).file as Express.Multer.File | undefined;
    if (!f) {
      return res.status(400).json({ ok: false, error: 'no_file', message: 'file is required' });
    }

    const videoPath = `/uploads/videos/${f.filename}`;
    const videoUrl = `${getPublicBaseUrl(req)}${videoPath}`;

    return res.json({ ok: true, videoPath, videoUrl });
  } catch (e) {
    console.error('[POST /uploads/video] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ Avatar upload: client bunu çağıracak, dönüşte URL alacak
// Not: Mevcut client’ta avatar PUT /me ile gidiyorsa, burada dönen avatarPath'i PUT /me ile set edeceğiz.
app.post('/uploads/avatar', uploadAvatar.single('file'), async (req, res) => {
  try {
    const f = (req as any).file as Express.Multer.File | undefined;
    if (!f) {
      return res.status(400).json({ ok: false, error: 'no_file', message: 'file is required' });
    }

    const avatarPath = `/uploads/avatars/${f.filename}`;
    const avatarUrl = `${getPublicBaseUrl(req)}${avatarPath}`;

    return res.json({ ok: true, avatarPath, avatarUrl });
  } catch (e) {
    console.error('[POST /uploads/avatar] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ EK: Alias endpointler (client tarafında /upload/... kullanırsan da çalışsın)
// (Satır silmeden, sadece uyumluluk için ek)
app.post('/upload/video', uploadVideo.single('file'), async (req, res) => {
  try {
    const f = (req as any).file as Express.Multer.File | undefined;
    if (!f) {
      return res.status(400).json({ ok: false, error: 'no_file', message: 'file is required' });
    }
    const videoPath = `/uploads/videos/${f.filename}`;
    const videoUrl = `${getPublicBaseUrl(req)}${videoPath}`;
    return res.json({ ok: true, videoPath, videoUrl });
  } catch (e) {
    console.error('[POST /upload/video] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

app.post('/upload/avatar', uploadAvatar.single('file'), async (req, res) => {
  try {
    const f = (req as any).file as Express.Multer.File | undefined;
    if (!f) {
      return res.status(400).json({ ok: false, error: 'no_file', message: 'file is required' });
    }
    const avatarPath = `/uploads/avatars/${f.filename}`;
    const avatarUrl = `${getPublicBaseUrl(req)}${avatarPath}`;
    return res.json({ ok: true, avatarPath, avatarUrl });
  } catch (e) {
    console.error('[POST /upload/avatar] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ Client'e döndürdüğümüz user objesi tek yerde standardize olsun
function toPublicUser(u: any, req?: express.Request) {
  // avatarUri DB'de path (/uploads/...) veya full URL olabilir.
  const rawAvatar = u.avatarUri;
  const avatarUriRaw = typeof rawAvatar === 'string' ? rawAvatar : null;

  // ✅ avatarUri'yi absolute yap (req varsa)
  const avatarAbs = req && avatarUriRaw ? toAbsoluteIfPath(req, avatarUriRaw) : avatarUriRaw;

  // ✅ absolute URL alanı
  const avatarUrl = req && avatarUriRaw ? toAbsoluteIfPath(req, avatarUriRaw) : avatarUriRaw;

  return {
    id: u.id,
    deviceId: u.deviceId,
    displayName: u.fullName ?? 'Viral user',
    fullName: u.fullName,
    language: u.language,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    handle: u.handle,
    bio: u.bio,
    website: u.website,

    // ✅ geriye dönük uyum: artık absolute dönüyor
    avatarUri: avatarAbs ?? null,

    // ✅ yeni alan
    avatarUrl: avatarUrl ?? null,

    email: u.email,
    phone: u.phone,
    isPhoneVerified: u.isPhoneVerified,
  };
}

// ✅ Login için “where” üret: hiçbir şey normalize edilemezse null döndür
// ✅ Telefon için OR varyantlarıyla ara (DB geçmişi yüzünden “bulunamadı” hatasını bitirir)
function buildLoginWhere(identifierRaw: string): Prisma.UserWhereInput | null {
  const raw = String(identifierRaw ?? '').trim();
  if (!raw) return null;

  const emailNorm = normalizeEmail(raw);
  if (emailNorm) return { email: emailNorm };

  const phoneList = phoneCandidates(raw);
  if (phoneList.length) {
    return { OR: phoneList.map(p => ({ phone: p })) };
  }

  const handleNorm = normalizeHandle(raw);
  if (handleNorm) return { handle: handleNorm };

  return null;
}

// ✅ Prisma P2002 -> field mapping helper
function p2002FieldFromMeta(err: Prisma.PrismaClientKnownRequestError): string {
  const target = (err.meta as any)?.target as string[] | string | undefined;
  const t = Array.isArray(target) ? target : target ? [target] : [];
  if (t.includes('phone')) return 'phone';
  if (t.includes('email')) return 'email';
  if (t.includes('handle')) return 'handle';
  if (t.includes('deviceId')) return 'deviceId';
  return 'unknown';
}

// ✅ Focus Ağı: kanonik arkadaş çifti üret (küçük id -> büyük id)
function canonicalPair(a: number, b: number): { user1Id: number; user2Id: number } {
  const x = Number(a);
  const y = Number(b);
  return x < y ? { user1Id: x, user2Id: y } : { user1Id: y, user2Id: x };
}

async function areFriends(userAId: number, userBId: number): Promise<boolean> {
  const { user1Id, user2Id } = canonicalPair(userAId, userBId);
  const hit = await prisma.friendship.findUnique({
    where: { uniq_friendship_pair: { user1Id, user2Id } } as any,
    select: { id: true },
  });
  return !!hit;
}

// -------------------- Routes --------------------

// Basit health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'viral-server',
    time: new Date().toISOString(),
  });
});

// 🟢 Anonim login / kayıt
app.post('/auth/anonymous', async (req, res) => {
  try {
    const deviceIdRaw = req.body?.deviceId;
    const deviceId = typeof deviceIdRaw === 'string' && deviceIdRaw.trim().length ? deviceIdRaw.trim() : null;

    if (!deviceId) {
      return res.status(400).json({
        ok: false,
        error: 'deviceId-required',
        message: 'deviceId is required',
      });
    }

    const user = await prisma.user.upsert({
      where: { deviceId },
      update: {}, // aynı cihaz: aynı user
      create: {
        deviceId,
        language: null,
        fullName: null,
        handle: null,
        bio: null,
        website: null,
        avatarUri: null,
        email: null,
        phone: null,
        isPhoneVerified: false,
        passwordHash: null, // anonymous
      } as any,
    });

    // ✅ Token da dönelim (anon için de)
    const token = signToken(user.id);

    return res.json({
      ok: true,
      token,
      user: toPublicUser(user, req),
    });
  } catch (e) {
    console.error('[POST /auth/anonymous] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// 🟢 REGISTER: email/phone + password ile kayıt
// ✅ deviceId gelirse: sadece anonymous user convert edilir
// ✅ deviceId kayıtlı user ise: onu ezmez, yeni user yaratır (fallback)
app.post('/auth/register', async (req, res) => {
  try {
    const body = req.body ?? {};

    const fullName = typeof body.fullName === 'string' && body.fullName.trim().length ? body.fullName.trim() : null;

    const emailNorm = normalizeEmail(body.email);
    const phoneNorm = normalizeTrPhone(body.phone);
    const password = typeof body.password === 'string' ? body.password : '';

    const deviceId = typeof body.deviceId === 'string' && body.deviceId.trim().length ? body.deviceId.trim() : null;

    if (!fullName) {
      return res.status(400).json({
        ok: false,
        error: 'fullName-required',
        message: 'fullName is required',
      });
    }

    if (!emailNorm) {
      return res.status(400).json({
        ok: false,
        error: 'invalid-email',
        message: 'email is invalid',
      });
    }

    if (!phoneNorm) {
      return res.status(400).json({
        ok: false,
        error: 'invalid-phone',
        message: 'phone is invalid',
      });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'weak-password',
        message: 'password is too weak',
      });
    }

    // ✅ UNIQUE ön kontrol
    const emailOther = await prisma.user.findFirst({
      where: { email: emailNorm },
      select: { id: true },
    });

    if (emailOther) {
      return res.status(409).json({
        ok: false,
        error: 'email-taken',
        field: 'email',
        message: 'Bu e-posta başka bir hesapta kayıtlı.',
      });
    }

    const phoneOther = await prisma.user.findFirst({
      where: { phone: phoneNorm },
      select: { id: true },
    });

    if (phoneOther) {
      return res.status(409).json({
        ok: false,
        error: 'phone-taken',
        field: 'phone',
        message: 'Bu telefon numarası başka bir hesapta kayıtlı.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ deviceId geldiyse: SADECE anonymous ise convert et.
    if (deviceId) {
      const existing = await prisma.user.findUnique({ where: { deviceId } });

      if (existing) {
        const existingHash = (existing as any).passwordHash as string | null | undefined;

        // sadece anon user convert edilir
        if (!existingHash) {
          const updated = await prisma.user.update({
            where: { id: existing.id },
            data: {
              fullName,
              email: emailNorm,
              phone: phoneNorm,
              passwordHash,
              isPhoneVerified: false,
            } as any,
          });

          const token = signToken(updated.id);

          return res.json({ ok: true, token, user: toPublicUser(updated, req) });
        }

        // zaten kayıtlı user var → yeni user oluşturacağız (fallthrough)
      }
    }

    // ✅ deviceId yoksa veya o deviceId bulunamazsa create fallback
    const fallbackDeviceId = deviceId ?? `reg-${Date.now()}`;

    const user = await prisma.user.create({
      data: {
        deviceId: fallbackDeviceId,
        language: null,
        fullName,
        handle: null,
        bio: null,
        website: null,
        avatarUri: null,
        email: emailNorm,
        phone: phoneNorm,
        isPhoneVerified: false,
        passwordHash,
      } as any,
    });

    const token = signToken(user.id);

    return res.json({
      ok: true,
      token,
      user: toPublicUser(user, req),
    });
  } catch (err: any) {
    // ✅ Prisma unique constraint fallback (yarış koşulu vb.)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const field = p2002FieldFromMeta(err);
      return res.status(409).json({
        ok: false,
        error:
          field === 'phone'
            ? 'phone-taken'
            : field === 'email'
              ? 'email-taken'
              : field === 'handle'
                ? 'handle-taken'
                : field === 'deviceId'
                  ? 'deviceId-taken'
                  : 'unique-constraint',
        field,
        message:
          field === 'phone'
            ? 'Bu telefon numarası başka bir hesapta kayıtlı.'
            : field === 'email'
              ? 'Bu e-posta başka bir hesapta kayıtlı.'
              : field === 'handle'
                ? 'Bu kullanıcı adı başka bir hesapta kayıtlı.'
                : field === 'deviceId'
                  ? 'Bu cihaz kimliğiyle çakışma oldu. Tekrar dene.'
                  : 'Unique constraint failed',
      });
    }

    console.error('[POST /auth/register] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'server-error',
    });
  }
});

// 🟢 LOGIN: identifier(email/phone/handle) + password ile giriş
app.post('/auth/login', async (req, res) => {
  try {
    const body = req.body ?? {};
    const identifierRaw = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!identifierRaw) {
      return res.status(400).json({
        ok: false,
        error: 'identifier-required',
        message: 'identifier is required',
      });
    }

    if (!password) {
      return res.status(400).json({
        ok: false,
        error: 'password-required',
        message: 'password is required',
      });
    }

    const where = buildLoginWhere(identifierRaw);
    if (!where) {
      return res.status(400).json({
        ok: false,
        error: 'invalid-identifier',
        message: 'Lütfen e-posta, telefon numarası veya geçerli kullanıcı adı gir.',
      });
    }

    // ✅ Debug (server console): hangi where ile arıyoruz?
    console.log('[AUTH] login attempt', { identifierRaw, where });

    const user = await prisma.user.findFirst({ where });

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: 'not-found',
        message: 'Bu bilgilerle eşleşen bir hesap bulunamadı.',
      });
    }

    const hash = (user as any).passwordHash as string | null | undefined;
    if (!hash) {
      return res.status(400).json({
        ok: false,
        error: 'no-password',
        message: 'Bu hesapta şifre tanımlı değil. Lütfen yeniden kayıt ol.',
      });
    }

    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      return res.status(401).json({
        ok: false,
        error: 'wrong-password',
        message: 'Şifre hatalı.',
      });
    }

    const token = signToken(user.id);

    return res.json({
      ok: true,
      token,
      user: toPublicUser(user, req),
    });
  } catch (err) {
    console.error('[POST /auth/login] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'server-error',
    });
  }
});

// 🟢 ME: Profil oku
app.get('/me', async (req, res) => {
  try {
    const userId = parseUserIdFromReq(req);

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or query ?userId= or header x-user-id)',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: 'not-found',
        message: 'User not found',
      });
    }

    return res.json({
      ok: true,
      user: toPublicUser(user, req),
    });
  } catch (err) {
    console.error('[GET /me] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'server-error',
    });
  }
});

// 🟢 ME: Profil güncelle
app.put('/me', async (req, res) => {
  try {
    const userId = parseUserIdFromReq(req);

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or body.userId or query or header x-user-id)',
      });
    }

    const body = req.body ?? {};

    // Alanları güvenli normalize et
    const fullName =
      typeof body.fullName === 'string' && body.fullName.trim().length ? body.fullName.trim() : undefined;

    const language = normalizeLanguage(body.language);

    // ✅ HANDLE: geçersizse update'i bozma, ignore et
    let handleNorm: string | null | undefined = undefined;
    if (body.handle !== undefined) {
      const raw = String(body.handle ?? '').trim();

      if (!raw.length) {
        handleNorm = null; // temizle
      } else {
        const norm = normalizeHandle(raw);
        if (norm) {
          handleNorm = norm; // set
        } else {
          handleNorm = undefined; // geçersiz -> dokunma
        }
      }
    }

    const bio = typeof body.bio === 'string' ? (body.bio.trim().length ? body.bio.trim() : null) : undefined;

    const website =
      typeof body.website === 'string'
        ? body.website.trim().length
          ? body.website.trim()
          : null
        : undefined;

    // ✅ avatarUri artık ürün gibi olmalı:
    // - full URL (http/https) veya
    // - /uploads/avatars/... path
    // - local file/content/storage URI kabul etmiyoruz (diğer cihazda çalışmaz)
    const avatarUri =
      typeof body.avatarUri === 'string'
        ? body.avatarUri.trim().length
          ? body.avatarUri.trim()
          : null
        : undefined;

    if (typeof avatarUri === 'string' && avatarUri.length) {
      if (isLocalOnlyUri(avatarUri)) {
        return res.status(400).json({
          ok: false,
          error: 'avatar-local-uri-not-allowed',
          message: 'avatarUri must be a public URL or /uploads/... path (local uri not allowed)',
        });
      }
    }

    const emailNorm = body.email !== undefined ? normalizeEmail(body.email) : undefined;

    if (body.email !== undefined && emailNorm === null && String(body.email).trim().length) {
      return res.status(400).json({
        ok: false,
        error: 'invalid-email',
        message: 'email is invalid',
      });
    }

    // ✅ PHONE: TR normalize
    let phoneNorm: string | null | undefined = undefined;
    if (body.phone !== undefined) {
      const raw = String(body.phone ?? '').trim();

      if (!raw.length) {
        phoneNorm = null; // temizle
      } else {
        const normalized = normalizeTrPhone(raw);
        if (!normalized) {
          return res.status(400).json({
            ok: false,
            error: 'invalid-phone',
            message: 'phone is invalid',
          });
        }
        phoneNorm = normalized; // DB: 10 hane
      }
    }

    const isPhoneVerified = typeof body.isPhoneVerified === 'boolean' ? body.isPhoneVerified : undefined;

    // ✅ UNIQUE alanlar için ön kontrol
    if (typeof emailNorm === 'string' && emailNorm.length) {
      const other = await prisma.user.findFirst({
        where: { email: emailNorm, NOT: { id: userId } },
        select: { id: true },
      });
      if (other) {
        return res.status(409).json({
          ok: false,
          error: 'email-taken',
          field: 'email',
          message: 'Bu e-posta başka bir hesapta kayıtlı.',
        });
      }
    }

    if (typeof phoneNorm === 'string' && phoneNorm.length) {
      const other = await prisma.user.findFirst({
        where: { phone: phoneNorm, NOT: { id: userId } },
        select: { id: true },
      });
      if (other) {
        return res.status(409).json({
          ok: false,
          error: 'phone-taken',
          field: 'phone',
          message: 'Bu telefon numarası başka bir hesapta kayıtlı.',
        });
      }
    }

    if (typeof handleNorm === 'string' && handleNorm.length) {
      const other = await prisma.user.findFirst({
        where: { handle: handleNorm, NOT: { id: userId } },
        select: { id: true },
      });
      if (other) {
        return res.status(409).json({
          ok: false,
          error: 'handle-taken',
          field: 'handle',
          message: 'Bu kullanıcı adı başka bir hesapta kayıtlı.',
        });
      }
    }

    // ✅ LOG'u buraya taşıdık: artık 409 dönmeden log basmayacak
    console.log('[API] PUT /me', {
      userId,
      fullName,
      handle: handleNorm,
      language,
      hasBio: typeof bio !== 'undefined',
      hasWebsite: typeof website !== 'undefined',
      hasAvatar: typeof avatarUri !== 'undefined',
      email: emailNorm,
      phone: phoneNorm,
      isPhoneVerified,
    });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        fullName,
        language,
        handle: handleNorm, // undefined => dokunma, null => temizle, string => set
        bio,
        website,
        avatarUri,
        email: emailNorm, // undefined => dokunma, null => temizle
        phone: phoneNorm, // undefined => dokunma, null => temizle, string => set
        isPhoneVerified,
      },
    });

    return res.json({
      ok: true,
      user: toPublicUser(updated, req),
    });
  } catch (err: any) {
    // ✅ Prisma unique constraint fallback (PUT /me için)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const field = p2002FieldFromMeta(err);

      return res.status(409).json({
        ok: false,
        error:
          field === 'phone'
            ? 'phone-taken'
            : field === 'email'
              ? 'email-taken'
              : field === 'handle'
                ? 'handle-taken'
                : field === 'deviceId'
                  ? 'deviceId-taken'
                  : 'unique-constraint',
        field,
        message:
          field === 'phone'
            ? 'Bu telefon numarası başka bir hesapta kayıtlı.'
            : field === 'email'
              ? 'Bu e-posta başka bir hesapta kayıtlı.'
              : field === 'handle'
                ? 'Bu kullanıcı adı başka bir hesapta kayıtlı.'
                : field === 'deviceId'
                  ? 'Bu cihaz kimliğiyle çakışma oldu. Tekrar dene.'
                  : 'Unique constraint failed',
      });
    }

    console.error('[PUT /me] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'server-error',
    });
  }
});

// -------------------- Focus Ağı (Friend) API --------------------

// ✅ Kullanıcı ara (Focus Ağı keşfet): q = ad / handle / email / phone
// ÖNEMLİ: Zorla bağlama YOK. Sadece listeler.
// NOT: Prisma tarafında bazı DB sağlayıcılarında "mode: insensitive" desteklenmeyebilir.
// Bu yüzden "mode" kullanmıyoruz; patlamasın ve sonuç dönsün diye güvenli hale getiriyoruz.
app.get('/users/search', async (req, res) => {
  try {
    const meId = parseUserIdFromReq(req);

    const qRaw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limitRaw = typeof req.query.limit === 'string' ? req.query.limit : '';
    let limit = 30;
    if (limitRaw) {
      const n = parseInt(limitRaw, 10);
      if (!isNaN(n) && n > 0 && n <= 100) limit = n;
    }

    const qHandle = qRaw.replace(/^@+/, '');
    const qEmail = qRaw.toLowerCase();
    const qPhone = qRaw.replace(/[^\d]/g, '');

    // q boşsa: son kullanıcılar (keşfet)
    const where: Prisma.UserWhereInput = qRaw
      ? {
          OR: [
            { fullName: { contains: qRaw } },
            { handle: { contains: qHandle } },
            { email: { contains: qEmail } },
            ...(qPhone ? [{ phone: { contains: qPhone } }] : []),
          ],
        }
      : {};

    const users = await prisma.user.findMany({
      where: meId ? { AND: [where, { NOT: { id: meId } }] } : where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Me varsa: arkadaşlık / bekleyen durumlarını da dönelim (UI label için)
    let friendships: Set<string> = new Set();
    let outgoingPending: Set<string> = new Set();
    let incomingPending: Set<string> = new Set();

    if (meId) {
      const friendRows = await prisma.friendship.findMany({
        where: { OR: [{ user1Id: meId }, { user2Id: meId }] },
        select: { user1Id: true, user2Id: true },
      });

      friendships = new Set(friendRows.map(r => String(r.user1Id === meId ? r.user2Id : r.user1Id)));

      const outReq = await prisma.friendRequest.findMany({
        where: { fromUserId: meId, status: 'pending' },
        select: { toUserId: true },
      });
      outgoingPending = new Set(outReq.map(r => String(r.toUserId)));

      const inReq = await prisma.friendRequest.findMany({
        where: { toUserId: meId, status: 'pending' },
        select: { fromUserId: true },
      });
      incomingPending = new Set(inReq.map(r => String(r.fromUserId)));
    }

    const items = users.map(u => {
      const idStr = String(u.id);
      return {
        ...toPublicUser(u, req),
        relationship: !meId
          ? 'unknown'
          : friendships.has(idStr)
            ? 'friend'
            : incomingPending.has(idStr)
              ? 'incoming'
              : outgoingPending.has(idStr)
                ? 'outgoing'
                : 'none',
      };
    });

    return res.json({ ok: true, items });
  } catch (e) {
    console.error('[GET /users/search] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ Arkadaşlar listesi
app.get('/friends/list', async (req, res) => {
  try {
    const meId = parseUserIdFromReq(req);
    if (!meId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or query ?userId= or header x-user-id)',
      });
    }

    const rows = await prisma.friendship.findMany({
      where: { OR: [{ user1Id: meId }, { user2Id: meId }] },
      orderBy: { createdAt: 'desc' },
    });

    const friendIds = rows.map(r => (r.user1Id === meId ? r.user2Id : r.user1Id));
    if (!friendIds.length) return res.json({ ok: true, items: [] });

    const users = await prisma.user.findMany({
      where: { id: { in: friendIds } },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ ok: true, items: users.map(u => toPublicUserWithAvatar(u, req)) });
  } catch (e) {
    console.error('[GET /friends/list] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ Bana gelen (pending) istekler
app.get('/friends/requests', async (req, res) => {
  try {
    const meId = parseUserIdFromReq(req);
    if (!meId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or query ?userId= or header x-user-id)',
      });
    }

    const reqs = await prisma.friendRequest.findMany({
      where: { toUserId: meId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const fromIds = reqs.map(r => r.fromUserId);
    const fromUsers = fromIds.length ? await prisma.user.findMany({ where: { id: { in: fromIds } } }) : [];

    const byId = new Map<number, any>();
    for (const u of fromUsers) byId.set(u.id, u);

    const items = reqs.map(r => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      fromUser: byId.get(r.fromUserId) ? toPublicUser(byId.get(r.fromUserId), req) : null,
    }));

    return res.json({ ok: true, items });
  } catch (e) {
    console.error('[GET /friends/requests] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ İstek gönder (zorla arkadaş yapmaz!)
app.post('/friends/request', async (req, res) => {
  try {
    const meId = parseUserIdFromReq(req);
    if (!meId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or query ?userId= or header x-user-id)',
      });
    }

    const toUserIdRaw = (req.body ?? {}).toUserId;
    const toUserId = Number(toUserIdRaw);

    if (!Number.isFinite(toUserId) || toUserId <= 0) {
      return res.status(400).json({ ok: false, error: 'toUserId-invalid' });
    }
    if (toUserId === meId) {
      return res.status(400).json({ ok: false, error: 'self-request' });
    }

    const toUser = await prisma.user.findUnique({ where: { id: toUserId } });
    if (!toUser) return res.status(404).json({ ok: false, error: 'user-not-found' });

    // Zaten arkadaş mı?
    if (await areFriends(meId, toUserId)) {
      return res.json({ ok: true, status: 'already-friends' });
    }

    const existingOutgoing = await prisma.friendRequest.findFirst({
      where: { fromUserId: meId, toUserId, status: 'pending' },
      select: { id: true },
    });
    if (existingOutgoing) {
      return res.json({ ok: true, status: 'already-pending', requestId: existingOutgoing.id });
    }

    const existingIncoming = await prisma.friendRequest.findFirst({
      where: { fromUserId: toUserId, toUserId: meId, status: 'pending' },
      select: { id: true },
    });
    if (existingIncoming) {
      return res.json({ ok: true, status: 'incoming-exists', requestId: existingIncoming.id });
    }

    const created = await prisma.friendRequest.create({
      data: {
        fromUserId: meId,
        toUserId,
        status: 'pending',
      },
    });

    return res.json({ ok: true, status: 'pending', requestId: created.id });
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (msg.toLowerCase().includes('uniq_active_request')) {
      return res.json({ ok: true, status: 'already-pending' });
    }

    console.error('[POST /friends/request] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ İstek kabul
app.post('/friends/accept', async (req, res) => {
  try {
    const meId = parseUserIdFromReq(req);
    if (!meId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or query ?userId= or header x-user-id)',
      });
    }

    const requestIdRaw = (req.body ?? {}).requestId;
    const requestId = Number(requestIdRaw);

    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ ok: false, error: 'requestId-invalid' });
    }

    const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!fr) return res.status(404).json({ ok: false, error: 'request-not-found' });

    if (fr.toUserId !== meId) {
      return res.status(403).json({ ok: false, error: 'not-allowed' });
    }

    if (fr.status !== 'pending') {
      return res.json({ ok: true, status: fr.status });
    }

    const { user1Id, user2Id } = canonicalPair(fr.fromUserId, fr.toUserId);

    await prisma.$transaction([
      prisma.friendRequest.update({
        where: { id: fr.id },
        data: { status: 'accepted' },
      }),
      prisma.friendship.upsert({
        where: { uniq_friendship_pair: { user1Id, user2Id } } as any,
        update: {},
        create: { user1Id, user2Id },
      }),
    ]);

    return res.json({ ok: true, status: 'accepted' });
  } catch (e) {
    console.error('[POST /friends/accept] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ İstek reddet
app.post('/friends/decline', async (req, res) => {
  try {
    const meId = parseUserIdFromReq(req);
    if (!meId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or query ?userId= or header x-user-id)',
      });
    }

    const requestIdRaw = (req.body ?? {}).requestId;
    const requestId = Number(requestIdRaw);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ ok: false, error: 'requestId-invalid' });
    }

    const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!fr) return res.status(404).json({ ok: false, error: 'request-not-found' });
    if (fr.toUserId !== meId) return res.status(403).json({ ok: false, error: 'not-allowed' });

    if (fr.status !== 'pending') return res.json({ ok: true, status: fr.status });

    await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: 'declined' },
    });

    return res.json({ ok: true, status: 'declined' });
  } catch (e) {
    console.error('[POST /friends/decline] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

function toPublicUserWithAvatar(u: any, req: any) {
  const base = toPublicUser(u, req);
  return {
    ...base,
    // ✅ avatarUri zaten absolute; yine de null-safe
    avatarUri: base.avatarUri ?? null,
    avatarUrl: base.avatarUrl ?? null,
  };
}

// (Opsiyonel) ✅ Arkadaşlıktan çıkar
app.post('/friends/remove', async (req, res) => {
  try {
    const meId = parseUserIdFromReq(req);
    if (!meId) {
      return res.status(400).json({
        ok: false,
        error: 'userId-required',
        message: 'userId is required (token or query ?userId= or header x-user-id)',
      });
    }

    const otherIdRaw = (req.body ?? {}).otherUserId;
    const otherUserId = Number(otherIdRaw);

    if (!Number.isFinite(otherUserId) || otherUserId <= 0) {
      return res.status(400).json({ ok: false, error: 'otherUserId-invalid' });
    }
    if (otherUserId === meId) return res.status(400).json({ ok: false, error: 'self-remove' });

    const { user1Id, user2Id } = canonicalPair(meId, otherUserId);

    await prisma.friendship.deleteMany({
      where: { user1Id, user2Id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /friends/remove] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// -------------------- Posts / Feed --------------------

// 🟢 Kart oluşturma – UploadScreen'den gelen /posts isteği
app.post('/posts', async (req, res) => {
  try {
    const { taskTitle, note, author, isFreePost, shareTargets, videoUri, createdAt, userId } = req.body ?? {};

    console.log('[API] POST /posts {');
    console.log('  taskTitle   :', taskTitle);
    console.log('  note        :', note);
    console.log('  author      :', author);
    console.log('  isFreePost  :', isFreePost);
    console.log('  shareTargets:', shareTargets);
    console.log('  videoUri    :', videoUri);
    console.log('  createdAt   :', createdAt);
    console.log('  userId      :', userId);
    console.log('}');

    if (!author || typeof author !== 'string' || author.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'author-required',
        message: 'author is required',
      });
    }

    let shareTargetsJson: string | null = null;
    if (Array.isArray(shareTargets)) {
      try {
        shareTargetsJson = JSON.stringify(shareTargets);
      } catch {
        shareTargetsJson = null;
      }
    } else if (typeof shareTargets === 'string') {
      shareTargetsJson = shareTargets;
    }

    let createdAtDate: Date | undefined;
    if (typeof createdAt === 'string') {
      const d = new Date(createdAt);
      if (!isNaN(d.getTime())) {
        createdAtDate = d;
      }
    }

    // ✅ user bağlama: öncelik token (req.authUserId)
    const tokenUserId =
      typeof req.authUserId === 'number' && Number.isFinite(req.authUserId) && req.authUserId > 0
        ? req.authUserId
        : null;

    const bodyUserId = typeof userId === 'number' && Number.isFinite(userId) ? userId : null;

    const effectiveUserId = tokenUserId ?? bodyUserId;

    let userConnect: { connect: { id: number } } | undefined;
    if (typeof effectiveUserId === 'number' && Number.isFinite(effectiveUserId) && effectiveUserId > 0) {
      userConnect = { connect: { id: effectiveUserId } };
    }

    const freePost = typeof isFreePost === 'boolean' ? isFreePost : true;

    // ✅ Ürün gibi: local video uri DB’ye yazılmamalı (başka telefonda çalışmaz)
    let safeVideoUri: string | null = null;
    if (typeof videoUri === 'string' && videoUri.trim().length) {
      const v = videoUri.trim();
      if (isLocalOnlyUri(v)) {
        safeVideoUri = null; // lokal -> yok say
      } else {
        // /uploads/... veya http(s) olabilir
        safeVideoUri = v;
      }
    }

    const post = await prisma.post.create({
      data: {
        taskTitle: typeof taskTitle === 'string' && taskTitle.trim().length ? taskTitle : null,
        note: typeof note === 'string' && note.trim().length ? note : null,
        author: author.trim(),
        isFreePost: freePost,
        shareTargets: shareTargetsJson,
        videoUri: safeVideoUri,
        createdAt: createdAtDate,
        user: userConnect,
      },
    });

    return res.json({
      ok: true,
      post,
    });
  } catch (err) {
    console.error('[POST /posts] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'server-error',
    });
  }
});

// 🟢 Kart listesi – akış için basit endpoint
app.get('/posts', async (req, res) => {
  try {
    const limitRaw = req.query.limit;
    let limit = 50;

    if (typeof limitRaw === 'string') {
      const parsed = parseInt(limitRaw, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 200) {
        limit = parsed;
      }
    }

    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const normalized = posts.map(p => {
      let shareTargetsParsed: string[] | null = null;
      if (p.shareTargets) {
        try {
          const arr = JSON.parse(p.shareTargets);
          if (Array.isArray(arr)) {
            shareTargetsParsed = arr;
          }
        } catch {
          shareTargetsParsed = null;
        }
      }

      return {
        ...p,
        shareTargets: shareTargetsParsed,
      };
    });

    return res.json({
      ok: true,
      items: normalized,
    });
  } catch (err) {
    console.error('[GET /posts] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'server-error',
    });
  }
});

// ✅ FEED
app.get('/feed', async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,

      // ✅ KRİTİK: post'un bağlı olduğu user'ı da al
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            handle: true,
            avatarUri: true,
          },
        },
      },
    });

    const normalized = posts.map(p => {
      const anyP: any = p as any;

      // ✅ author alanı boş/eskiden farklı kaydedilmiş olabilir → fallback yap
      const authorName =
        typeof anyP.author === 'string' && anyP.author.trim().length
          ? anyP.author.trim()
          : (p as any)?.user?.fullName || (p as any)?.user?.handle || 'misafir';

      // ✅ Avatar: DB'deki avatarUri path veya URL olabilir -> feed'e mutlaka URL verelim
      const rawAvatar = (p as any)?.user?.avatarUri ?? null;
      const authorAvatarUrl = rawAvatar ? toAbsoluteIfPath(req, rawAvatar) : null;

      // ✅ Video: DB'deki videoUri /uploads path ise absolute yap
      // ✅ Local uri ise (eski kayıtlar) ürün gibi davranış: diğer cihazda çalışmaz, null'a düş
      let safeVideoOut: string | null = null;
      if (typeof anyP.videoUri === 'string' && anyP.videoUri.trim().length) {
        const vv = anyP.videoUri.trim();
        safeVideoOut = isLocalOnlyUri(vv) ? null : toAbsoluteIfPath(req, vv);
      }

      return {
        // Prisma include ile gelen "user" objesini client'a basmak zorunda değiliz.
        // O yüzden payload'da user'ı kaldırıp sadece lazım olanları ekliyoruz.
        ...anyP,
        user: undefined,

        author: authorName,

        // ✅ KRİTİK: diğer kullanıcıların avatarı buradan gelecek
        authorAvatarUri: authorAvatarUrl ?? null,
        authorAvatarUrl: authorAvatarUrl ?? null, // ✅ ek alan (istersen client buna geçer)

        // ✅ videoUri normalize
        videoUri: safeVideoOut,

        // ✅ userId zaten post'ta var ama garanti olsun diye set edelim
        userId: anyP.userId ?? (p as any)?.user?.id ?? null,

        // ✅ shareTargets her zaman string[] olsun
        shareTargets: safeParseStringArray(anyP.shareTargets),
      };
    });

    return res.json(normalized);
  } catch (err) {
    console.error('[feed] error:', err);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ FEED: Tek post sil
app.delete('/feed/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'id-invalid',
        message: 'id is invalid',
      });
    }

    await prisma.post.delete({ where: { id } });

    return res.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.message ?? '');
    if (msg.toLowerCase().includes('record') && msg.toLowerCase().includes('does not exist')) {
      return res.status(404).json({ ok: false, error: 'not-found' });
    }

    console.error('[DELETE /feed/:id] error:', err);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// Varsayılan port 4000
const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] Listening on http://0.0.0.0:${PORT}`);
});
