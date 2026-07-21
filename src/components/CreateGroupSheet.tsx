/**
 * Create-a-group flow. Smart defaults make the common case fast: name the
 * group, keep the device's last-used currency, add a couple of people, and
 * optionally say which one is you. A low-friction "new group" is a hard
 * requirement (spec § Identity) — starting over is the cheap answer to
 * add-only membership.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Plus } from 'lucide-react-native';

import { useGroups } from '../store/groups';
import { getSetting, setSetting } from '../store/db';
import { currency, currencyLabel } from '../data/currencies';
import { useTheme, fontFamily, space, radius, target, type as ty, hairline, type Colors } from '../theme';
import { Button } from './ui';
import { CurrencyPicker } from './CurrencyPicker';
import { useReducedMotion } from './Dialogs';
import { t } from '../i18n';

const LAST_CURRENCY_KEY = 'last_base_currency';

export function CreateGroupSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const createGroup = useGroups((st) => st.createGroup);

  const [name, setName] = useState('');
  const [base, setBase] = useState('USD');
  const [names, setNames] = useState<string[]>(['', '']);
  const [meIndex, setMeIndex] = useState<number | null>(null);
  const [pickingCurrency, setPickingCurrency] = useState(false);

  // Reset + seed last-used currency each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setName('');
    setNames(['', '']);
    setMeIndex(null);
    getSetting(LAST_CURRENCY_KEY).then((v) => setBase(v || 'USD'));
  }, [visible]);

  const setNameAt = (i: number, v: string) => setNames((prev) => prev.map((n, j) => (j === i ? v : n)));
  const addRow = () => setNames((prev) => [...prev, '']);
  const removeRow = (i: number) =>
    setNames((prev) => {
      const next = prev.filter((_, j) => j !== i);
      if (meIndex === i) setMeIndex(null);
      else if (meIndex != null && meIndex > i) setMeIndex(meIndex - 1);
      return next.length ? next : [''];
    });

  const filledNames = names.map((n) => n.trim()).filter(Boolean);
  // "Me" is required: you must say which person you are before the group exists,
  // and that person must have a name.
  const meChosen = meIndex != null && !!names[meIndex]?.trim();
  const canCreate = name.trim().length > 0 && filledNames.length >= 1 && meChosen;

  const create = () => {
    if (!canCreate) return;
    // Map meIndex (over all rows) to the index within the filtered list.
    let meFiltered: number | undefined;
    if (meIndex != null) {
      const target = names[meIndex]?.trim();
      if (target) meFiltered = filledNames.indexOf(target);
    }
    void setSetting(LAST_CURRENCY_KEY, base);
    const id = createGroup({
      name,
      baseCurrency: base,
      memberNames: filledNames,
      meIndex: meFiltered,
    });
    onCreated(id);
  };

  return (
    <Modal visible={visible} animationType={reduced ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.screen, { paddingTop: insets.top + space.s4 }]}>
          <View style={s.header}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8}>
              <X size={24} color={c.fgMuted} />
            </Pressable>
            <Text style={s.title} accessibilityRole="header">
              {t('groups.newGroup')}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.s7 }} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>{t('create.groupName')}</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder={t('create.groupNamePlaceholder')}
              placeholderTextColor={c.fgSubtle}
              autoFocus
              returnKeyType="next"
            />

            <Text style={s.label}>{t('currency.title')}</Text>
            <Pressable onPress={() => setPickingCurrency(true)} accessibilityRole="button" style={({ pressed }) => [s.input, s.currencyRow, pressed && { opacity: 0.6 }]}>
              <Text style={s.currencyCode}>{currencyLabel(base)}</Text>
              <Text style={s.currencyName}>{currency(base).name}</Text>
            </Pressable>

            <Text style={s.label}>{t('create.people')}</Text>
            {names.map((n, i) => {
              const isMe = meIndex === i;
              const hasName = n.trim().length > 0;
              return (
                <View key={i} style={s.personRow}>
                  <TextInput
                    style={[s.input, s.personInput]}
                    value={n}
                    onChangeText={(v) => setNameAt(i, v)}
                    placeholder={t('create.personN', { n: i + 1 })}
                    placeholderTextColor={c.fgSubtle}
                    returnKeyType="next"
                  />
                  <Pressable
                    onPress={() => setMeIndex(isMe ? null : i)}
                    disabled={!hasName}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isMe
                        ? t('create.isYouA11y', { name: n })
                        : t('create.markYouA11y', { name: n || t('members.thisPerson') })
                    }
                    accessibilityState={{ selected: isMe }}
                    style={({ pressed }) => [s.mePill, isMe && s.mePillOn, !hasName && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[s.mePillText, isMe && s.mePillTextOn]}>{t('create.me')}</Text>
                  </Pressable>
                  {names.length > 1 ? (
                    <Pressable onPress={() => removeRow(i)} accessibilityRole="button" accessibilityLabel={t('create.removePersonA11y', { n: i + 1 })} hitSlop={8} style={s.removeBtn}>
                      <X size={18} color={c.fgSubtle} />
                    </Pressable>
                  ) : (
                    <View style={s.removeBtn} />
                  )}
                </View>
              );
            })}
            <Pressable onPress={addRow} accessibilityRole="button" accessibilityLabel={t('create.addAnother')} style={({ pressed }) => [s.addRow, pressed && { opacity: 0.6 }]}>
              <Plus size={18} color={c.appAccent} />
              <Text style={s.addRowText}>{t('members.addPerson')}</Text>
            </Pressable>

            <Text style={[s.hint, !meChosen && { color: c.appAccent }]}>
              {meChosen ? t('create.hintChosen') : t('create.hintChoose')}
            </Text>

            <Button label={t('create.createGroup')} onPress={create} disabled={!canCreate} style={{ marginTop: space.s6 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <CurrencyPicker visible={pickingCurrency} selected={base} onPick={setBase} onClose={() => setPickingCurrency(false)} />
    </Modal>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.s5 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.s5 },
    title: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg },
    label: { ...ty.sm, fontFamily: fontFamily.sansSemibold, color: c.fgMuted, marginTop: space.s5, marginBottom: space.s3 },
    input: {
      ...ty.base,
      fontFamily: fontFamily.sans,
      color: c.fg,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.s5,
      minHeight: target.min,
      justifyContent: 'center',
    },
    currencyRow: { flexDirection: 'row', alignItems: 'center', gap: space.s4 },
    currencyCode: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.fg },
    currencyName: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgMuted },
    personRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, marginBottom: space.s3 },
    personInput: { flex: 1 },
    mePill: { paddingHorizontal: space.s4, height: 32, borderRadius: radius.pill, borderWidth: hairline, borderColor: c.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
    mePillOn: { backgroundColor: c.appAccentBg, borderColor: c.appAccent },
    mePillText: { ...ty.sm, fontFamily: fontFamily.sansMedium, color: c.fgMuted },
    mePillTextOn: { color: c.appAccent },
    removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s4 },
    addRowText: { ...ty.base, fontFamily: fontFamily.sansMedium, color: c.appAccent },
    hint: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: space.s4 },
  });
}
