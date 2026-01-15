// src/components/LanguageSelector.tsx
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { availableLanguages, changeAppLanguage } from '../i18n';

const LanguageSelector: React.FC = () => {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  // Örn. "tr-TR" gelirse sadece "tr" kısmını al
  const currentCode = (i18n.language || 'tr').split('-')[0];

  const handleSelect = async (code: string) => {
    await changeAppLanguage(code);
    setOpen(false);
  };

  return (
    <View style={styles.container}>
      {/* Küçük Language butonu */}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => setOpen(prev => !prev)}
      >
        <Text style={styles.buttonText}>
          {/* Kısa gösterim: TR / EN vs. */}
          {currentCode.toUpperCase()}
        </Text>
      </Pressable>

      {/* Açılır liste */}
      {open && (
        <View style={styles.dropdown}>
          {availableLanguages.map(lang => {
            const isActive = lang.code === currentCode;
            return (
              <Pressable
                key={lang.code}
                onPress={() => handleSelect(lang.code)}
                style={({ pressed }) => [
                  styles.item,
                  isActive && styles.itemActive,
                  pressed && styles.itemPressed,
                ]}
              >
                <Text style={[styles.itemText, isActive && styles.itemTextActive]}>
                  {lang.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
};

export default LanguageSelector;

const styles = StyleSheet.create({
  container: {
    marginLeft: 8,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#ffffff',
  },
  buttonPressed: {
    backgroundColor: '#f2f2f2',
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  dropdown: {
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#ffffff',
    paddingVertical: 4,
    minWidth: 140,
    elevation: 4,
  },
  item: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  itemActive: {
    backgroundColor: '#fff7e0',
  },
  itemPressed: {
    opacity: 0.9,
  },
  itemText: {
    fontSize: 12,
    color: '#333',
  },
  itemTextActive: {
    fontWeight: '700',
    color: '#b27100',
  },
});
