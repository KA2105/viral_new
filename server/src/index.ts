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
import nodemailer from 'nodemailer';

const prisma = new PrismaClient();
const app = express();

console.log('[BOOT] src/index.ts loaded at', new Date().toISOString());

// ✅ Render/Proxy ortamlarında proto/host doğru gelsin (x-forwarded-proto)
app.set('trust proxy', 1);

// ✅ KRİTİK: 304/ETag davranışını kapat (feed’in her zaman güncel JSON dönmesi için)
app.set('etag', false);

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
// Not: TS overload sapmasın diye tipe netlik veriyoruz.
const JWT_SECRET: string = (process.env.JWT_SECRET ?? 'dev-secret-change-me').toString();
const JWT_EXPIRES_IN: string = (process.env.JWT_EXPIRES_IN ?? '30d').toString();

type JwtPayload = {
  sub: number; // userId
};

function signToken(userId: number) {
  const options: jwt.SignOptions = { expiresIn: JWT_EXPIRES_IN as any };
  return jwt.sign({ sub: userId } as JwtPayload, JWT_SECRET, options);
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

  // 3) Body: { userId: 3 } veya { userId: "3" }
  const b: any = (req.body ?? {}) as any;
  if (typeof b.userId === 'number') {
    const n = Number(b.userId);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof b.userId === 'string') {
    const n = Number(b.userId.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
};

function requireUserId(req: express.Request, res: express.Response): number | null {
  let userId = parseUserIdFromReq(req);

  // body.userId (bazı clientlar buradan gönderir)
  if (!userId && req.body?.userId !== undefined) {
    const parsed = Number(req.body.userId);
    if (Number.isFinite(parsed) && parsed > 0) userId = parsed;
  }

  // ✅ Controlled fallback (ENV ile)
  const allowFallback =
    String(process.env.ALLOW_DEV_FALLBACK_USERID ?? '').toLowerCase() === 'true' ||
    String(process.env.ALLOW_DEV_FALLBACK_USERID ?? '') === '1';

  if (!userId && allowFallback) {
    const fbRaw = process.env.DEV_FALLBACK_USERID ?? '1';
    const fb = Number(fbRaw);
    if (Number.isFinite(fb) && fb > 0) {
      console.warn(`[requireUserId] ⚠️ Fallback userId=${fb} used (ALLOW_DEV_FALLBACK_USERID enabled)`);
      userId = fb;
    }
  }

  if (!userId) {
    res.status(400).json({
      ok: false,
      error: 'userId-required',
      message: 'userId is required (token or header x-user-id or query ?userId= or body.userId)',
    });
    return null;
  }

  return userId;
}

const normalizeHandle = (raw: any): string | null => {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^@+/, '');
  if (!cleaned) return null;
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

const normalizeTrPhone = (raw: any): string | null => {
  if (raw === undefined) return null;

  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;

  let local10 = digits;

  if (digits.length === 11 && digits.startsWith('0')) {
    local10 = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('90')) {
    local10 = digits.slice(2);
  }

  if (local10.length !== 10) return null;

  return local10;
};

function phoneCandidates(rawIdentifier: string): string[] {
  const digits = String(rawIdentifier ?? '').replace(/[^\d]/g, '');
  if (!digits) return [];

  const set = new Set<string>();
  set.add(digits);

  const local10 = normalizeTrPhone(digits);
  if (local10) {
    set.add(local10);
    set.add('0' + local10);
    set.add('90' + local10);
  }

  return Array.from(set).filter(Boolean);
}

const SUPPORTED_LANGUAGES = ['tr', 'en', 'de', 'fr', 'es', 'pt', 'ar', 'hi', 'zh'];

const normalizeLanguage = (raw: any): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (!SUPPORTED_LANGUAGES.includes(v)) return undefined;
  return v;
};

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
  const videos = path.join(root, 'uploads/videos');
  const avatars = path.join(root, 'uploads/avatars');
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
  if (/^https?:\/\//i.test(s)) return s;
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
  limits: { fileSize: 300 * 1024 * 1024 },
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 12 * 1024 * 1024 },
});

// ✅ Video upload
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

// ✅ Avatar upload
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

// ✅ Alias endpointler
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
  const rawAvatar = u.avatarUri;
  const avatarUriRaw = typeof rawAvatar === 'string' ? rawAvatar : null;

  const avatarAbs = req && avatarUriRaw ? toAbsoluteIfPath(req, avatarUriRaw) : avatarUriRaw;
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
    avatarUri: avatarAbs ?? null,
    avatarUrl: avatarUrl ?? null,
    email: u.email,
    phone: u.phone,
    isPhoneVerified: u.isPhoneVerified,
  };
}

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

