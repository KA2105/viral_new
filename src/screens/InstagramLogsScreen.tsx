// src/screens/InstagramLogsScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  fetchInstagramLogs,
  InstagramLogItem,
} from '../services/instagramLogs';

type Props = {
  // Navigation yapına göre opsiyonel
  navigation?: any;
  onClose?: () => void;
};

const InstagramLogsScreen: React.FC<Props> = ({ navigation, onClose }) => {
  const [logs, setLogs] = useState<InstagramLogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const items = await fetchInstagramLogs();
    setLogs(items);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const items = await fetchInstagramLogs();
    setLogs(items);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else if (navigation && navigation.goBack) {
      navigation.goBack();
    }
  };

  const renderItem = ({ item }: { item: InstagramLogItem }) => {
    const hasVideo = !!item.videoUri;
    let dateLabel = item.time;
    try {
      dateLabel = new Date(item.time).toLocaleString('tr-TR');
    } catch {
      // sorun olursa raw string kalsın
    }

    return (
      <View style={styles.row}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowId}>#{item.id}</Text>
          <Text style={styles.rowTime} numberOfLines={1}>
            {dateLabel}
          </Text>
        </View>

        <Text style={styles.rowUser} numberOfLines={1}>
          {item.username || 'Bilinmeyen kullanıcı'}
        </Text>

        {item.caption ? (
          <Text style={styles.rowCaption} numberOfLines={2}>
            {item.caption}
          </Text>
        ) : (
          <Text style={styles.rowCaptionEmpty}>(Caption yok)</Text>
        )}

        {hasVideo && (
          <Text style={styles.rowVideo} numberOfLines={1}>
            📹 {item.videoUri}
          </Text>
        )}
      </View>
    );
  };

  const keyExtractor = (item: InstagramLogItem) => String(item.id);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Instagram paylaşımları</Text>
        <Text style={styles.headerSub}>
          Bu liste, Viral içinden Instagram&apos;a gönderilmek üzere
          backend&apos;e düşen mock istekleri gösterir.
        </Text>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={refresh}
            style={styles.headerButton}
            activeOpacity={0.8}
          >
            <Text style={styles.headerButtonText}>Yenile</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleClose}
            style={[styles.headerButton, styles.headerCloseButton]}
            activeOpacity={0.8}
          >
            <Text style={[styles.headerButtonText, styles.headerCloseText]}>
              Kapat
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
          <Text style={styles.centerText}>Loglar yükleniyor...</Text>
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Henüz hiçbir paylaşım logu yok.</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
  },
  headerSub: {
    marginTop: 4,
    fontSize: 13,
    color: '#666',
  },
  headerActions: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  headerButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eee',
  },
  headerCloseButton: {
    backgroundColor: '#111',
  },
  headerButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  headerCloseText: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  row: {
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  rowId: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ff6f00',
  },
  rowTime: {
    fontSize: 11,
    color: '#777',
    marginLeft: 8,
    flexShrink: 1,
    textAlign: 'right',
  },
  rowUser: {
    fontSize: 13,
    fontWeight: '600',
    color: '#222',
    marginBottom: 2,
  },
  rowCaption: {
    fontSize: 13,
    color: '#444',
  },
  rowCaptionEmpty: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  rowVideo: {
    marginTop: 4,
    fontSize: 11,
    color: '#2962ff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerText: {
    marginTop: 6,
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
  },
});

export default InstagramLogsScreen;
