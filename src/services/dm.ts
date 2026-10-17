import { API_BASE_URL } from '../config/api';
import { useAuth } from '../store/useAuth';

export type DmUser = {
  id: number;
  fullName?: string | null;
  displayName?: string | null;
  handle?: string | null;
  avatarUri?: string | null;
  avatarUrl?: string | null;
};

export type DmMessage = {
  id: number;
  senderId: number;
  recipientId: number;
  text: string;
  read: boolean;
  createdAt: string;
};

export type DmConversation = {
  otherUser: DmUser;
  lastMessage: DmMessage;
  unreadCount: number;
};

type DmMessagesResponse = {
  ok: boolean;
  otherUser: DmUser;
  items: DmMessage[];
  hasMore?: boolean;
  nextBeforeId?: number | null;
};

function authHeaders(): Record<string, string> {
  const state: any = useAuth.getState();
  const token = typeof state?.token === 'string' ? state.token.trim() : '';
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function dmFetch<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const base = String(API_BASE_URL || '').replace(/\/+$/, '');

  try {
    const response = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
      ...(init || {}),
      headers: {
        ...authHeaders(),
        ...((init?.headers as Record<string, string> | undefined) || {}),
      },
      signal: controller.signal,
    });

    const text = await response.text().catch(() => '');
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const message =
        (json && typeof json.message === 'string' && json.message.trim()) ||
        (json && typeof json.error === 'string' && json.error.trim()) ||
        `Mesaj işlemi başarısız (${response.status}).`;
      throw new Error(message);
    }

    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getDmConversations(): Promise<DmConversation[]> {
  const json = await dmFetch<{ ok: boolean; items?: DmConversation[] }>('/dm/conversations');
  return Array.isArray(json?.items) ? json.items : [];
}

export async function getDmMessages(
  otherUserId: number,
  beforeId?: number | null,
): Promise<DmMessagesResponse> {
  const before = beforeId && beforeId > 0 ? `?beforeId=${encodeURIComponent(String(beforeId))}` : '';
  return dmFetch<DmMessagesResponse>(`/dm/messages/${encodeURIComponent(String(otherUserId))}${before}`);
}

export async function sendDmMessage(otherUserId: number, text: string): Promise<DmMessage> {
  const json = await dmFetch<{ ok: boolean; message: DmMessage }>(
    `/dm/messages/${encodeURIComponent(String(otherUserId))}`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
  );
  return json.message;
}

export async function markDmRead(otherUserId: number): Promise<void> {
  await dmFetch<{ ok: boolean }>(`/dm/messages/${encodeURIComponent(String(otherUserId))}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getDmUnreadCount(): Promise<number> {
  const json = await dmFetch<{ ok: boolean; count?: number }>('/dm/unread-count');
  const count = Number(json?.count ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
