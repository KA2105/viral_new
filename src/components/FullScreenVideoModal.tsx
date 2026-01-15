// src/components/FullScreenVideoModal.tsx
import React from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Text,
} from 'react-native';
import Video from 'react-native-video';

type Props = {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
};

const FullScreenVideoModal: React.FC<Props> = ({ visible, uri, onClose }) => {
  if (!uri) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>

        <Video
          source={{ uri }}
          style={styles.video}
          resizeMode="contain"
          controls={true}       // video kontrol barı
          paused={false}        // modal açıldığında oynat
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 100,
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 10,
    borderRadius: 20,
  },
  closeText: {
    fontSize: 22,
    color: '#fff',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});

export default FullScreenVideoModal;
