import { DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { API_BASE_URL } from '../config/api';
import { useAuth } from '../store/useAuth';

const PENDING_PUSH_OPEN_KEY = 'viral.pendingPushOpen.v1';

type PushOpenPayload = {
  postId?: string | null;
  type?: string | null;
};

type RegisterPushDeviceParams = {
  userId: number;
  deviceId?: string | null;
};

function normalizePushOpen(remoteMessage: FirebaseMessagingTypes.RemoteMessage | null): PushOpenPayload | null {
  if (!remoteMessage) return null;
  const data = remoteMessage.data ?? {};
  const postIdRaw = data.postId ?? null;
  const postId = postIdRaw == null ? null : String(postIdRaw).trim();
  const type = data.type == null ? null : String(data.type).trim();
  if (!postId && !type) return null;
  return { postId: postId || null, type: type || null };
}

async function storePendingPushOpen(payload: PushOpenPayload | null) {
  if (!payload) return;
  await AsyncStorage.setItem(PENDING_PUSH_OPEN_KEY, JSON.stringify(payload));
}

async function requestPushPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) < 33) return true;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  const status = await messaging().requestPermission();
  return (
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL
  );
}

async function sendTokenToServer(params: RegisterPushDeviceParams, token: string) {
  const state = useAuth.getState() as any;
  const authToken = state?.token ?? state?.accessToken ?? state?.authToken ?? null;

  const response = await fetch(`${String(API_BASE_URL).replace(/\/+$/, '')}/push/register`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      'x-user-id': String(params.userId),
    },
    body: JSON.stringify({
      token,
      deviceId: params.deviceId ?? null,
      platform: Platform.OS,
    }),
  });

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Push token kaydı başarısız (${response.status}): ${text}`);
  }
}

export async function registerPushDevice(
  params: RegisterPushDeviceParams,
): Promise<() => void> {
  const allowed = await requestPushPermission();
  if (!allowed) {
    console.log('[PUSH] notification permission not granted');
    return () => {};
  }

  await messaging().registerDeviceForRemoteMessages();
  const token = await messaging().getToken();
  if (token) {
    await sendTokenToServer(params, token);
    console.log('[PUSH] token registered');
  }

  return messaging().onTokenRefresh(nextToken => {
    void sendTokenToServer(params, nextToken).catch(error =>
      console.warn('[PUSH] token refresh registration failed:', error),
    );
  });
}

export function installPushOpenHandlers(): () => void {
  const openedUnsubscribe = messaging().onNotificationOpenedApp(remoteMessage => {
    const payload = normalizePushOpen(remoteMessage);
    if (!payload) return;
    DeviceEventEmitter.emit('viral_push_open', payload);
  });

  void messaging()
    .getInitialNotification()
    .then(async remoteMessage => {
      const payload = normalizePushOpen(remoteMessage);
      if (!payload) return;
      await storePendingPushOpen(payload);
      DeviceEventEmitter.emit('viral_push_open', payload);
    })
    .catch(error => console.warn('[PUSH] initial notification read failed:', error));

  return openedUnsubscribe;
}

export async function consumePendingPushOpen(): Promise<PushOpenPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PUSH_OPEN_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(PENDING_PUSH_OPEN_KEY);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

messaging().setBackgroundMessageHandler(async remoteMessage => {
  const payload = normalizePushOpen(remoteMessage);
  if (payload) await storePendingPushOpen(payload);
});