function p2002FieldFromMeta(err: Prisma.PrismaClientKnownRequestError): string {
  const target = (err.meta as any)?.target as string[] | string | undefined;
  const t = Array.isArray(target) ? target : target ? [target] : [];
  if (t.includes('phone')) return 'phone';
  if (t.includes('email')) return 'email';
  if (t.includes('handle')) return 'handle';
  if (t.includes('deviceId')) return 'deviceId';
  if (t.includes('token')) return 'token';
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

function toPublicUserWithAvatar(u: any, req: any) {
  const base = toPublicUser(u, req);
  return {
    ...base,
    avatarUri: base.avatarUri ?? null,
    avatarUrl: base.avatarUrl ?? null,
  };
}

// -------------------- Password Reset Helpers --------------------

const RESET_PASSWORD_BASE_URL = (process.env.RESET_PASSWORD_BASE_URL ?? '').toString().trim();

const smtpHost = (process.env.SMTP_HOST ?? '').toString().trim();
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpUser = (process.env.SMTP_USER ?? '').toString().trim();
const smtpPass = (process.env.SMTP_PASS ?? '').toString().trim();
const smtpFrom = (process.env.SMTP_FROM ?? smtpUser).toString().trim();

const mailer =
  smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      })
    : null;

async function sendResetPasswordEmail(to: string, resetUrl: string) {
  if (!mailer) {
    console.log('[RESET PASSWORD][DEV LINK]', { to, resetUrl });
    return;
  }

  await mailer.sendMail({
    from: smtpFrom,
    to,
    subject: 'Viral şifre sıfırlama',
    text:
      `Şifreni sıfırlamak için aşağıdaki bağlantıyı kullan:\n\n` +
      `${resetUrl}\n\n` +
      `Bu bağlantı 15 dakika geçerlidir.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Viral şifre sıfırlama</h2>
        <p>Şifreni sıfırlamak için aşağıdaki bağlantıyı kullan:</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#E50914;color:#fff;text-decoration:none;border-radius:8px;">
            Şifreyi sıfırla
          </a>
        </p>
        <p>Bağlantı çalışmazsa bunu kopyala:</p>
        <p>${resetUrl}</p>
        <p>Bu bağlantı 15 dakika geçerlidir.</p>
      </div>
    `,
  });
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
      update: {},
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
        passwordHash: null,
      } as any,
    });

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

// 🟢 REGISTER
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

    if (deviceId) {
      const existing = await prisma.user.findUnique({ where: { deviceId } });

      if (existing) {
        const existingHash = (existing as any).passwordHash as string | null | undefined;

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
      }
    }

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
                  : field === 'token'
                    ? 'token-taken'
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
                  : field === 'token'
                    ? 'Token çakışması oldu. Tekrar dene.'
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

// 🟢 LOGIN
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

// 🟢 FORGOT PASSWORD (ilk sürüm: sadece email aktif)
app.post('/auth/forgot-password', async (req, res) => {
  try {
    const body = req.body ?? {};
    const identifierRaw = typeof body.identifier === 'string' ? body.identifier.trim() : '';

    if (!identifierRaw) {
      return res.status(400).json({
        ok: false,
        error: 'identifier-required',
        message: 'identifier is required',
      });
    }

    const emailNorm = normalizeEmail(identifierRaw);

    // Şimdilik telefon reset aktif değil
    if (!emailNorm) {
      return res.json({
        ok: true,
        message: 'Telefon ile şifre sıfırlama yakında aktif olacak. Lütfen e-posta kullan.',
      });
    }

    const user = await prisma.user.findFirst({
      where: { email: emailNorm },
      select: {
        id: true,
        email: true,
      },
    });

    // Güvenlik: kullanıcı olmasa bile aynı cevap
    if (!user?.email) {
      return res.json({
        ok: true,
        message: 'Hesap varsa sıfırlama bağlantısı gönderildi.',
      });
    }

    // Eski kullanılmamış tokenları temizle
    await prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    const baseUrl = RESET_PASSWORD_BASE_URL || `${getPublicBaseUrl(req)}/reset-password`;
    const resetUrl = `${baseUrl}?token=${encodeURIComponent(token)}`;

    await sendResetPasswordEmail(user.email, resetUrl);

    return res.json({
      ok: true,
      message: 'Hesap varsa sıfırlama bağlantısı gönderildi.',
    });
  } catch (err) {
    console.error('[POST /auth/forgot-password] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'server-error',
    });
  }
});

