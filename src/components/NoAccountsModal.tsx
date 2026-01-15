// src/components/NoAccountsModal.tsx
import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function NoAccountsModal({ visible, onClose, onInfo }) {
  const nav = useNavigation();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.box}>

          <Text style={styles.title}>Hesap bağlı değil</Text>
          <Text style={styles.msg}>
            Diğer platformlarda paylaşmak için önce hesaplarını bağlamalısın.
          </Text>

          <TouchableOpacity
            style={styles.action}
            onPress={() => {
              onClose();
              nav.navigate('Profile');
            }}
          >
            <Text style={styles.actionText}>Hesaplarımı Bağla</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Vazgeç</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.info} onPress={onInfo}>
            <Text style={styles.infoText}>ⓘ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', backgroundColor: '#0007' },
  box: {
    margin: 30,
    backgroundColor: '#fff',
    padding: 25,
    borderRadius: 16,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  msg: { fontSize: 15, color: '#444', marginBottom: 20 },
  action: {
    backgroundColor: '#E50914',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionText: { color: '#fff', fontWeight: '700' },
  cancel: { marginTop: 10 },
  cancelText: { textAlign: 'center', color: '#666' },
  info: { marginTop: 15, alignSelf: 'center' },
  infoText: { color: '#666', fontSize: 22 },
});
