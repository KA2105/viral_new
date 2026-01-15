// src/components/TopBar.tsx
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

type ScreenKey = 'Feed' | 'Upload' | 'Tasks';

type Props = {
  username: string;
  current: ScreenKey;
  onPressTab: (next: ScreenKey | 'Logout') => void;
};

const TABS: { key: ScreenKey; label: string }[] = [
  { key: 'Feed', label: 'Akış' },
  { key: 'Upload', label: 'Yükle' },
  { key: 'Tasks', label: 'Görevler' },
];

const TopBar: React.FC<Props> = ({ username, current, onPressTab }) => {
  console.log('[TopBar] render, current =', current);

  return (
    <View style={styles.root}>
      <Text style={styles.username} numberOfLines={1}>
        {username || 'misafir'}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        {TABS.map(tab => {
          const active = current === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onPressTab(tab.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          onPress={() => onPressTab('Logout')}
          style={[styles.tab, styles.logoutTab]}
        >
          <Text style={[styles.tabText, styles.logoutText]}>Çıkış</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

export default TopBar;

const styles = StyleSheet.create({
  root: {
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0B0C10',      // 🔴 Koyu arka plan (FeedScreen ile aynı)
    borderBottomWidth: 1,
    borderBottomColor: '#151824',
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    fontWeight: '700',
    marginRight: 10,
    maxWidth: 140,
    color: '#E5E7F3',               // Açık renk kullanıcı adı
  },
  tabsRow: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#151824',     // Pasif koyu pill
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#22263A',
  },
  tabActive: {
    backgroundColor: '#E50914',     // 🔴 Viral kırmızısı (aktif tab)
    borderColor: '#E50914',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C2C7E2',               // Pasif metin
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  logoutTab: {
    backgroundColor: 'transparent',
    borderColor: '#B91C1C',
  },
  logoutText: {
    color: '#FFB4B4',
  },
});