// 🟢 RESET PASSWORD
app.post('/auth/reset-password', async (req, res) => {
  try {
    const body = req.body ?? {};
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!token || !newPassword) {
      return res.status(400).json({
        ok: false,
        error: 'missing-fields',
        message: 'token and newPassword are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'weak-password',
        message: 'password must be at least 8 characters',
      });
    }

    const resetRow = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: {
        user: true,
      },
    });

    if (!resetRow) {
      return res.status(400).json({
        ok: false,
        error: 'invalid-token',
        message: 'Geçersiz sıfırlama bağlantısı.',
      });
    }

    if (resetRow.usedAt) {
      return res.status(400).json({
        ok: false,
        error: 'token-used',
        message: 'Bu sıfırlama bağlantısı daha önce kullanılmış.',
      });
    }

    if (resetRow.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        ok: false,
        error: 'token-expired',
        message: 'Sıfırlama bağlantısının süresi dolmuş.',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRow.userId },
        data: {
          passwordHash,
        },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetRow.id },
        data: {
          usedAt: new Date(),
        },
      }),
      prisma.passwordResetToken.deleteMany({
        where: {
          userId: resetRow.userId,
          id: { not: resetRow.id },
        },
      }),
    ]);

    return res.json({
      ok: true,
      message: 'Şifren başarıyla güncellendi.',
    });
  } catch (err) {
    console.error('[POST /auth/reset-password] error:', err);
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

    const fullName =
      typeof body.fullName === 'string' && body.fullName.trim().length ? body.fullName.trim() : undefined;

    const language = normalizeLanguage(body.language);

    let handleNorm: string | null | undefined = undefined;
    if (body.handle !== undefined) {
      const raw = String(body.handle ?? '').trim();

      if (!raw.length) {
        handleNorm = null;
      } else {
        const norm = normalizeHandle(raw);
        if (norm) {
          handleNorm = norm;
        } else {
          handleNorm = undefined;
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

    let phoneNorm: string | null | undefined = undefined;
    if (body.phone !== undefined) {
      const raw = String(body.phone ?? '').trim();

      if (!raw.length) {
        phoneNorm = null;
      } else {
        const normalized = normalizeTrPhone(raw);
        if (!normalized) {
          return res.status(400).json({
            ok: false,
            error: 'invalid-phone',
            message: 'phone is invalid',
          });
        }
        phoneNorm = normalized;
      }
    }

    const isPhoneVerified = typeof body.isPhoneVerified === 'boolean' ? body.isPhoneVerified : undefined;

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
        handle: handleNorm,
        bio,
        website,
        avatarUri,
        email: emailNorm,
        phone: phoneNorm,
        isPhoneVerified,
      },
    });

    return res.json({
      ok: true,
      user: toPublicUser(updated, req),
    });
  } catch (err: any) {
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
// (BURASI DEĞİŞMEDİ - aynen bıraktım)

// ✅ Kullanıcı ara (Focus Ağı keşfet): q = ad / handle / email / phone
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

    const tokenUserId =
      typeof req.authUserId === 'number' && Number.isFinite(req.authUserId) && req.authUserId > 0
        ? req.authUserId
        : null;

    const bodyUserId =
      typeof userId === 'number'
        ? userId
        : typeof userId === 'string'
          ? Number(String(userId).trim())
          : null;

    const effectiveUserId = tokenUserId ?? (Number.isFinite(bodyUserId as any) ? (bodyUserId as any) : null);

    let userConnect: { connect: { id: number } } | undefined;
    if (typeof effectiveUserId === 'number' && Number.isFinite(effectiveUserId) && effectiveUserId > 0) {
      userConnect = { connect: { id: effectiveUserId } };
    }

    const freePost = typeof isFreePost === 'boolean' ? isFreePost : true;

    let safeVideoUri: string | null = null;
    if (typeof videoUri === 'string' && videoUri.trim().length) {
      const v = videoUri.trim();
      if (isLocalOnlyUri(v)) {
        safeVideoUri = null;
      } else {
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
      let shareTargetsParsed: string[] = [];
      if (p.shareTargets) {
        shareTargetsParsed = safeParseStringArray(p.shareTargets);
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

// -------------------- Likes / Comments (Safe + Race-proof) --------------------

function isPrismaP2002(e: any): boolean {
  return (
    e &&
    typeof e === 'object' &&
    (e.code === 'P2002' ||
      (e.constructor?.name === 'PrismaClientKnownRequestError' && String(e.code) === 'P2002'))
  );
}

function isPrismaUnknownArgumentError(e: any): boolean {
  const msg = String(e?.message ?? '');
  return msg.toLowerCase().includes('unknown argument') || msg.toLowerCase().includes('unknown field');
}

async function safeUpdatePostById(params: { id: number; data: any; label: string }) {
  const { id, data, label } = params;
  try {
    const updated = await prisma.post.update({
      where: { id },
      data,
    } as any);
    return { ok: true, updated };
  } catch (e: any) {
    if (isPrismaUnknownArgumentError(e)) {
      console.log(`[POST][SAFE UPDATE] ${label} skipped (schema field missing)`);
      return { ok: false, skipped: true };
    }
    throw e;
  }
}

async function safeFindPostById(id: number) {
  try {
    return await prisma.post.findUnique({ where: { id } });
  } catch {
    return null;
  }
}

async function attachLikeCommentMetaToFeedPosts(posts: any[], req: express.Request) {
  const meId = parseUserIdFromReq(req);
  const anyPrisma: any = prisma as any;

  const postIds = (posts || [])
    .map(p => Number((p as any)?.id))
    .filter(n => Number.isFinite(n) && n > 0);

  const likeCountByPost = new Map<number, number>();
  const commentCountByPost = new Map<number, number>();
  const likedByMeSet = new Set<number>();

  // ---------------- likes count ----------------
  try {
    if (anyPrisma.like?.groupBy && postIds.length) {
      const rows = await anyPrisma.like.groupBy({
        by: ['postId'],
        where: { postId: { in: postIds } },
        _count: { _all: true },
      });
      for (const r of rows) {
        likeCountByPost.set(Number(r.postId), Number(r._count?._all ?? 0));
      }
    } else if (anyPrisma.like?.findMany && postIds.length) {
      const rows = await anyPrisma.like.findMany({
        where: { postId: { in: postIds } },
        select: { postId: true },
      });
      for (const r of rows) {
        const pid = Number(r.postId);
        likeCountByPost.set(pid, (likeCountByPost.get(pid) ?? 0) + 1);
      }
    }
  } catch {}

 // ---------------- comments count ---------------- 
try {
  if (anyPrisma.comment?.groupBy && postIds.length) {
    const rows = await anyPrisma.comment.groupBy({
      by: ['postId'],
      where: { postId: { in: postIds } },
      _count: { _all: true },
    });
    for (const r of rows) {
      commentCountByPost.set(Number(r.postId), Number(r._count?._all ?? 0));
    }
  } else if (anyPrisma.comment?.findMany && postIds.length) {
    const rows = await anyPrisma.comment.findMany({
      where: { postId: { in: postIds } },
      select: { postId: true },
    });
    for (const r of rows) {
      const pid = Number(r.postId);
      commentCountByPost.set(pid, (commentCountByPost.get(pid) ?? 0) + 1);
    }
  }
} catch {}

// ---------------- likedByMe ----------------
try {
  if (meId && anyPrisma.like?.findMany && postIds.length) {
    const rows = await anyPrisma.like.findMany({
      where: { postId: { in: postIds }, userId: meId },
      select: { postId: true },
    });
    for (const r of rows) {
      const pid = Number(r.postId);
      if (Number.isFinite(pid) && pid > 0) likedByMeSet.add(pid);
    }
  }
} catch {}

// ---------------- merge (KRİTİK) ----------------
return (posts || []).map(p => {
  const pid = Number((p as any)?.id);
  const safePid = Number.isFinite(pid) ? pid : NaN;

  const metaLikes = Number.isFinite(safePid) ? likeCountByPost.get(safePid) : undefined;
  const metaComments = Number.isFinite(safePid) ? commentCountByPost.get(safePid) : undefined;

  // ✅ LIKE: meta varsa onu bas, yoksa post üstündeki kalsın
  const nextLikes =
    typeof metaLikes === 'number' && Number.isFinite(metaLikes)
      ? metaLikes
      : typeof (p as any)?.likes === 'number' && Number.isFinite((p as any).likes)
        ? (p as any).likes
        : 0;

  // ✅ COMMENT: EN STABİL KURAL
  // - metaComments (Comment tablosundan sayım) varsa HER ZAMAN onu kullan
  // - meta yoksa post.commentCount'a düş
  // - ikisi de yoksa 0
  const postCommentCount =
    typeof (p as any)?.commentCount === 'number' && Number.isFinite((p as any).commentCount)
      ? (p as any).commentCount
      : undefined;

  const nextCommentCount =
    typeof metaComments === 'number' && Number.isFinite(metaComments)
      ? metaComments
      : typeof postCommentCount === 'number' && Number.isFinite(postCommentCount)
        ? postCommentCount
        : 0;

  const likedByMe = Number.isFinite(safePid) && meId ? likedByMeSet.has(safePid) : false;

  return {
    ...p,
    likes: nextLikes,

    // ✅ 3 isimle birden dön (RN’de farklı yerler farklı isim okuyabiliyor)
    commentCount: nextCommentCount,
    commentsCount: nextCommentCount,
    comments: nextCommentCount,

    likedByMe,
  };
});

// ✅ RN geriye dönük uyum: likes alanını da likeCount ile uyumlu tut
// (bu blok sende zaten var, dokunmadım)

// ✅ Like toggle
app.post('/posts/:id/like', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      return res.status(400).json({ ok: false, error: 'postId-invalid' });
    }

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const anyPrisma: any = prisma as any;
    if (!anyPrisma.like) {
      return res.status(501).json({ ok: false, error: 'like-model-not-ready' });
    }

    const del = await anyPrisma.like.deleteMany({ where: { postId, userId } });

    let liked = false;

    if (del?.count && del.count > 0) {
      liked = false;
    } else {
      try {
        await anyPrisma.like.create({ data: { postId, userId } });
        liked = true;
      } catch (e: any) {
        if (isPrismaP2002(e)) {
          liked = true;
        } else {
          throw e;
        }
      }
    }

    const likeCount = await anyPrisma.like.count({ where: { postId } });

    return res.json({ ok: true, liked, likeCount });
  } catch (e) {
    console.error('[POST /posts/:id/like] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ Idempotent like
app.post('/feed/:id/like', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      return res.status(400).json({ ok: false, error: 'postId-invalid' });
    }

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const anyPrisma: any = prisma as any;
    if (!anyPrisma.like) {
      return res.status(501).json({ ok: false, error: 'like-model-not-ready' });
    }

    try {
      await anyPrisma.like.create({ data: { postId, userId } });
    } catch (e: any) {
      if (!isPrismaP2002(e)) throw e;
    }

    const likeCount = await anyPrisma.like.count({ where: { postId } });

    return res.json({ ok: true, liked: true, likeCount });
  } catch (e) {
    console.error('[POST /feed/:id/like] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ Comment create
const handleCreateComment = async (req: any, res: any) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      return res.status(400).json({ ok: false, error: 'postId-invalid' });
    }

    const textRaw = (req.body ?? {}).text;
    const text = typeof textRaw === 'string' ? textRaw.trim() : '';
    if (!text.length) {
      return res.status(400).json({ ok: false, error: 'text-required' });
    }
    if (text.length > 1500) {
      return res.status(400).json({ ok: false, error: 'text-too-long' });
    }

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const anyPrisma: any = prisma as any;
    if (!anyPrisma.comment) {
      return res.status(501).json({ ok: false, error: 'comment-model-not-ready' });
    }

    const comment = await anyPrisma.comment.create({
      data: {
        postId,
        userId,
        text,
      },
    });

    // ✅ FEED 304 kırmak için: Post’u “değişti” saydır
    // commentCount kolonu olmasa bile updatedAt güncellenirse /feed ETag değişir.
    try {
      await prisma.post.update({
        where: { id: postId },
        data: { updatedAt: new Date() },
      });
    } catch {}

    // ✅ (2. adım) Post.commentCount artırmayı dene (kolon yoksa sessizce geç)
    // NOT: Şemada kolon yoksa Prisma "Unknown argument commentCount" verir.
    // Bu durumda asıl kaynak: Comment tablosundan sayım.
    let commentCount: number | null = null;

    try {
      const anyPrisma2: any = prisma as any;

      const updated = await anyPrisma2.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
        select: { commentCount: true },
      });

      const n = updated?.commentCount;
      if (typeof n === 'number' && Number.isFinite(n)) commentCount = n;
    } catch {
      // sessiz geç
    }

    // ✅ Kolon yoksa bile sayarak döndür (EN STABİL)
    if (commentCount === null) {
      try {
        const cnt = await anyPrisma.comment.count({ where: { postId } });
        if (typeof cnt === 'number' && Number.isFinite(cnt)) commentCount = cnt;
      } catch {
        commentCount = null;
      }
    }

    const cc = commentCount ?? undefined;

    // ✅ 3 isimle birden dön (client farklı isim okuyabiliyor)
    return res.json({
      ok: true,
      comment,
      commentCount: cc,
      commentsCount: cc,
      comments: cc,
    });
  } catch (e) {
    console.error('[POST /posts/:id/comment] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
};

app.post('/posts/:id/comment', handleCreateComment);

// ✅ Alias: client önce /feed/:id/comment deniyor, 404 olmasın
app.post('/feed/:id/comment', handleCreateComment);

// ✅ Comment list
app.get('/posts/:id/comments', async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      return res.status(400).json({ ok: false, error: 'postId-invalid' });
    }

    const limitRaw = req.query.limit;
    let limit = 50;
    if (typeof limitRaw === 'string') {
      const n = parseInt(limitRaw as string, 10);
      if (!isNaN(n) && n > 0 && n <= 200) limit = n;
    }

    const anyPrisma: any = prisma as any;
    if (!anyPrisma.comment) {
      return res.status(501).json({ ok: false, error: 'comment-model-not-ready' });
    }

    const items = await anyPrisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, handle: true, avatarUri: true } },
      },
    });

    const normalized = items.map((c: any) => {
      const rawAvatar = c?.user?.avatarUri ?? null;
      const avatarUrl = rawAvatar ? toAbsoluteIfPath(req, rawAvatar) : null;

      return {
        ...c,
        user: undefined,
        authorId: c.userId,
        author:
          (c?.user?.fullName && String(c.user.fullName).trim()) ||
          (c?.user?.handle && String(c.user.handle).trim()) ||
          'misafir',
        authorAvatarUri: avatarUrl,
        authorAvatarUrl: avatarUrl,
      };
    });

    return res.json({ ok: true, items: normalized });
  } catch (e) {
    console.error('[GET /posts/:id/comments] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ repost / reshare
app.post('/feed/:id/repost', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ ok: false, error: 'postId-invalid' });

    const post = await safeFindPostById(postId);
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const r = await safeUpdatePostById({
      id: postId,
      data: { reshareCount: { increment: 1 } },
      label: 'repost(increment reshareCount)',
    });

    const after = await safeFindPostById(postId);
    const reshareCount =
      typeof (after as any)?.reshareCount === 'number' && Number.isFinite((after as any).reshareCount)
        ? Number((after as any).reshareCount)
        : typeof (post as any)?.reshareCount === 'number' && Number.isFinite((post as any).reshareCount)
          ? Number((post as any).reshareCount)
          : 0;

    return res.json({ ok: true, status: r?.ok ? 'updated' : 'skipped', reshareCount });
  } catch (e) {
    console.error('[POST /feed/:id/repost] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

app.post('/feed/:id/reshare', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ ok: false, error: 'postId-invalid' });

    const post = await safeFindPostById(postId);
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const r = await safeUpdatePostById({
      id: postId,
      data: { reshareCount: { increment: 1 } },
      label: 'reshare(increment reshareCount)',
    });

    const after = await safeFindPostById(postId);
    const reshareCount =
      typeof (after as any)?.reshareCount === 'number' && Number.isFinite((after as any).reshareCount)
        ? Number((after as any).reshareCount)
        : typeof (post as any)?.reshareCount === 'number' && Number.isFinite((post as any).reshareCount)
          ? Number((post as any).reshareCount)
          : 0;

    return res.json({ ok: true, status: r?.ok ? 'updated' : 'skipped', reshareCount });
  } catch (e) {
    console.error('[POST /feed/:id/reshare] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ archive
app.patch('/feed/:id/archive', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ ok: false, error: 'postId-invalid' });

    const post = await safeFindPostById(postId);
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const r = await safeUpdatePostById({
      id: postId,
      data: { archived: true },
      label: 'archive(set archived=true)',
    });

    return res.json({ ok: true, status: r?.ok ? 'updated' : 'skipped' });
  } catch (e) {
    console.error('[PATCH /feed/:id/archive] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ shared / share
app.post('/feed/:id/shared', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ ok: false, error: 'postId-invalid' });

    const post = await safeFindPostById(postId);
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const body = req.body ?? {};
    const targets = safeParseStringArray(body.targets);
    const ts = typeof body.ts === 'number' && Number.isFinite(body.ts) ? body.ts : Date.now();

    const data: any = {
      lastSharedAt: ts,
      lastSharedTargets: targets,
    };

    const r = await safeUpdatePostById({
      id: postId,
      data,
      label: 'shared(set lastSharedAt/lastSharedTargets)',
    });

    return res.json({ ok: true, status: r?.ok ? 'updated' : 'skipped' });
  } catch (e) {
    console.error('[POST /feed/:id/shared] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

app.post('/feed/:id/share', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ ok: false, error: 'postId-invalid' });

    const post = await safeFindPostById(postId);
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const body = req.body ?? {};
    const targets = safeParseStringArray(body.targets);
    const ts = typeof body.ts === 'number' && Number.isFinite(body.ts) ? body.ts : Date.now();

    const data: any = {
      lastSharedAt: ts,
      lastSharedTargets: targets,
    };

    const r = await safeUpdatePostById({
      id: postId,
      data,
      label: 'share(alias shared)',
    });

    return res.json({ ok: true, status: r?.ok ? 'updated' : 'skipped' });
  } catch (e) {
    console.error('[POST /feed/:id/share] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ PATCH /feed/:id fallback2
app.patch('/feed/:id', async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ ok: false, error: 'postId-invalid' });

    const post = await safeFindPostById(postId);
    if (!post) return res.status(404).json({ ok: false, error: 'post-not-found' });

    const body = req.body ?? {};

    const data: any = {};

    if (typeof body.archived === 'boolean') data.archived = body.archived;

    if (typeof body.lastSharedAt === 'number' && Number.isFinite(body.lastSharedAt)) {
      data.lastSharedAt = body.lastSharedAt;
    }
    if (body.lastSharedTargets !== undefined) {
      data.lastSharedTargets = safeParseStringArray(body.lastSharedTargets);
    }

    if (typeof body.reshareCount === 'number' && Number.isFinite(body.reshareCount)) {
      data.reshareCount = body.reshareCount;
    }

    if (!Object.keys(data).length) {
      return res.json({ ok: true, status: 'noop' });
    }

    const r = await safeUpdatePostById({
      id: postId,
      data,
      label: 'patch feed post fields',
    });

    return res.json({ ok: true, status: r?.ok ? 'updated' : 'skipped' });
  } catch (e) {
    console.error('[PATCH /feed/:id] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ FEED: client tarafındaki FeedScreen’in esas kullandığı endpoint
app.get('/feed', async (req, res) => {
  // ✅ Cache/ETag yüzünden 304 dönüp client’ın JSON alamaması problemini kır
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // ✅ Ek garanti: proxy/CDN tarzı arakatmanlar 304 üretmesin
  res.setHeader('Surrogate-Control', 'no-store');

  // ✅ Last-Modified her request değişsin (ara katman “değişmedi” demesin)
  res.setHeader('Last-Modified', new Date().toUTCString());

  try {
    const limitRaw = req.query.limit;
    let limit = 50;
    if (typeof limitRaw === 'string') {
      const n = parseInt(limitRaw, 10);
      if (!isNaN(n) && n > 0 && n <= 200) limit = n;
    }

    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, fullName: true, handle: true, avatarUri: true } },
      },
    });

    const normalized = posts.map(p => {
      const anyP: any = p as any;

      const authorName =
        typeof anyP.author === 'string' && anyP.author.trim().length
          ? anyP.author.trim()
          : (p as any)?.user?.fullName || (p as any)?.user?.handle || 'misafir';

      const rawAvatar = (p as any)?.user?.avatarUri ?? null;
      const authorAvatarUrl = rawAvatar ? toAbsoluteIfPath(req, rawAvatar) : null;

      let safeVideoOut: string | null = null;
      if (typeof anyP.videoUri === 'string' && anyP.videoUri.trim().length) {
        const vv = anyP.videoUri.trim();
        safeVideoOut = isLocalOnlyUri(vv) ? null : toAbsoluteIfPath(req, vv);
      }

      return {
        ...anyP,

        user: undefined,

        author: authorName,
        authorAvatarUri: authorAvatarUrl ?? null,
        authorAvatarUrl: authorAvatarUrl ?? null,

        videoUri: safeVideoOut,

        userId: anyP.userId ?? (p as any)?.user?.id ?? null,
        shareTargets: safeParseStringArray(anyP.shareTargets),

        reshareCount:
          typeof anyP.reshareCount === 'number' && Number.isFinite(anyP.reshareCount) ? anyP.reshareCount : 0,

        archived: typeof anyP.archived === 'boolean' ? anyP.archived : false,

        lastSharedTargets: Array.isArray(anyP.lastSharedTargets) ? anyP.lastSharedTargets : undefined,
      };
    });

    // ✅ NEW: /feed cevabına commentCount ekle (kolon olmasa bile Comment tablosundan say)
    let normalizedWithCounts = normalized;

    try {
      const anyPrisma: any = prisma as any;

      if (anyPrisma.comment && Array.isArray(normalized) && normalized.length) {
        const ids = normalized
          .map((pp: any) => Number((pp as any)?.id))
          .filter(n => Number.isFinite(n) && n > 0);

        const counts: Record<number, number> = {};

        // 1) groupBy varsa tek sorgu
        try {
          if (typeof anyPrisma.comment.groupBy === 'function') {
            const grouped = await anyPrisma.comment.groupBy({
              by: ['postId'],
              where: { postId: { in: ids } },
              _count: { _all: true },
            });

            for (const g of grouped || []) {
              const pid = Number((g as any)?.postId);
              const c = Number((g as any)?._count?._all ?? 0);
              if (Number.isFinite(pid) && pid > 0) counts[pid] = Number.isFinite(c) ? c : 0;
            }
          }
        } catch {
          // groupBy yoksa geç
        }

        // 2) groupBy yoksa fallback: tek tek say
        if (!Object.keys(counts).length) {
          for (const pid of ids) {
            try {
              const c = await anyPrisma.comment.count({ where: { postId: pid } });
              counts[pid] = typeof c === 'number' && Number.isFinite(c) ? c : 0;
            } catch {
              counts[pid] = 0;
            }
          }
        }

        normalizedWithCounts = normalized.map((pp: any) => {
          const pid = Number((pp as any)?.id);
          const cc = Number.isFinite(pid) && pid > 0 ? (counts[pid] ?? 0) : 0;

          // ✅ 3 isimle birden koy
          return { ...pp, commentCount: cc, commentsCount: cc, comments: cc };
        });
      }
    } catch (e) {
      console.log('[GET /feed] commentCount attach skipped:', e);
    }

    // ✅ DEĞİŞTİ: normalized yerine normalizedWithCounts
    const enriched = await attachLikeCommentMetaToFeedPosts(normalizedWithCounts, req);

    // ✅ Like meta uyumu (senin eski “KRİTİK FIX” davranışını koru)
    const final = (enriched || []).map((p: any) => {
      const likeFixed =
        typeof p.likeCount === 'number' && Number.isFinite(p.likeCount)
          ? p.likeCount
          : typeof p.likes === 'number' && Number.isFinite(p.likes)
            ? p.likes
            : 0;

      const cc =
        typeof p.commentCount === 'number' && Number.isFinite(p.commentCount)
          ? p.commentCount
          : typeof p.commentsCount === 'number' && Number.isFinite(p.commentsCount)
            ? p.commentsCount
            : typeof p.comments === 'number' && Number.isFinite(p.comments)
              ? p.comments
              : 0;

      return {
        ...p,
        likes: likeFixed,

        // ✅ 3 isimle birden dön
        commentCount: cc,
        commentsCount: cc,
        comments: cc,
      };
    });

    return res.json(final);
  } catch (e) {
    console.error('[GET /feed] error:', e);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
});

