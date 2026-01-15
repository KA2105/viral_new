import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';

type Props = {
  minAge?: number; // default 16
  onPassed: (birthDateISO: string) => void; // "YYYY-MM-DD"
  onRejected: () => void;
};

function isValidISODate(iso: string) {
  // YYYY-MM-DD (çok basit doğrulama)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;

  const dt = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return false;

  // Ay/dönüşüm kontrolü
  const uy = dt.getUTCFullYear();
  const um = dt.getUTCMonth() + 1;
  const ud = dt.getUTCDate();
  return uy === y && um === m && ud === d;
}

function calcAgeFromISO(iso: string) {
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const today = new Date();
  let age = today.getFullYear() - y;
  const mm = today.getMonth() + 1;
  const dd = today.getDate();
  if (mm < m || (mm === m && dd < d)) age -= 1;
  return age;
}

const AgeGateScreen: React.FC<Props> = ({
  minAge = 16,
  onPassed,
  onRejected,
}) => {
  const [birth, setBirth] = useState('');
  const hint = useMemo(() => `Doğum tarihin (YYYY-AA-GG)`, []);

  const handleContinue = () => {
    const iso = birth.trim();
    if (!isValidISODate(iso)) {
      Alert.alert('Uyarı', 'Lütfen doğum tarihini YYYY-AA-GG formatında gir.');
      return;
    }

    const age = calcAgeFromISO(iso);
    if (age < minAge) {
      onRejected();
      return;
    }

    onPassed(iso);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>16+ Doğrulama</Text>
        <Text style={styles.subtitle}>
          Devam etmek için doğum tarihini girmen gerekiyor.
        </Text>

        <TextInput
          value={birth}
          onChangeText={setBirth}
          placeholder={hint}
          placeholderTextColor="#999"
          style={styles.input}
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.primaryBtn} onPress={handleContinue}>
          <Text style={styles.primaryBtnText}>Devam Et</Text>
        </TouchableOpacity>

        <Text style={styles.small}>
          Girilen bilgi sadece yaş kontrolü için kullanılır.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
};

export default AgeGateScreen;

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
    marginBottom: 12,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: '#2A2F47',
    backgroundColor: '#0F1320',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: '#E50914',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  small: {
    marginTop: 10,
    fontSize: 11,
    color: '#aab2d6',
  },
});
