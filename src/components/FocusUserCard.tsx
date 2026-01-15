// src/components/FocusUserCard.tsx
import React, { FC, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import type { FocusUser } from '../store/useFocusNetwork';

const VIRAL_RED = '#E50914';

type Props = {
  user: FocusUser;
  onToggle: () => void;
};

export const FocusUserCard: FC<Props> = ({ user, onToggle }) => {
  const initials = useMemo(() => {
    if (user.fullName) {
      return user.fullName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(p => p[0]?.toUpperCase())
        .join('');
    }
    if (user.username) {
      return user.username[0]?.toUpperCase() ?? '?';
    }
    return '?';
  }, [user.fullName, user.username]);

  return (
    <View style={styles.card}>
      <View style={styles.left}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        <View style={styles.textContainer}>
          <Text style={styles.username}>@{user.username}</Text>
          {user.fullName ? (
            <Text style={styles.fullName}>{user.fullName}</Text>
          ) : null}
          {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        </View>
      </View>

      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.button,
          user.isInNetwork ? styles.buttonSecondary : styles.buttonPrimary,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text
          style={[
            styles.buttonText,
            user.isInNetwork && styles.buttonTextSecondary,
          ]}
        >
          {user.isInNetwork ? 'Ağımdan çıkar' : 'Ağıma ekle'}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E1E1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 18,
  },
  textContainer: {
    marginLeft: 10,
    flexShrink: 1,
  },
  username: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  fullName: {
    color: '#CCCCCC',
    fontSize: 13,
    marginTop: 2,
  },
  bio: {
    color: '#888888',
    fontSize: 12,
    marginTop: 2,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  buttonPrimary: {
    backgroundColor: VIRAL_RED,
    borderColor: VIRAL_RED,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderColor: '#555555',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonTextSecondary: {
    color: '#FFFFFF',
  },
});