// ✅ FEED: Tek post sil (SADECE sahibi silebilir) — KRİTİK
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

    // ✅ Kim istek atıyor? (client’dan göndereceğiz)
    const requesterUserIdRaw =
      (req.headers && req.headers['x-user-id'] != null ? String(req.headers['x-user-id']) : undefined) ||
      (req.query && req.query.userId != null ? String(req.query.userId) : undefined) ||
      (req.body && req.body.userId != null ? String(req.body.userId) : undefined);

    const requesterDeviceId =
      (req.headers && req.headers['x-device-id'] != null ? String(req.headers['x-device-id']) : undefined) ||
      (req.query && req.query.deviceId != null ? String(req.query.deviceId) : undefined) ||
      (req.body && req.body.deviceId != null ? String(req.body.deviceId) : undefined);

    const requesterUserId = requesterUserIdRaw != null ? Number(requesterUserIdRaw) : NaN;

    // En az bir tanesi gelmeli
    if ((!Number.isFinite(requesterUserId) || requesterUserId <= 0) && !requesterDeviceId) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'missing user identity',
      });
    }

    // ✅ Post sahibini bul (şemaya göre alanlardan hangisi varsa)
    const post = await prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,   // varsa
        userId: true,    // varsa
        authorId: true,  // varsa
        deviceId: true,  // varsa
      },
    });

    if (!post) {
      return res.status(404).json({ ok: false, error: 'not-found' });
    }

    const ownerMatch =
      (Number.isFinite(requesterUserId) &&
        requesterUserId > 0 &&
        post.ownerId != null &&
        Number(post.ownerId) === requesterUserId) ||
      (Number.isFinite(requesterUserId) &&
        requesterUserId > 0 &&
        post.userId != null &&
        Number(post.userId) === requesterUserId) ||
      (Number.isFinite(requesterUserId) &&
        requesterUserId > 0 &&
        post.authorId != null &&
        Number(post.authorId) === requesterUserId) ||
      (!!requesterDeviceId &&
        post.deviceId != null &&
        String(post.deviceId) === String(requesterDeviceId));

    if (!ownerMatch) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'you can only delete your own posts',
      });
    }

    await prisma.post.delete({ where: { id } });

    return res.json({ ok: true });
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
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