// src/screens/AccountConnectionsScreen.tsx
import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSocialAccounts } from '../store/useSocialAccounts';

type Props = {
  // Uygulamada nasıl bağlarsan: go('Feed') veya navigation.goBack() vs.
  onClose?: () => void;
};

export type PlatformKey =
  | 'instagram'
  | 'x'
  | 'tiktok'
  | 'facebook'
  | 'linkedin'
  | 'nextsosyal';

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  instagram: 'Instagram (Reels / Gönderi)',
  x: 'X (Tweet)',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  nextsosyal: 'Nextsosyal',
};

const PLATFORM_ORDER: PlatformKey[] = [
  'instagram',
  'x',
  'tiktok',
  'facebook',
  'linkedin',
  'nextsosyal',
];

export default function AccountConnectionsScreen({ onClose }: Props) {
  const socialStore: any = useSocialAccounts();

  // Store'da persiste edilen veriyi yükle (varsa)
  useEffect(() => {
    if (typeof socialStore?.hydrate === 'function' && !socialStore.hydrated) {
      socialStore.hydrate();
    }
  }, [socialStore?.hydrate, socialStore?.hydrated]);

  /**
   * Store'un farklı şekillerde tutulabilme ihtimaline karşı
   * (connectedPlatforms[] veya accounts[]) tek bir
   * connectedPlatformIds listesi üretelim.
   */
  const connectedPlatformIds: PlatformKey[] = useMemo(() => {
    // Örn: ['instagram','x','tiktok', ...]
    if (Array.isArray(socialStore?.connectedPlatforms)) {
      return socialStore.connectedPlatforms as PlatformKey[];
    }

    // Örn: [{id:'instagram', isConnected:true}, ...]
    if (Array.isArray(socialStore?.accounts)) {
      return socialStore.accounts
        .filter((a: any) => a.isConnected)
        .map((a: any) => a.id) as PlatformKey[];
    }

    return [];
  }, [socialStore]);

  const isPlatformConnected = (key: PlatformKey) =>
    connectedPlatformIds.includes(key);

  const toggleConnection = (key: PlatformKey) => {
    // Eğer özel bir toggle fonksiyonu varsa onu kullan
    if (typeof socialStore?.togglePlatformConnection === 'function') {
      socialStore.togglePlatformConnection(key);
      return;
    }

    if (typeof socialStore?.toggleAccount === 'function') {
      socialStore.toggleAccount(key);
      return;
    }

    // Hiçbiri yoksa, şimdilik uyarı logla (ama app crash olmasın)
    console.warn(
      '[AccountConnections] toggleConnection için fonksiyon bulunamadı.',
    );
  };

  const renderRow = (key: PlatformKey) => {
    const isOn = isPlatformConnected(key);

    return (
      <View key={key} style={styles.row}>
        <View style={styles.rowTextBlock}>
          <Text style={styles.rowTitle}>{PLATFORM_LABELS[key]}</Text>
          <Text style={styles.rowSub}>
            {isOn
              ? 'Bu hesap Viral ile bağlı olarak işaretlendi. Yükle ekranında otomatik paylaşım için seçebilirsin.'
              : 'Bağlı değil. Bu anahtar sadece Viral içinde hangi hesapların bağlı sayılacağını belirler.'}
          </Text>
        </View>
        <Switch value={isOn} onValueChange={() => toggleConnection(key)} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Hesaplarını bağla</Text>
        <Text style={styles.headerSub}>
          Buradan hangi sosyal medya hesaplarının Viral&apos;e bağlı
          sayılacağını yönetebilirsin. Bağlı hesaplar, Yükle ekranında
          otomatik paylaşım için seçilebilir. Bir sonraki adımda bu bağları
          gerçek giriş (OAuth) ile tam otomatik hale getireceğiz.
        </Text>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 16 }}
      >
        {PLATFORM_ORDER.map(renderRow)}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.closeBtn,
            pressed && styles.closeBtnPressed,
          ]}
          onPress={onClose}
        >
          <Text style={styles.closeText}>Kapat</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111',
  },
  headerSub: {
    marginTop: 4,
    fontSize: 13,
    color: '#666',
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  rowTextBlock: {
    flex: 1,
    paddingRight: 8,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  rowSub: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  closeBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  closeBtnPressed: {
    backgroundColor: '#ddd',
  },
  closeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
});
