// App.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StatusBar,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import './src/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';

import FeedScreen from './src/screens/FeedScreen';
import UploadScreen from './src/screens/UploadScreen';
import TasksScreen from './src/screens/TasksScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { useAuth } from './src/store/useAuth';

import { useTranslation } from 'react-i18next';

import { useOnboarding } from './src/store/useOnboarding';
import OnboardingScreen from './src/screens/OnboardingScreen';

import InstagramLogsScreen from './src/screens/InstagramLogsScreen';
import FocusNetworkScreen from './src/screens/FocusNetworkScreen';
import AgeGateScreen from './src/screens/AgeGateScreen';

// ✅ EK: API health-check + forgot/reset password için
import {
  API_BASE_URL,
  getUserMessage,
  postForgotPassword,
  postResetPassword,
} from './src/config/api';

type Screen =
  | 'Feed'
  | 'Upload'
  | 'Tasks'
  | 'Profile'
  | 'InstagramLogs'
  | 'FocusNetwork';

/* ----------------- Giriş / Kayıt Ekranı ----------------- */

type AuthMode = 'register' | 'login' | 'forgotStep1' | 'forgotStep2';
type ResetChannel = 'email' | 'phone';

// ✅ lastError içinden email-taken / phone-taken gibi hataları daha okunur hale getir
function parseAuthBackendError(err: string | null | undefined) {
  if (!err) return null;

  const raw = String(err);

  const m = raw.match(/\{[\s\S]*\}$/);
  if (m?.[0]) {
    try {
      const j = JSON.parse(m[0]);
      if (j?.error === 'email-taken') {
        return j?.message || 'Bu e-posta başka bir hesapta kayıtlı.';
      }
      if (j?.error === 'phone-taken') {
        return j?.message || 'Bu telefon başka bir hesapta kayıtlı.';
      }
      if (typeof j?.message === 'string' && j.message.trim().length) return j.message;
    } catch {}
  }

  if (raw.includes('email-taken')) return 'Bu e-posta başka bir hesapta kayıtlı.';
  if (raw.includes('phone-taken')) return 'Bu telefon başka bir hesapta kayıtlı.';
  return raw;
}

// ✅ EK: App.tsx’in “logout sadece butonla” kuralı için callback
type AuthScreenProps = {
  onAuthed?: () => void; // login/register başarılı olunca çağrılır
};

