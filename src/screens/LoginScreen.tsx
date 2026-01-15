// src/screens/LoginScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../store/useAuth';
import { useTranslation } from 'react-i18next';

type Props = {
  onGoRegister?: () => void;
};

const VIRAL_RED = '#E50914';

// Dil tercihini farklı isimlerle kaydetmiş olabilirsin diye birkaç anahtar deniyoruz.
const LANG_KEYS = ['viral_language', 'app_language', 'language', 'i18nextLng'];

export default function LoginScreen({ onGoRegister }: Props) {
  const { t, i18n } = useTranslation();

  const {
    hydrated,
    sessionActive,
    isSyncing,
    loginWithCredentials,
    uiError,
    uiErrorField,
    clearUiError,
    switchUser,
  } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [pwd, setPwd] = useState('');

  // ✅ Ekran açılırken en son seçilen dili uygula (logout/switch user sonrası TR’ye dönmesin)
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        for (const k of LANG_KEYS) {
          const v = await AsyncStorage.getItem(k);
          const lang = (v ?? '').trim();
          if (lang) {
            if (!alive) return;
            if (i18n.language !== lang) {
              await i18n.changeLanguage(lang);
            }
            break;
          }
        }
      } catch (e) {
        console.warn('[LoginScreen] load language failed:', e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [i18n]);

  const title = useMemo(() => {
    if (!hydrated) return t('common.loading', 'Yükleniyor...');
    // Session aktif olsa bile login ekranı görünebiliyorsa, login title daha mantıklı.
    if (sessionActive) return t('auth.login.title', 'Giriş Yap');
    return t('auth.welcome.title', 'Hoş geldin 👋');
  }, [hydrated, sessionActive, t]);

  const subtitle = useMemo(() => {
    if (!hydrated) return '';
    return t('auth.welcome.subtitle', 'E-posta/telefon ve şifren ile giriş yap.');
  }, [hydrated, t]);

  const handleLogin = async () => {
    if (typeof clearUiError === 'function') clearUiError();

    const res = await loginWithCredentials({ identifier, password: pwd });
    if (!res.ok) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        res.error || t('auth.errors.unknown', 'Bir şeyler ters gitti. Tekrar dene.'),
      );
      return;
    }
    setPwd('');
  };

  const handleSwitchUser = () => {
    try {
      Alert.alert(
        t('auth.switch.confirmTitle', 'Kullanıcı değiştir'),
        t(
          'auth.switch.confirmBody',
          'Alanlar temizlenecek. Giriş için e-posta/telefon + şifre gerekir.',
        ),
        [
          { text: t('auth.switch.confirmNo', 'Vazgeç'), style: 'cancel' },
          {
            text: t('auth.switch.confirmYes', 'Devam'),
            style: 'destructive',
            onPress: () => {
              try {
                switchUser();
                setIdentifier('');
                setPwd('');
              } catch (e) {
                console.warn('[LoginScreen] switchUser failed:', e);
              }
            },
          },
        ],
      );
    } catch (e) {
      console.warn('[LoginScreen] switchUser failed:', e);
    }
  };

  const idBorder = uiErrorField === 'identifier' ? '#b00020' : '#ddd';
  const pwdBorder = uiErrorField === 'password' ? '#b00020' : '#ddd';

  return (
    <View style={s.root}>
      <Text style={s.title}>{t('common.appName', 'Viral')}</Text>
      <Text style={s.sub}>{title}</Text>
      {!!subtitle ? <Text style={s.sub2}>{subtitle}</Text> : null}

      <TextInput
        style={[s.input, { borderColor: idBorder }]}
        placeholder={t('auth.login.identifierLabel', 'E-posta / Telefon / Kullanıcı adı')}
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        keyboardType="default"
      />

      <TextInput
        style={[s.input, { borderColor: pwdBorder }]}
        placeholder={t('auth.login.passwordLabel', 'Şifre')}
        value={pwd}
        onChangeText={setPwd}
        secureTextEntry
      />

      {!!uiError ? <Text style={s.err}>{uiError}</Text> : null}

      <TouchableOpacity style={s.btn} onPress={handleLogin} activeOpacity={0.9} disabled={isSyncing}>
        <Text style={s.btnText}>
          {isSyncing ? t('common.loading', 'Yükleniyor...') : t('auth.login.loginButton', 'Giriş Yap')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.linkBtn} onPress={() => onGoRegister?.()} activeOpacity={0.9}>
        <Text style={s.linkText}>{t('auth.welcome.secondary', 'Yeni Hesap Oluştur')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.switchBtn} onPress={handleSwitchUser} activeOpacity={0.9}>
        <Text style={s.switchText}>{t('auth.login.switchUser', 'Kullanıcı değiştir')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f6f6f9',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  sub: {
    textAlign: 'center',
    color: '#111',
    fontWeight: '800',
    marginBottom: 6,
    fontSize: 18,
  },
  sub2: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  btn: {
    marginTop: 10,
    backgroundColor: VIRAL_RED,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  err: {
    marginTop: 2,
    marginBottom: 6,
    textAlign: 'center',
    color: '#b00020',
    fontSize: 13,
  },
  linkBtn: {
    marginTop: 12,
    alignItems: 'center',
  },
  linkText: {
    color: '#111',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  switchBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  switchText: {
    color: '#111',
    fontWeight: '800',
    fontSize: 14,
  },
});
