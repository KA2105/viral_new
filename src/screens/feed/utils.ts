// src/screens/feed/utils.ts
export function safeTrim(v: any): string {
  try {
    return v == null ? '' : String(v).trim();
  } catch {
    return '';
  }
}

// ✅ CRASH FIX: her yerde aynı doğrulama (tek kaynak)
export function isValidVideoUri(uri: any): boolean {
  const u = safeTrim(uri);
  if (!u) return false;

  // android content://, file://, http(s)://
  if (/^(content|file|https?):\/\//i.test(u)) return true;

  // bazı cihazlarda /storage/... gibi gelebilir
  if (u.startsWith('/')) return true;

  // basit mp4 uzantı fallback
  if (/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(u)) return true;

  return false;
}
