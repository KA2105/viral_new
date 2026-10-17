export type ViralDeepLink =
  | { type: 'post'; postId: string }
  | { type: 'profile'; handle: string }
  | { type: 'messages'; userId?: number }
  | { type: 'home' };

function cleanSegment(value: string | undefined | null): string {
  try {
    return decodeURIComponent(String(value ?? '').trim());
  } catch {
    return String(value ?? '').trim();
  }
}

export function parseViralDeepLink(rawUrl: string | null | undefined): ViralDeepLink | null {
  const raw = String(rawUrl ?? '').trim();
  if (!raw) return null;

  // Custom scheme used by the server landing pages and notifications.
  const custom = raw.match(/^viral:\/\/(post|profile|messages|home)(?:\/([^?#/]+))?/i);
  if (custom) {
    const kind = String(custom[1] ?? '').toLowerCase();
    const value = cleanSegment(custom[2]);

    if (kind === 'post' && value) return { type: 'post', postId: value };
    if (kind === 'profile' && value) return { type: 'profile', handle: value.replace(/^@+/, '') };
    if (kind === 'messages') {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? { type: 'messages', userId: n } : { type: 'messages' };
    }
    if (kind === 'home') return { type: 'home' };
  }

  // Also understand our own HTTPS landing paths in case the OS forwards one to the app.
  const https = raw.match(/^https?:\/\/[^/]+\/(p|u|download)(?:\/([^?#/]+))?/i);
  if (https) {
    const kind = String(https[1] ?? '').toLowerCase();
    const value = cleanSegment(https[2]);
    if (kind === 'p' && value) return { type: 'post', postId: value };
    if (kind === 'u' && value) return { type: 'profile', handle: value.replace(/^@+/, '') };
    if (kind === 'download') return { type: 'home' };
  }

  return null;
}
