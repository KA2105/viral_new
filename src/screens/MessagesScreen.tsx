import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/useAuth';
import {
  DmConversation,
  DmMessage,
  DmUser,
  getDmConversations,
  getDmMessages,
  getDmUnreadCount,
  markDmRead,
  sendDmMessage,
} from '../services/dm';

type Props = {
  initialUserId?: number | null;
  onClose?: () => void;
  onUnreadCountChange?: (count: number) => void;
};

function userTitle(user: DmUser | null | undefined): string {
  if (!user) return 'Viral kullanıcısı';
  return (
    String(user.fullName ?? '').trim() ||
    String(user.displayName ?? '').trim() ||
    (user.handle ? `@${String(user.handle).replace(/^@+/, '')}` : '') ||
    'Viral kullanıcısı'
  );
}

function userSubtitle(user: DmUser | null | undefined): string {
  const handle = String(user?.handle ?? '').trim().replace(/^@+/, '');
  return handle ? `@${handle}` : '';
}

function avatarSource(user: DmUser | null | undefined): string | null {
  const raw = user?.avatarUri ?? user?.avatarUrl ?? null;
  const uri = typeof raw === 'string' ? raw.trim() : '';
  return uri || null;
}

function formatMessageTime(input: string | null | undefined, locale = 'tr-TR'): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

