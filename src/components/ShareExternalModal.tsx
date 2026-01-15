// src/components/ShareExternalModal.tsx
import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useSocialAccounts } from '../store/useSocialAccounts';

const logos = {
  instagram: require('../assets/icons/instagram.png'),
  tiktok: require('../assets/icons/tiktok.png'),
  youtube: require('../assets/icons/youtube.png'),
};

export default function ShareExternalModal({ visible, onClose, onShare }) {
  const { connected } = useSocialAccounts();

  const connectedPlatforms = Object.entries(connected)
    .filter(([_, isOn]) => isOn)
    .map(([p]) => p);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.box}>

          <Text style={styles.title}>Bağlı hesaplarda paylaş</Text>

          <View style={styles.row}>
            {connectedPlatforms.map((p) => (
              <TouchableOpacity key={p} style={styles.iconButton} onPress={() => onShare(p)}>
                <Image source={logos[p]} style={styles.icon} />
              </TouchableOpacity>
            ))}
          </View>

          {connectedPlatforms.length > 1 && (
            <TouchableOpacity style={styles.allButton} onPress={() => onShare('all')}>
              <Text style={styles.allText}>Tüm hesaplarda paylaş</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  box: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 15 },
  row: { flexDirection: 'row', gap: 18, marginBottom: 20 },
  iconButton: { padding: 10 },
  icon: { width: 40, height: 40, borderRadius: 8 },
  allButton: {
    backgroundColor: '#E50914',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  allText: { color: '#fff', fontWeight: '700' },
  cancel: { marginTop: 12, padding: 10 },
  cancelText: { color: '#666', textAlign: 'center' },
});
