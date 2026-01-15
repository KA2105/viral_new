import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, BackHandler } from 'react-native';

type Props = {
  minAge?: number; // default 16
};

const AccessRestrictedScreen: React.FC<Props> = ({ minAge = 16 }) => {
  const handleClose = () => {
    // Android'de uygulamayı kapatır. iOS'ta BackHandler çalışmayabilir ama sorun değil.
    try {
      BackHandler.exitApp();
    } catch {}
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Erişim Kısıtlı</Text>
        <Text style={styles.subtitle}>
          Bu uygulama {minAge}+ kullanıcılar içindir. Yaşın uygun değilse devam edemezsin.
        </Text>

        <TouchableOpacity style={styles.btn} onPress={handleClose}>
          <Text style={styles.btnText}>Kapat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default AccessRestrictedScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0C10',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  card: {
    backgroundColor: '#141826',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E2235',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#cbd2f0',
    marginBottom: 14,
    lineHeight: 18,
  },
  btn: {
    backgroundColor: '#22263A',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