const MessagesScreen: React.FC<Props> = ({ initialUserId, onClose, onUnreadCountChange }) => {
  const { t, i18n } = useTranslation();
  const auth: any = useAuth();
  const myUserId = Number(auth?.backendUserId ?? auth?.user?.id ?? 0);

  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [activeUser, setActiveUser] = useState<DmUser | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<FlatList<DmMessage> | null>(null);
  const initialOpenedRef = useRef<number | null>(null);

  const emitUnread = useCallback(async () => {
    try {
      const count = await getDmUnreadCount();
      onUnreadCountChange?.(count);
      DeviceEventEmitter.emit('viral_dm_unread_changed', { count });
    } catch {}
  }, [onUnreadCountChange]);

  const loadConversations = useCallback(
    async (showLoader = false) => {
      if (showLoader) setLoading(true);
      try {
        const items = await getDmConversations();
        setConversations(items);
        setError('');
        const unread = items.reduce((sum, item) => sum + Math.max(0, Number(item.unreadCount || 0)), 0);
        onUnreadCountChange?.(unread);
      } catch (e: any) {
        setError(e?.message || t('messages.errors.list', 'Mesajlar yüklenemedi.'));
      } finally {
        if (showLoader) setLoading(false);
      }
    },
    [onUnreadCountChange, t],
  );

  const loadConversation = useCallback(
    async (otherUserId: number, showLoader = false) => {
      if (!Number.isFinite(otherUserId) || otherUserId <= 0) return;
      if (showLoader) setLoading(true);
      try {
        const result = await getDmMessages(otherUserId);
        setActiveUserId(otherUserId);
        setActiveUser(result.otherUser ?? null);
        setMessages(Array.isArray(result.items) ? result.items : []);
        setError('');
        await markDmRead(otherUserId).catch(() => {});
        void emitUnread();
      } catch (e: any) {
        setError(e?.message || t('messages.errors.chat', 'Sohbet yüklenemedi.'));
      } finally {
        if (showLoader) setLoading(false);
      }
    },
    [emitUnread, t],
  );

  useEffect(() => {
    void loadConversations(true);
  }, [loadConversations]);

  useEffect(() => {
    const n = Number(initialUserId ?? 0);
    if (!Number.isFinite(n) || n <= 0) return;
    if (initialOpenedRef.current === n) return;
    initialOpenedRef.current = n;
    void loadConversation(n, true);
  }, [initialUserId, loadConversation]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (activeUserId) {
        void loadConversation(activeUserId, false);
      } else {
        void loadConversations(false);
      }
    }, activeUserId ? 4000 : 8000);
    return () => clearInterval(timer);
  }, [activeUserId, loadConversation, loadConversations]);

  useEffect(() => {
    if (!activeUserId || messages.length === 0) return;
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [activeUserId, messages.length]);

  const handleBack = () => {
    if (activeUserId) {
      setActiveUserId(null);
      setActiveUser(null);
      setMessages([]);
      setDraft('');
      setError('');
      void loadConversations(false);
      return;
    }
    onClose?.();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (activeUserId) await loadConversation(activeUserId, false);
      else await loadConversations(false);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!activeUserId || !text || sending) return;
    setSending(true);
    try {
      const message = await sendDmMessage(activeUserId, text);
      setDraft('');
      setMessages(prev => {
        if (prev.some(item => Number(item.id) === Number(message.id))) return prev;
        return [...prev, message];
      });
      setError('');
      void loadConversations(false);
    } catch (e: any) {
      setError(e?.message || t('messages.errors.send', 'Mesaj gönderilemedi.'));
    } finally {
      setSending(false);
    }
  };

  const renderConversation = ({ item }: { item: DmConversation }) => {
    const uri = avatarSource(item.otherUser);
    const initial = userTitle(item.otherUser).charAt(0).toUpperCase() || 'V';
    const unread = Math.max(0, Number(item.unreadCount || 0));
    return (
      <Pressable
        style={({ pressed }) => [styles.conversationRow, pressed && styles.rowPressed]}
        onPress={() => void loadConversation(Number(item.otherUser.id), true)}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}><Text style={styles.avatarFallbackText}>{initial}</Text></View>
        )}
        <View style={styles.conversationText}>
          <View style={styles.conversationTitleRow}>
            <Text style={[styles.conversationName, unread > 0 && styles.unreadText]} numberOfLines={1}>
              {userTitle(item.otherUser)}
            </Text>
            <Text style={styles.timeText}>{formatMessageTime(item.lastMessage?.createdAt, i18n.language)}</Text>
          </View>
          <View style={styles.conversationTitleRow}>
            <Text style={[styles.previewText, unread > 0 && styles.unreadText]} numberOfLines={1}>
              {Number(item.lastMessage?.senderId) === myUserId ? `${t('messages.you', 'Sen')}: ` : ''}{item.lastMessage?.text || ''}
            </Text>
            {unread > 0 ? (
              <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text></View>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  const renderMessage = ({ item }: { item: DmMessage }) => {
    const mine = Number(item.senderId) === myUserId;
    return (
      <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowOther]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          <Text style={[styles.messageText, mine && styles.messageTextMine]}>{item.text}</Text>
          <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>{formatMessageTime(item.createdAt, i18n.language)}</Text>
        </View>
      </View>
    );
  };

  const title = activeUserId ? userTitle(activeUser) : t('messages.title', 'Mesajlar');
  const subtitle = activeUserId ? userSubtitle(activeUser) : t('messages.subtitle', 'Viral kullanıcılarıyla birebir sohbet');

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.rowPressed]} onPress={handleBack}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
          </View>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {loading ? (
          <View style={styles.center}><ActivityIndicator /><Text style={styles.loadingText}>{t('messages.loading', 'Yükleniyor...')}</Text></View>
        ) : activeUserId ? (
          <>
            <FlatList
              ref={ref => { listRef.current = ref; }}
              data={messages}
              keyExtractor={item => String(item.id)}
              renderItem={renderMessage}
              contentContainerStyle={messages.length ? styles.messageList : styles.emptyList}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
              ListEmptyComponent={<Text style={styles.emptyText}>{t('messages.emptyChat', 'Henüz mesaj yok. İlk mesajı sen gönder.')}</Text>}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            />
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={t('messages.placeholder', 'Mesaj yaz...')}
                placeholderTextColor="#888"
                multiline
                maxLength={2000}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.sendButton,
                  (!draft.trim() || sending) && styles.sendButtonDisabled,
                  pressed && !!draft.trim() && !sending && styles.sendButtonPressed,
                ]}
                disabled={!draft.trim() || sending}
                onPress={handleSend}
              >
                <Text style={styles.sendText}>{sending ? '...' : t('messages.send', 'Gönder')}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={item => String(item.otherUser.id)}
            renderItem={renderConversation}
            contentContainerStyle={conversations.length ? styles.conversationList : styles.emptyList}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            ListEmptyComponent={<Text style={styles.emptyText}>{t('messages.emptyList', 'Henüz bir sohbetin yok. Focus Ağı\'ndan bir profile girip “Mesaj Gönder” diyebilirsin.')}</Text>}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default MessagesScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f7f7' },
  header: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e7e7e7',
    backgroundColor: '#fff',
  },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  backText: { fontSize: 34, lineHeight: 36, color: '#222', marginTop: -3 },
  headerText: { flex: 1, paddingRight: 12 },
  title: { fontSize: 19, fontWeight: '800', color: '#111' },
  subtitle: { marginTop: 2, fontSize: 11, color: '#777' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 8, color: '#666' },
  errorText: { color: '#b00020', backgroundColor: '#fff0f1', paddingHorizontal: 14, paddingVertical: 8, fontSize: 12 },
  conversationList: { paddingVertical: 6 },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  rowPressed: { opacity: 0.7 },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 11, backgroundColor: '#eee' },
  avatarFallback: { width: 48, height: 48, borderRadius: 24, marginRight: 11, backgroundColor: '#E50914', alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  conversationText: { flex: 1, minWidth: 0 },
  conversationTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  conversationName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#222' },
  previewText: { flex: 1, fontSize: 13, color: '#777', marginTop: 4 },
  timeText: { fontSize: 10, color: '#999' },
  unreadText: { fontWeight: '800', color: '#111' },
  unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#E50914', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginTop: 4 },
  unreadBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  emptyList: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingVertical: 50 },
  emptyText: { textAlign: 'center', color: '#777', fontSize: 13, lineHeight: 20 },
  messageList: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 },
  messageRow: { width: '100%', marginBottom: 7, flexDirection: 'row' },
  messageRowMine: { justifyContent: 'flex-end' },
  messageRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 6 },
  bubbleMine: { backgroundColor: '#E50914', borderBottomRightRadius: 5 },
  bubbleOther: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e2e2', borderBottomLeftRadius: 5 },
  messageText: { fontSize: 14, lineHeight: 20, color: '#202020' },
  messageTextMine: { color: '#fff' },
  messageTime: { marginTop: 3, fontSize: 9, color: '#999', alignSelf: 'flex-end' },
  messageTimeMine: { color: '#ffdadd' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 9, paddingBottom: 17, gap: 8, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e5e5' },
  input: { flex: 1, maxHeight: 120, minHeight: 42, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 9, color: '#111', backgroundColor: '#fafafa' },
  sendButton: { minHeight: 42, paddingHorizontal: 15, borderRadius: 21, backgroundColor: '#E50914', alignItems: 'center', justifyContent: 'center' },
  sendButtonPressed: { backgroundColor: '#c10710' },
  sendButtonDisabled: { opacity: 0.45 },
  sendText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