function AuthScreen({ onAuthed }: AuthScreenProps) {
  const { t } = useTranslation();

  const {
    profile,
    saveProfile,
    loginWithCredentials,

    switchUser,
    uiError,
    uiErrorField,
    clearUiError,
    prefillRegister,

    sessionActive,
    isSyncing,
    lastError,

    signOut: _signOut,
    logout: _logout,
    reset: _reset,
  } = useAuth() as any;

  const signOut =
    _signOut ??
    _logout ??
    _reset ??
    (() => {
      console.warn('[AuthScreen] signOut/logout fonksiyonu bulunamadı.');
    });

  const [mode, setMode] = useState<AuthMode>('register');
  const [registerPending, setRegisterPending] = useState(false);
  const [forgotPending, setForgotPending] = useState(false);
  const [resetPending, setResetPending] = useState(false);

  // ✅ Login formu: identifier + password
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Kayıt formu
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');

  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegPasswordConfirm, setShowRegPasswordConfirm] = useState(false);

  // Şifremi unuttum
  const [resetChannel, setResetChannel] = useState<ResetChannel>('email');
  const [resetValue, setResetValue] = useState('');
  const [resetCodeInput, setResetCodeInput] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetNewPasswordConfirm, setResetNewPasswordConfirm] = useState('');
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetNewPasswordConfirm, setShowResetNewPasswordConfirm] = useState(false);

  // ✅ Profil bilgilerini kayıt formuna doldur (prefillRegister=true iken)
  useEffect(() => {
    if (!profile) return;
    if (!prefillRegister) return;
    setRegFullName(profile.fullName || '');
    setRegEmail(profile.email || '');
    setRegPhone(profile.phone || '');
  }, [profile, prefillRegister]);

  // ✅ Kullanıcı değiştir (prefillRegister=false) modunda otomatik mod değiştirme yapma
  useEffect(() => {
    if (!prefillRegister) return;
    setMode('register');
  }, [prefillRegister]);

  const resetAllAuthInputs = () => {
    setRegFullName('');
    setRegEmail('');
    setRegPhone('');
    setRegPassword('');
    setRegPasswordConfirm('');
    setLoginIdentifier('');
    setLoginPassword('');
    setResetValue('');
    setResetCodeInput('');
    setResetNewPassword('');
    setResetNewPasswordConfirm('');
    setShowRegPassword(false);
    setShowRegPasswordConfirm(false);
    setShowLoginPassword(false);
    setShowResetNewPassword(false);
    setShowResetNewPasswordConfirm(false);
  };

  const handleRegister = async () => {
    if (registerPending || isSyncing) return;

    if (!regFullName.trim() || !regEmail.trim() || !regPhone.trim()) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.register.requiredFields', 'Ad, e-posta ve telefon zorunludur.'),
      );
      return;
    }
    if (!regPassword || !regPasswordConfirm) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.register.passwordRequired', 'Şifre ve şifre tekrarı zorunludur.'),
      );
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.register.passwordMismatch', 'Şifre ve şifre tekrarı aynı olmalı.'),
      );
      return;
    }

    try {
      if (typeof clearUiError === 'function') clearUiError();
      setRegisterPending(true);

      const result = await saveProfile({
        fullName: regFullName,
        email: regEmail,
        phone: regPhone,
        password: regPassword,
      });

      if (!result?.ok) {
        const readable =
          parseAuthBackendError(result?.error) ||
          t('auth.register.failed', 'Kayıt oluşturulamadı.');
        Alert.alert(t('common.error', 'Hata'), readable);
        return;
      }

      Alert.alert(
        t('auth.register.welcomeTitle', 'Hoş geldin'),
        t('auth.register.welcomeBody', 'Hesabın oluşturuldu.'),
      );

      if (typeof onAuthed === 'function') onAuthed();
    } catch (e) {
      console.warn('[AuthScreen] handleRegister error:', e);
      Alert.alert(
        t('common.error', 'Hata'),
        t('auth.register.failedTryAgain', 'Kayıt oluşturulamadı. Lütfen tekrar dene.'),
      );
    } finally {
      setRegisterPending(false);
    }
  };

  const handleLogin = async () => {
    if (!loginIdentifier.trim()) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.login.identifierRequired', 'E-posta veya telefon yazmalısın.'),
      );
      return;
    }
    if (!loginPassword) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.login.passwordRequired', 'Şifreni yazmalısın.'),
      );
      return;
    }

    if (typeof clearUiError === 'function') clearUiError();

    const result = await loginWithCredentials({
      identifier: loginIdentifier.trim(),
      password: loginPassword,
    });

    if (!result.ok) {
      Alert.alert(
        t('common.error', 'Hata'),
        result.error || t('auth.login.failed', 'Giriş yapılamadı.'),
      );
      return;
    }

    setLoginPassword('');
    if (typeof onAuthed === 'function') onAuthed();
  };

  const handleStartForgot = () => {
    setResetValue('');
    setResetCodeInput('');
    setResetNewPassword('');
    setResetNewPasswordConfirm('');
    setResetChannel('email');
    setMode('forgotStep1');
  };

  const handleSendResetCode = async () => {
    if (forgotPending) return;

    if (!resetValue.trim()) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        resetChannel === 'email'
          ? t('auth.forgot.emailRequired', 'Lütfen kayıtlı e-posta adresini gir.')
          : t('auth.forgot.phoneRequired', 'Lütfen kayıtlı telefon numaranı gir.'),
      );
      return;
    }

    try {
      if (typeof clearUiError === 'function') clearUiError();
      setForgotPending(true);

      const result = await postForgotPassword({
        identifier: resetValue.trim(),
      });

      Alert.alert(
        t('auth.forgot.codeSentTitle', 'Kod gönderildi'),
        result?.message || t('auth.forgot.codeSentBody', 'Doğrulama kodu gönderildi.'),
      );

      // ✅ Telefon tarafı backend’de henüz tam aktif değil; step2’ye sadece email için geç
      if (resetChannel === 'email') {
        setMode('forgotStep2');
      }
    } catch (e) {
      console.warn('[AuthScreen] handleSendResetCode error:', e);
      Alert.alert(
        t('common.error', 'Hata'),
        getUserMessage(e, t('auth.forgot.codeFailed', 'Kod gönderilemedi.')),
      );
    } finally {
      setForgotPending(false);
    }
  };

  const handleResetPassword = async () => {
    if (resetPending) return;

    const cleanCode = resetCodeInput.replace(/\D+/g, '').slice(0, 6);

    if (!cleanCode) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.forgot.codeRequired', 'Doğrulama kodunu gir.'),
      );
      return;
    }

    if (cleanCode.length !== 6) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.forgot.codeMustBe6', 'Doğrulama kodu 6 haneli olmalı.'),
      );
      return;
    }

    if (!resetNewPassword || !resetNewPasswordConfirm) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.forgot.newPasswordRequired', 'Yeni şifre ve tekrarını yazmalısın.'),
      );
      return;
    }

    if (resetNewPassword !== resetNewPasswordConfirm) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.forgot.newPasswordMismatch', 'Yeni şifreler aynı olmalı.'),
      );
      return;
    }

    if (resetNewPassword.length < 8) {
      Alert.alert(
        t('common.warning', 'Uyarı'),
        t('auth.forgot.passwordMin8', 'Yeni şifre en az 8 karakter olmalı.'),
      );
      return;
    }

    try {
      if (typeof clearUiError === 'function') clearUiError();
      setResetPending(true);

      const result = await postResetPassword({
        identifier: resetValue.trim(),
        code: cleanCode,
        newPassword: resetNewPassword,
      });

      Alert.alert(
        t('common.success', 'Başarılı'),
        result?.message ||
          t(
            'auth.forgot.updatedBody',
            'Şifren güncellendi. Şimdi yeni şifrenle giriş yapabilirsin.',
          ),
      );

      setResetCodeInput('');
      setResetNewPassword('');
      setResetNewPasswordConfirm('');
      setMode('login');
    } catch (e) {
      console.warn('[AuthScreen] handleResetPassword error:', e);
      Alert.alert(
        t('common.error', 'Hata'),
        getUserMessage(e, t('auth.forgot.updateFailed', 'Şifre sıfırlanamadı.')),
      );
    } finally {
      setResetPending(false);
    }
  };

  const handleSwitchUserUi = () => {
    Alert.alert(
      t('auth.switch.title', 'Kullanıcı değiştir'),
      t('auth.switch.body', 'Alanlar temizlenecek. Giriş için e-posta/telefon + şifre gerekir.'),
      [
        { text: t('common.cancel', 'Vazgeç'), style: 'cancel' },
        {
          text: t('common.continue', 'Devam'),
          style: 'destructive',
          onPress: () => {
            if (typeof switchUser === 'function') {
              switchUser();
            } else if (typeof signOut === 'function') {
              signOut();
            }

            resetAllAuthInputs();
            setMode('login');
          },
        },
      ],
    );
  };

  const inlineError = useMemo(() => {
    if (uiError && String(uiError).trim().length) return String(uiError);
    if (lastError && String(lastError).trim().length) return String(lastError);
    return null;
  }, [uiError, lastError]);

  const borderFor = (field: any) => (uiErrorField === field ? '#b00020' : '#ddd');

  // -------- REGISTER --------
  if (mode === 'register') {
    return (
      <View style={styles.authRoot}>
        <Text style={styles.authTitle}>{t('auth.welcome.title', 'Hoş geldin 👋')}</Text>
        <Text style={styles.authSubtitle}>
          {t('auth.register.subtitle', 'Gerçek kullanıcılar için kayıt formu.')}
        </Text>

        <Text style={styles.authLabel}>{t('auth.register.fullNameLabel', 'Ad Soyad')}</Text>
        <TextInput
          placeholder={t('auth.register.fullNamePlaceholder', 'Ad Soyad')}
          value={regFullName}
          onChangeText={setRegFullName}
          style={[styles.authInput, { borderColor: '#ddd' }]}
        />

        <Text style={styles.authLabel}>{t('auth.register.emailLabel', 'E-posta')}</Text>
        <TextInput
          placeholder={t('auth.register.emailPlaceholder', 'ornek@mail.com')}
          value={regEmail}
          onChangeText={setRegEmail}
          style={[styles.authInput, { borderColor: borderFor('email') }]}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.authLabel}>{t('auth.register.phoneLabel', 'Telefon')}</Text>
        <View style={styles.authPhoneRow}>
          <View style={styles.authCountryBox}>
            <Text style={styles.authCountryCodeText}>+90</Text>
          </View>
          <TextInput
            placeholder={t('auth.register.phonePlaceholder', '5xx xxx xx xx')}
            value={regPhone}
            onChangeText={setRegPhone}
            style={[
              styles.authInput,
              styles.authPhoneInput,
              { borderColor: borderFor('phone') },
            ]}
            keyboardType="phone-pad"
          />
        </View>

        <Text style={styles.authLabel}>{t('auth.register.passwordLabel', 'Şifre')}</Text>
        <View style={styles.authPasswordRow}>
          <TextInput
            placeholder={t('auth.register.passwordPlaceholder', 'Şifren')}
            value={regPassword}
            onChangeText={setRegPassword}
            style={[
              styles.authInput,
              styles.authPasswordInput,
              { borderColor: borderFor('password') },
            ]}
            secureTextEntry={!showRegPassword}
          />
          <TouchableOpacity
            style={styles.authShowPasswordBtn}
            onPress={() => setShowRegPassword(prev => !prev)}
          >
            <Text style={styles.authShowPasswordText}>
              {showRegPassword ? t('common.hide', 'Gizle') : t('common.show', 'Göster')}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.authLabel}>
          {t('auth.register.passwordConfirmLabel', 'Şifre (tekrar)')}
        </Text>
        <View style={styles.authPasswordRow}>
          <TextInput
            placeholder={t('auth.register.passwordConfirmPlaceholder', 'Şifre tekrar')}
            value={regPasswordConfirm}
            onChangeText={setRegPasswordConfirm}
            style={[styles.authInput, styles.authPasswordInput]}
            secureTextEntry={!showRegPasswordConfirm}
          />
          <TouchableOpacity
            style={styles.authShowPasswordBtn}
            onPress={() => setShowRegPasswordConfirm(prev => !prev)}
          >
            <Text style={styles.authShowPasswordText}>
              {showRegPasswordConfirm ? t('common.hide', 'Gizle') : t('common.show', 'Göster')}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.authPasswordHint}>
          {t(
            'auth.register.passwordHint',
            'Şifre en az 8 karakter olmalı; büyük/küçük harf, rakam ve işaret içermeli.',
          )}
        </Text>

        {!!inlineError ? (
          <Text style={{ color: '#b00020', marginTop: 8, marginBottom: 2, fontSize: 13 }}>
            {inlineError}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.authButton}
          onPress={handleRegister}
          disabled={registerPending || isSyncing}
        >
          <Text style={styles.authButtonText}>
            {registerPending || isSyncing
              ? t('common.saving', 'Kaydediliyor...')
              : t('auth.register.submit', 'Kayıt Ol')}
          </Text>
        </TouchableOpacity>

        {registerPending || isSyncing ? (
          <View style={{ marginTop: 10, alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : null}

        <TouchableOpacity style={styles.authLinkBtn} onPress={() => setMode('login')}>
          <Text style={styles.authLinkText}>
            {t('auth.login.haveAccount', 'Zaten hesabın var mı? Giriş Yap')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.authLinkBtn, { marginTop: 6 }]}
          onPress={handleSwitchUserUi}
        >
          <Text style={styles.authLinkText}>
            {t('auth.login.switchUser', 'Kullanıcı Değiştir')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // -------- FORGOT STEP 1 --------
  if (mode === 'forgotStep1') {
    return (
      <View style={styles.authRoot}>
        <Text style={styles.authTitle}>{t('auth.forgot.title', 'Şifremi Unuttum')}</Text>
        <Text style={styles.authSubtitle}>
          {t(
            'auth.forgot.subtitle',
            'Kayıtlı e-posta adresin veya telefon numaran ile doğrulama kodu alabilirsin.',
          )}
        </Text>

        <View style={styles.resetChannelRow}>
          <TouchableOpacity
            style={[
              styles.resetChannelChip,
              resetChannel === 'email' && styles.resetChannelChipActive,
            ]}
            onPress={() => setResetChannel('email')}
          >
            <Text
              style={[
                styles.resetChannelText,
                resetChannel === 'email' && styles.resetChannelTextActive,
              ]}
            >
              {t('auth.forgot.channelEmail', 'E-posta')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.resetChannelChip,
              resetChannel === 'phone' && styles.resetChannelChipActive,
            ]}
            onPress={() => setResetChannel('phone')}
          >
            <Text
              style={[
                styles.resetChannelText,
                resetChannel === 'phone' && styles.resetChannelTextActive,
              ]}
            >
              {t('auth.forgot.channelPhone', 'Telefon')}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          placeholder={
            resetChannel === 'email'
              ? t('auth.forgot.emailPlaceholder', 'Kayıtlı e-posta adresin')
              : t('auth.forgot.phonePlaceholder', 'Kayıtlı telefon numaran')
          }
          value={resetValue}
          onChangeText={setResetValue}
          style={styles.authInput}
          keyboardType={resetChannel === 'email' ? 'email-address' : 'phone-pad'}
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={styles.authButton}
          onPress={handleSendResetCode}
          disabled={forgotPending}
        >
          <Text style={styles.authButtonText}>
            {forgotPending
              ? t('common.loading', 'Gönderiliyor...')
              : t('auth.forgot.sendCode', 'Doğrulama Kodu Gönder')}
          </Text>
        </TouchableOpacity>

        {forgotPending ? (
          <View style={{ marginTop: 10, alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : null}

        <TouchableOpacity style={styles.authLinkBtn} onPress={() => setMode('login')}>
          <Text style={styles.authLinkText}>
            {t('auth.login.backToLogin', '← Giriş ekranına dön')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.authLinkBtn, { marginTop: 6 }]}
          onPress={handleSwitchUserUi}
        >
          <Text style={styles.authLinkText}>
            {t('auth.login.switchUser', 'Kullanıcı Değiştir')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // -------- FORGOT STEP 2 --------
  if (mode === 'forgotStep2') {
    return (
      <View style={styles.authRoot}>
        <Text style={styles.authTitle}>{t('auth.forgot.verifyTitle', 'Kodu Doğrula')}</Text>
        <Text style={styles.authSubtitle}>
          {t('auth.forgot.verifySubtitle', 'Gelen doğrulama kodunu ve yeni şifreni gir.')}
        </Text>

        <TextInput
          placeholder={t('auth.forgot.codePlaceholder', 'Doğrulama kodu')}
          value={resetCodeInput}
          onChangeText={(v) => setResetCodeInput(v.replace(/\D+/g, '').slice(0, 6))}
          style={styles.authInput}
          keyboardType="number-pad"
          maxLength={6}
        />

        <View style={styles.authPasswordRow}>
          <TextInput
            placeholder={t('auth.forgot.newPasswordPlaceholder', 'Yeni şifre')}
            value={resetNewPassword}
            onChangeText={setResetNewPassword}
            style={[styles.authInput, styles.authPasswordInput]}
            secureTextEntry={!showResetNewPassword}
          />
          <TouchableOpacity
            style={styles.authShowPasswordBtn}
            onPress={() => setShowResetNewPassword((p) => !p)}
          >
            <Text style={styles.authShowPasswordText}>
              {showResetNewPassword ? t('common.hide', 'Gizle') : t('common.show', 'Göster')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.authPasswordRow}>
          <TextInput
            placeholder={t('auth.forgot.newPasswordConfirmPlaceholder', 'Yeni şifre (tekrar)')}
            value={resetNewPasswordConfirm}
            onChangeText={setResetNewPasswordConfirm}
            style={[styles.authInput, styles.authPasswordInput]}
            secureTextEntry={!showResetNewPasswordConfirm}
          />
          <TouchableOpacity
            style={styles.authShowPasswordBtn}
            onPress={() => setShowResetNewPasswordConfirm((p) => !p)}
          >
            <Text style={styles.authShowPasswordText}>
              {showResetNewPasswordConfirm ? t('common.hide', 'Gizle') : t('common.show', 'Göster')}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.authButton}
          onPress={handleResetPassword}
          disabled={resetPending}
        >
          <Text style={styles.authButtonText}>
            {resetPending
              ? t('common.loading', 'Güncelleniyor...')
              : t('auth.forgot.updateButton', 'Şifreyi Güncelle')}
          </Text>
        </TouchableOpacity>

        {resetPending ? (
          <View style={{ marginTop: 10, alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : null}

        <TouchableOpacity style={styles.authLinkBtn} onPress={() => setMode('login')}>
          <Text style={styles.authLinkText}>
            {t('auth.login.backToLogin', '← Giriş ekranına dön')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.authLinkBtn, { marginTop: 6 }]}
          onPress={handleSwitchUserUi}
        >
          <Text style={styles.authLinkText}>
            {t('auth.login.switchUser', 'Kullanıcı Değiştir')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // -------- LOGIN --------
  return (
    <View style={styles.authRoot}>
      <Text style={styles.authTitle}>{t('auth.login.title', 'Giriş Yap')}</Text>
      <Text style={styles.authSubtitle}>
        {t('auth.login.subtitle', 'E-posta/telefon ve şifren ile giriş yap.')}
      </Text>

      <TextInput
        placeholder={t('auth.login.identifierPlaceholder', 'E-posta veya Telefon')}
        value={loginIdentifier}
        onChangeText={setLoginIdentifier}
        style={[styles.authInput, { borderColor: borderFor('identifier') }]}
        autoCapitalize="none"
      />

      <View style={styles.authPasswordRow}>
        <TextInput
          placeholder={t('auth.login.passwordPlaceholder', 'Şifren')}
          value={loginPassword}
          onChangeText={setLoginPassword}
          style={[
            styles.authInput,
            styles.authPasswordInput,
            { borderColor: borderFor('password') },
          ]}
          secureTextEntry={!showLoginPassword}
        />
        <TouchableOpacity
          style={styles.authShowPasswordBtn}
          onPress={() => setShowLoginPassword((p) => !p)}
        >
          <Text style={styles.authShowPasswordText}>
            {showLoginPassword ? t('common.hide', 'Gizle') : t('common.show', 'Göster')}
          </Text>
        </TouchableOpacity>
      </View>

      {!!inlineError ? (
        <Text style={{ color: '#b00020', marginTop: 8, marginBottom: 2, fontSize: 13 }}>
          {inlineError}
        </Text>
      ) : null}

      <TouchableOpacity style={styles.authButton} onPress={handleLogin} disabled={isSyncing}>
        <Text style={styles.authButtonText}>
          {isSyncing
            ? t('auth.login.loading', 'Giriş...')
            : t('auth.login.loginButton', 'Giriş Yap')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.authLinkBtn} onPress={handleStartForgot}>
        <Text style={styles.authLinkText}>
          {t('auth.login.forgotPassword', 'Şifremi Unuttum')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.authLinkBtn} onPress={() => setMode('register')}>
        <Text style={styles.authLinkText}>
          {t('auth.register.cta', 'Yeni kullanıcı mısın? Kayıt Ol')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.authLinkBtn, { marginTop: 6 }]}
        onPress={handleSwitchUserUi}
      >
        <Text style={styles.authLinkText}>
          {t('auth.login.switchUser', 'Kullanıcı Değiştir')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/* ----------------- Üst Bar ----------------- */

type TopBarProps = {
  current: Screen;
  username: string;
  onNavigate: (screen: Screen) => void;
  onLogout: () => void;
};

function TopBar({ current, username, onNavigate, onLogout }: TopBarProps) {
  const { t } = useTranslation();

  const feedLabel = t('nav.feed', 'Akış');
  const uploadLabel = t('nav.upload', 'Yükle');
  const tasksLabel = t('nav.tasks', 'Görevler');
  const profileLabel = t('nav.profile', 'Profil');
  const logoutLabel = t('nav.logout', 'Çıkış');

  const tab = (label: string, screen: Screen) => {
    const active = current === screen;
    return (
      <TouchableOpacity
        key={screen}
        onPress={() => onNavigate(screen)}
        style={[styles.topTab, active && styles.topTabActive]}
      >
        <Text style={[styles.topTabText, active && styles.topTabTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.topBar}>
      <View style={styles.topRow}>
        <Text style={styles.topUser} numberOfLines={1} ellipsizeMode="tail">
          @{username}
        </Text>

        <TouchableOpacity onPress={onLogout} style={styles.topLogout}>
          <Text style={styles.topLogoutText}>{logoutLabel}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.topTabsRow}>
        {tab(feedLabel, 'Feed')}
        {tab(uploadLabel, 'Upload')}
        {tab(tasksLabel, 'Tasks')}
        {tab(profileLabel, 'Profile')}
      </View>
    </View>
  );
}

/* ----------------- Ana Uygulama ----------------- */

const AGE_GATE_PASSED_KEY = 'viral.ageGate.passed'; // "1" | ""
const AGE_GATE_BIRTH_KEY = 'viral.ageGate.birthISO'; // "YYYY-MM-DD"
const FORCE_AUTH_KEY = 'viral.forceAuthAfterLogout'; // "1" | ""

// ✅ EK: Akış’a düşecek “paylaşımdan gelen içerik” kuyruğu
const PENDING_SHARE_TO_FEED_KEY = 'viral.pendingShareToFeed';

// ✅ EK: küçük timeout’lu fetch (release’te “bekliyor” gibi kalmasın)
async function fetchWithTimeout(url: string, opts: any = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('Feed');

  const auth = useAuth() as any;

  const [authBooted, setAuthBooted] = useState(false);

  const [forceAuthHydrated, setForceAuthHydrated] = useState(false);
  const [forceAuth, setForceAuth] = useState<boolean>(false);

  const sessionActive: boolean = auth?.sessionActive === true;

  const profile = auth?.profile ?? null;
  const userId = auth?.userId ?? auth?.id ?? null;

  const signOut =
    auth?.signOut ??
    auth?.logout ??
    auth?.reset ??
    (() => {
      console.warn('[App] signOut/logout fonksiyonu bulunamadı.');
    });

  const lastError = auth?.lastError ?? null;

  const {
    hydrated: onboardingHydrated,
    seen: onboardingSeen,
    hydrate: hydrateOnboarding,
    markSeen: markOnboardingSeen,
  } = useOnboarding();

  const [ageHydrated, setAgeHydrated] = useState(false);
  const [agePassed, setAgePassed] = useState<boolean>(false);
  const [ageBlocked, setAgeBlocked] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const state = (useAuth as any).getState ? (useAuth as any).getState() : null;

        if (state) {
          if (typeof state.hydrate === 'function') {
            await state.hydrate();
          } else if (typeof state.init === 'function') {
            await state.init();
          } else {
            console.warn('[App] useAuth.getState().hydrate/init bulunamadı.');
          }
        }
      } catch (e) {
        console.warn('[App] auth hydrate/init çağrısı hata verdi:', e);
      } finally {
        setAuthBooted(true);
      }
    })();

    if (typeof hydrateOnboarding === 'function') {
      hydrateOnboarding();
    }

    (async () => {
      try {
        const passedRaw = await AsyncStorage.getItem(AGE_GATE_PASSED_KEY);
        const passed = passedRaw === '1';
        setAgePassed(passed);
        setAgeBlocked(false);
      } catch (e) {
        console.warn('[App] age gate hydrate error:', e);
        setAgePassed(false);
        setAgeBlocked(false);
      } finally {
        setAgeHydrated(true);
      }
    })();

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(FORCE_AUTH_KEY);
        setForceAuth(raw === '1');
      } catch (e) {
        console.warn('[App] FORCE_AUTH_KEY hydrate error:', e);
        setForceAuth(false);
      } finally {
        setForceAuthHydrated(true);
      }
    })();
  }, [hydrateOnboarding]);

  const handleLogout = async () => {
    try {
      await AsyncStorage.setItem(FORCE_AUTH_KEY, '1');
      setForceAuth(true);
    } catch (e) {
      console.warn('[App] set FORCE_AUTH_KEY error:', e);
    }
    signOut();
    setCurrentScreen('Feed');
  };

  const clearForceAuth = async () => {
    try {
      await AsyncStorage.removeItem(FORCE_AUTH_KEY);
    } catch (e) {
      console.warn('[App] remove FORCE_AUTH_KEY error:', e);
    } finally {
      setForceAuth(false);
    }
  };

  useEffect(() => {
    if (!sessionActive) {
      setCurrentScreen('Feed');
    }
  }, [sessionActive]);

  const username =
    profile?.fullName ||
    auth?.displayName ||
    auth?.fullName ||
    (typeof userId === 'string' ? userId : userId ? String(userId) : '') ||
    'misafir';

  // ✅ EK: Paylaşımdan gelen içerik -> direkt Akış’a düşür (UploadScreen gerekmez)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('viral_share_intent', async (payload: any) => {
      try {
        console.log('[share_intent] payload:', payload);

        // Akış’a zorla götür
        setCurrentScreen('Feed');

        // FeedScreen’in okuyacağı kuyruk anahtarı
        await AsyncStorage.setItem(
          PENDING_SHARE_TO_FEED_KEY,
          JSON.stringify({
            ts: Date.now(),
            payload: payload ?? null,
          }),
        );
      } catch (e) {
        console.warn('[share_intent] store failed:', e);
      }
    });

    return () => sub.remove();
  }, []);

  // ✅ EK: Onboarding bittiğinde “kayıt/giriş” ekranına ZORLA (misafir kafa karışıklığı biter)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('viral_force_auth', async (_payload: any) => {
      try {
        // garanti: key yaz + state set
        await AsyncStorage.setItem(FORCE_AUTH_KEY, '1');
      } catch (e) {
        console.warn('[App] viral_force_auth set FORCE_AUTH_KEY failed:', e);
      } finally {
        setForceAuth(true);
      }
    });

    return () => sub.remove();
  }, []);

  // ✅ EK: FocusNetwork’e girince API ping (server log düşmeli)
  useEffect(() => {
    if (currentScreen !== 'FocusNetwork') return;

    const uid =
      typeof userId === 'number'
        ? userId
        : typeof userId === 'string'
        ? Number(userId)
        : null;

    const safeUid = Number.isFinite(uid as any) ? (uid as number) : null;

    (async () => {
      try {
        const url = `${API_BASE_URL}/users/search?limit=1${safeUid ? `&userId=${safeUid}` : ''}`;
        console.log('[FocusNetwork] ping ->', url);

        const res = await fetchWithTimeout(url, { method: 'GET' }, 3500);
        console.log('[FocusNetwork] ping status ->', res.status);

        // bu satır önemli değil; sadece request’in tamamlandığını gösterir
        await res.text().catch(() => '');
      } catch (e) {
        console.warn('[FocusNetwork] ping failed:', e);
      }
    })();
  }, [currentScreen, userId]);

  if (!authBooted || !onboardingHydrated || !ageHydrated || !forceAuthHydrated) {
    return (
      <View style={styles.loadingRoot}>
        <StatusBar barStyle="dark-content" />
        <Text style={styles.loadingText}>Viral hazırlanıyor...</Text>
      </View>
    );
  }

  if (!agePassed && !ageBlocked) {
    return (
      <View style={[styles.appRoot, styles.appRootDefault]}>
        <StatusBar barStyle="dark-content" />
        <AgeGateScreen
          minAge={16}
          onPassed={async (birthDateISO: string) => {
            try {
              await AsyncStorage.setItem(AGE_GATE_PASSED_KEY, '1');
              await AsyncStorage.setItem(AGE_GATE_BIRTH_KEY, birthDateISO);
            } catch (e) {
              console.warn('[App] age gate save error:', e);
            }
            setAgePassed(true);
            setAgeBlocked(false);
          }}
          onRejected={() => {
            setAgeBlocked(true);
          }}
        />
      </View>
    );
  }

  if (ageBlocked) {
    return (
      <View style={[styles.loadingRoot, { paddingHorizontal: 24 }]}>
        <StatusBar barStyle="dark-content" />
        <Text style={[styles.authTitle, { textAlign: 'center' }]}>Üzgünüz</Text>
        <Text style={[styles.authSubtitle, { textAlign: 'center' }]}>
          Bu uygulama 16 yaş ve üzeri içindir.
        </Text>

        <TouchableOpacity
          style={[styles.authButton, { marginTop: 16 }]}
          onPress={() => setAgeBlocked(false)}
        >
          <Text style={styles.authButtonText}>Tekrar Dene</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!onboardingSeen) {
    return (
      <View style={[styles.appRoot, styles.appRootDefault]}>
        <StatusBar barStyle="light-content" />
        <OnboardingScreen onFinish={markOnboardingSeen} />
      </View>
    );
  }

  if (forceAuth) {
    return (
      <View style={[styles.appRoot, styles.appRootDefault]}>
        <StatusBar barStyle="dark-content" />
        <AuthScreen onAuthed={clearForceAuth} />
      </View>
    );
  }

  let content: React.ReactNode = null;

  if (currentScreen === 'Feed') {
    content = <FeedScreen go={screen => setCurrentScreen(screen)} />;
  } else if (currentScreen === 'Upload') {
    content = <UploadScreen />;
  } else if (currentScreen === 'Tasks') {
    content = <TasksScreen go={screen => setCurrentScreen(screen)} />;
  } else if (currentScreen === 'Profile') {
    content = <ProfileScreen goToInstagramLogs={() => setCurrentScreen('InstagramLogs')} />;
  } else if (currentScreen === 'InstagramLogs') {
    content = <InstagramLogsScreen onClose={() => setCurrentScreen('Profile')} />;
  } else if (currentScreen === 'FocusNetwork') {
    content = <FocusNetworkScreen onClose={() => setCurrentScreen('Feed')} />;
  }

  const isFeed = currentScreen === 'Feed';

  return (
    <View style={[styles.appRoot, isFeed ? styles.appRootFeedDark : styles.appRootDefault]}>
      <StatusBar barStyle={isFeed ? 'light-content' : 'dark-content'} />

      {__DEV__ && lastError ? (
        <View style={styles.debugBar}>
          <Text style={styles.debugText}>Auth error: {String(lastError)}</Text>
        </View>
      ) : null}

      <TopBar
        current={currentScreen}
        username={username}
        onNavigate={setCurrentScreen}
        onLogout={handleLogout}
      />

      <View style={[styles.screenContainer, isFeed && styles.screenContainerFeedDark]}>
        {content}
      </View>
    </View>
  );
};

