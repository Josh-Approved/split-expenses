/**
 * A modal currency picker — used wherever a currency is chosen (create group,
 * change group currency, per-expense currency). Plain searchable list.
 */

import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, FlatList, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { CURRENCIES } from '../data/currencies';
import { useTheme, fontFamily, space, radius, target, type as ty, hairline, type Colors } from '../theme';
import { useReducedMotion } from './Dialogs';
import { t } from '../i18n';

export function CurrencyPicker({
  visible,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  selected: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (cur) => cur.code.toLowerCase().includes(q) || cur.name.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Modal visible={visible} animationType={reduced ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.screen, { paddingTop: insets.top + space.s4 }]}>
        <View style={s.header}>
          <Text style={s.title} accessibilityRole="header">
            {t('currency.title')}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.done')} hitSlop={8}>
            <Text style={s.done}>{t('common.done')}</Text>
          </Pressable>
        </View>
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t('currency.search')}
          placeholderTextColor={c.fgSubtle}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <FlatList
          data={list}
          keyExtractor={(cur) => cur.code}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + space.s6 }}
          renderItem={({ item }) => {
            const active = item.code === selected;
            return (
              <Pressable
                onPress={() => {
                  onPick(item.code);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.code}`}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
              >
                <Text style={s.code}>{item.code}</Text>
                <Text style={s.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={s.symbol}>{item.symbol}</Text>
                {active ? <Check size={18} color={c.accent} /> : <View style={{ width: 18 }} />}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.s5 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.s4 },
    title: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg },
    done: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.appAccent },
    search: {
      ...ty.base,
      fontFamily: fontFamily.sans,
      color: c.fg,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.s5,
      minHeight: target.min,
      marginBottom: space.s4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: target.min + 4,
      gap: space.s4,
      borderBottomWidth: hairline,
      borderBottomColor: c.hairline,
    },
    code: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.fg, width: 52 },
    name: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgMuted, flex: 1 },
    symbol: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgSubtle, width: 36, textAlign: 'right' },
  });
}
