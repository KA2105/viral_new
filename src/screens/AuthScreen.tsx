// src/screens/AuthScreen.tsx
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../store/useAuth';

const VIRAL_RED = '#E50914';

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const { isSyncing, lastError, clearError, login, register, signOut } = useAuth();

  const [mode, setMode] = useState<Mode>('login');

  // login
  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // register
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPassword2, setRegPassword2] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  const inlineError = useMemo(() => {
    const s = String(lastError ?? '').trim();
    return s.length ? s : null;
  }, [lastError]);

  const onLogin = async () => {
    clearError();

    const res = await login({ identifier, password: loginPassword });
    if (!res.ok) {
      Alert.alert('Hata', res.error);
      return;
    }
  };

  const onRegister = async () => {
    clearError();

    if (!fullName.trim() || !email.trim() || !phone.trim()) {
      Alert.alert('Uyarı', 'Ad Soyad, e-posta ve telefon zorunludur.');
      return;
    }
    if (!regPassword || regPassword.length < 8) {
      Alert.alert('Uyarı', 'Şifre en az 8 karakter olmalı.');
      return;
    }
    if (regPassword !== regPassword2) {
      Alert.alert('Uyarı', 'Şifreler aynı olmalı.');
      return;
    }

    const res = await register({ fullName, email, phone, password: regPassword });
    if (!res.ok) {
      Alert.alert('Hata', res.error);
      return;
    }
  };

  const onSwitchUser = () => {
    // ✅ Tam çıkış + formları temizle
    signOut();
    setIdentifier('');
    setLoginPassword('');
    setFullName('');
    setEmail('');
    setPhone('');
    setRegPassword('');
    setRegPassword2('');
    setMode('login');
  };

  return (
    <View style={s.root}>
      <Text style={s.h1}>{mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}</Text>
      <Text style={s.sub}>
        {mode === 'login'
          ? 'E-posta/telefon ve şifren ile giriş yap.'
          : 'Yeni hesabını oluştur.'}
      </Text>

      {mode === 'login' ? (
        <>
          <TextInput
            style={s.input}
            placeholder="E-posta / Telefon / Kullanıcı adı"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
          />

          <View style={s.pwRow}>
            <TextInput
              style={[s.input, s.pwInput]}
              placeholder="Şifre"
              value={loginPassword}
              onChangeText={setLoginPassword}
              secureTextEntry={!showLoginPassword}
            />
            <TouchableOpacity
              style={s.pwBtn}
              onPress={() => setShowLoginPassword(v => !v)}
              activeOpacity={0.9}
            >
              <Text style={s.pwBtnText}>{showLoginPassword ? 'Gizle' : 'Göster'}</Text>
            </TouchableOpacity>
          </View>

          {inlineError ? <Text style={s.err}>{inlineError}</Text> : null}

          <TouchableOpacity style={s.btnPrimary} onPress={onLogin} disabled={isSyncing} activeOpacity={0.9}>
            {isSyncing ? <ActivityIndicator /> : <Text style={s.btnPrimaryText}>Giriş Yap</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.linkBtn} onPress={() => setMode('register')} activeOpacity={0.9}>
            <Text style={s.linkText}>Yeni kullanıcı mısın? Kayıt Ol</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.ghostBtn} onPress={onSwitchUser} activeOpacity={0.9}>
            <Text style={s.ghostText}>Kullanıcı Değiştir</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput style={s.input} placeholder="Ad Soyad" value={fullName} onChangeText={setFullName} />

          <TextInput
            style={s.input}
            placeholder="E-posta"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <TextInput
            style={s.input}
            placeholder="Telefon (10 hane)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <View style={s.pwRow}>
            <TextInput
              style={[s.input, s.pwInput]}
              placeholder="Şifre"
              value={regPassword}
              onChangeText={setRegPassword}
              secureTextEntry={!showRegPassword}
            />
            <TouchableOpacity style={s.pwBtn} onPress={() => setShowRegPassword(v => !v)} activeOpacity={0.9}>
              <Text style={s.pwBtnText}>{showRegPassword ? 'Gizle' : 'Göster'}</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={s.input}
            placeholder="Şifre (tekrar)"
            value={regPassword2}
            onChangeText={setRegPassword2}
            secureTextEntry={!showRegPassword}
          />

          {inlineError ? <Text style={s.err}>{inlineError}</Text> : null}

          <TouchableOpacity style={s.btnPrimary} onPress={onRegister} disabled={isSyncing} activeOpacity={0.9}>
            {isSyncing ? <ActivityIndicator /> : <Text style={s.btnPrimaryText}>Kayıt Ol</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.linkBtn} onPress={() => setMode('login')} activeOpacity={0.9}>
            <Text style={s.linkText}>Zaten hesabın var mı? Giriş Yap</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.ghostBtn} onPress={onSwitchUser} activeOpacity={0.9}>
            <Text style={s.ghostText}>Kullanıcı Değiştir</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: '#f6f6f9' },
  h1: { fontSize: 34, fontWeight: '900', color: '#111', marginBottom: 6 },
  sub: { color: '#666', marginBottom: 16 },

  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    marginBottom: 10,
  },

  pwRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  pwInput: { flex: 1, marginBottom: 0 },
  pwBtn: { marginLeft: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#eee' },
  pwBtnText: { fontWeight: '800', color: '#333' },

  err: { color: '#b00020', marginTop: 2, marginBottom: 8, fontSize: 13 },

  btnPrimary: {
    marginTop: 6,
    backgroundColor: VIRAL_RED,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '900', fontSize: 16 },

  linkBtn: { marginTop: 14 },
  linkText: { color: '#1565c0', fontWeight: '800' },

  ghostBtn: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  ghostText: { color: '#111', fontWeight: '900' },
});
