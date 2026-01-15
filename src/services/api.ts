// src/services/api.ts

// 💡 Buraya PC'nin yerel IP adresini yaz.
// Örn: bilgisayarında server'i şu URL ile açabiliyorsan:
//   http://192.168.1.103:4000
// buraya da aynısını koymalısın.
export const API_URL = 'http://192.168.1.103:4000'; // <-- IP'yi kendine göre değiştir

// Ortak POST helper (hem /auth hem /posts için kullanılabilir)
export async function apiPost<T = any>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${API_URL}${path}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn('[API] post failed', path, res.status);
      // istersen burada throw da edebilirsin
    }

    // JSON olmayabilir, o yüzden try/catch'li
    try {
      return (await res.json()) as T;
    } catch {
      // response body yoksa
      return undefined as T;
    }
  } catch (e) {
    console.warn('[API] network error', path, e);
    throw e;
  }
}
