/**
 * Who paid for an expense. The common case (one person paid the whole thing) is
 * a single tap with no number entry — pick the payer, done. Two-plus payers
 * reveal a per-payer amount field with a live "entered vs. amount" tally and a
 * "split evenly" helper. Amounts are in the expense's own currency, minor units,
 * and must sum to the total before Done is allowed.
 *
 * pageSheet modal, styled as a sibling of CreateGroupSheet / CurrencyPicker.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import { X, Check } from 'lucide-react-native';

import type { Member, Payer } from '../data/types';
import { parseAmount, formatMinorPlain, formatMoney } from '../data/money';
import { payersTotal } from '../math/split';
import { useTheme, fontFamily, space, radius, target, type as ty, hairline, type Colors } from '../theme';
import { Avatar } from './ui';
import { useReducedMotion } from './Dialogs';
import { t } from '../i18n';

export function PayerEditor({
  visible,
  members,
  currency,
  totalMinor,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  members: Member[];
  currency: string;
  totalMinor: number;
  value: Payer[];
  onChange: (payers: Payer[]) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  // Which members are payers, and the raw text in each one's amount field.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState<Record<string, string>>({});

  // Seed from the incoming value each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const sel = new Set(value.map((p) => p.memberId));
    setSelected(sel.size ? sel : new Set());
    const txt: Record<string, string> = {};
    for (const p of value) txt[p.memberId] = formatMinorPlain(p.amount, currency);
    setText(txt);
  }, [visible]);

  const selectedIds = useMemo(
    () => members.filter((m) => selected.has(m.id)).map((m) => m.id),
    [members, selected],
  );
  const single = selectedIds.length === 1;

  // Derived payer list for the current UI state. Single payer always pays the
  // full total (no field shown); multi reads each typed amount (blank = 0).
  const payers: Payer[] = useMemo(() => {
    if (single) return [{ memberId: selectedIds[0], amount: totalMinor }];
    return selectedIds.map((id) => ({ memberId: id, amount: parseAmount(text[id] ?? '', currency) ?? 0 }));
  }, [single, selectedIds, text, totalMinor, currency]);

  const entered = payersTotal(payers);
  const remaining = totalMinor - entered;
  const matches = entered === totalMinor && selectedIds.length > 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const splitEvenly = () => {
    const n = selectedIds.length;
    if (n === 0) return;
    const base = Math.floor(totalMinor / n);
    let rem = totalMinor - base * n; // remainder to the first payers
    const txt: Record<string, string> = { ...text };
    selectedIds.forEach((id, i) => {
      const amt = base + (i < rem ? 1 : 0);
      txt[id] = formatMinorPlain(amt, currency);
    });
    setText(txt);
  };

  const done = () => {
    if (!matches) return;
    onChange(payers);
    onClose();
  };

  return (
    <Modal visible={visible} animationType={reduced ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.screen, { paddingTop: insets.top + space.s4 }]}>
          <View style={s.header}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')} hitSlop={8}>
              <X size={24} color={c.fgMuted} />
            </Pressable>
            <Text style={s.title} accessibilityRole="header">
              {t('payer.title')}
            </Text>
            <Pressable
              onPress={done}
              disabled={!matches}
              accessibilityRole="button"
              accessibilityLabel={t('common.done')}
              hitSlop={8}
              style={!matches && { opacity: 0.35 }}
            >
              <Text style={s.done}>{t('common.done')}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.s7 }} keyboardShouldPersistTaps="handled">
            <Text style={s.hint}>
              {single
                ? t('payer.hintSingle')
                : selectedIds.length === 0
                  ? t('payer.hintChoose')
                  : t('payer.hintEnter')}
            </Text>

            {members.map((m) => {
              const on = selected.has(m.id);
              return (
                <View key={m.id} style={s.row}>
                  <Pressable
                    onPress={() => toggle(m.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={m.displayName}
                    style={({ pressed }) => [s.personMain, pressed && { opacity: 0.6 }]}
                  >
                    <View style={[s.check, on && s.checkOn]}>{on ? <Check size={14} color={c.fgOnAccent} /> : null}</View>
                    <Avatar name={m.displayName} color={m.color} emoji={m.emoji} size={32} />
                    <Text style={s.personName} numberOfLines={1}>
                      {m.displayName}
                    </Text>
                  </Pressable>

                  {on && single ? (
                    <Text style={s.fullAmount}>{t('payer.fullAmount')}</Text>
                  ) : null}
                  {on && !single ? (
                    <View style={s.amountField}>
                      <Text style={s.fieldCode}>{currency}</Text>
                      <TextInput
                        style={s.amountInput}
                        value={text[m.id] ?? ''}
                        onChangeText={(v) => setText((p) => ({ ...p, [m.id]: v }))}
                        placeholder="0"
                        placeholderTextColor={c.fgSubtle}
                        keyboardType="decimal-pad"
                        accessibilityLabel={t('payer.amountA11y', { name: m.displayName })}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}

            {selectedIds.length >= 2 ? (
              <>
                <Pressable onPress={splitEvenly} accessibilityRole="button" style={({ pressed }) => [s.evenlyBtn, pressed && { opacity: 0.6 }]}>
                  <Text style={s.evenlyText}>{t('payer.splitEvenly')}</Text>
                </Pressable>
                <View style={s.tally}>
                  <Text style={s.tallyLine}>
                    {t('payer.tallyEntered', {
                      entered: formatMoney(entered, currency),
                      total: formatMoney(totalMinor, currency),
                    })}
                  </Text>
                  {remaining !== 0 ? (
                    <Text style={[s.tallyRemaining, { color: c.warning }]}>
                      {remaining > 0
                        ? t('payer.leftToAssign', { amount: formatMoney(remaining, currency) })
                        : t('payer.over', { amount: formatMoney(-remaining, currency) })}
                    </Text>
                  ) : (
                    <Text style={[s.tallyRemaining, { color: c.accent }]}>{t('payer.addsUp')}</Text>
                  )}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.s5 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.s4 },
    title: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg },
    done: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.appAccent },
    hint: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginBottom: space.s4 },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: target.min + 8,
      gap: space.s4,
      borderBottomWidth: hairline,
      borderBottomColor: c.hairline,
      paddingVertical: space.s3,
    },
    personMain: { flexDirection: 'row', alignItems: 'center', gap: space.s4, flex: 1 },
    check: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: c.appAccent, borderColor: c.appAccent },
    personName: { ...ty.base, fontFamily: fontFamily.sansMedium, color: c.fg, flex: 1 },
    fullAmount: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted },

    amountField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.s4,
      minHeight: 40,
      minWidth: 120,
    },
    fieldCode: { ...ty.sm, fontFamily: fontFamily.sansMedium, color: c.fgMuted },
    amountInput: { ...ty.base, fontFamily: fontFamily.mono, color: c.fg, flex: 1, textAlign: 'right', paddingVertical: space.s2 },

    evenlyBtn: { alignSelf: 'flex-start', paddingVertical: space.s4 },
    evenlyText: { ...ty.base, fontFamily: fontFamily.sansMedium, color: c.appAccent },

    tally: { marginTop: space.s3, gap: 2 },
    tallyLine: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted },
    tallyRemaining: { ...ty.sm, fontFamily: fontFamily.sansSemibold },
  });
}