export default App;

/* ----------------- Stiller ----------------- */

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
  appRootDefault: {
    backgroundColor: '#f7f7f7',
  },
  appRootFeedDark: {
    backgroundColor: '#0B0C10',
  },
  screenContainer: { flex: 1 },
  screenContainerFeedDark: { backgroundColor: '#0B0C10' },

  /* Auth screen */
  authRoot: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'stretch',
    backgroundColor: '#f7f7f7',
  },
  authTitle: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
    color: '#111',
  },
  authSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  authLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    marginTop: 4,
  },
  authInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  authButton: {
    marginTop: 12,
    backgroundColor: '#111',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  authButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  authPasswordHint: {
    fontSize: 11,
    color: '#777',
  },
  authPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authCountryBox: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    marginRight: 8,
  },
  authCountryCodeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  authPhoneInput: {
    flex: 1,
    marginBottom: 0,
  },
  authLinkBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  authLinkText: {
    fontSize: 13,
    color: '#1565c0',
    fontWeight: '600',
  },

  authPasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authPasswordInput: {
    flex: 1,
    marginBottom: 0,
  },
  authShowPasswordBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0f0f0',
  },
  authShowPasswordText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#444',
  },

  resetChannelRow: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 8,
  },
  resetChannelChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  resetChannelChipActive: {
    borderColor: '#1565c0',
    backgroundColor: '#e3f2fd',
  },
  resetChannelText: {
    fontSize: 12,
    color: '#333',
  },
  resetChannelTextActive: {
    fontWeight: '700',
    color: '#0d47a1',
  },

  /* Top bar */
  topBar: {
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 16,
    backgroundColor: '#0B0C10',
    borderBottomWidth: 1,
    borderBottomColor: '#1E2235',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  topUser: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    maxWidth: '70%',
  },
  topLogout: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#22263A',
  },
  topLogoutText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  topTabsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  topTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#151824',
  },
  topTabActive: {
    backgroundColor: '#E50914',
  },
  topTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D0D4E4',
  },
  topTabTextActive: {
    color: '#FFFFFF',
  },

  /* Loading */
  loadingRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f7f7f7',
  },
  loadingText: {
    fontSize: 16,
    color: '#555',
  },

  /* Debug bar */
  debugBar: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#330000',
  },
  debugText: {
    fontSize: 12,
    color: '#ffaaaa',
  },
});