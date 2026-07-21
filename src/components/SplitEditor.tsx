/**
 * How an expense divides among participants. A segmented control picks the
 * method (Equal / Exact / Shares / %); the participant list toggles who's in;
 * and every method shows a LIVE per-person preview computed by the same
 * `computeOwed` the ledger uses, so what you see here is exactly what lands.
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
import { X, Check, Minus, Plus } from 'lucide-react-native';

import type { Member, SplitMethod, SplitPart, Expense } from '../data/types';
import { parseAmount, formatMinorPlain, formatMoney } from '../data/money';
import { computeOwed, exactSplitTotal } from '../math/split';
import { useTheme, fontFamily, space, radius, target, type as ty, hairline, type Colors } from '../theme';
import { Avatar } from './ui';
import { useReducedMotion } from './Dialogs';
import { t } from '../i18n';

// Keys only at module scope — resolved via t() at render time (canon § Translations).
const METHODS: { key: SplitMethod; labelKey: string }[] = [
  { key: 'equal', labelKey: 'split.methodEqual' },
  { key: 'exact', labelKey: 'split.methodExact' },
  { key: 'shares', labelKey: 'split.methodShares' },
  { key: 'percent', labelKey: 'split.methodPercent' },
];

export function SplitEditor({
  visible,
  members,
  currency,
  totalMinor,
  method,
  splits,
  onChange,
  onClose,
}: {
  visible: boolean;
  members: Member[];
  currency: string;
  totalMinor: number;
  method: SplitMethod;
  splits: SplitPart[];
  onChange: (next: { method: SplitMethod; splits: SplitPart[] }) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const [mode, setMode] = useState<SplitMethod>(method);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  // Raw text per member, per method-relevant value. For shares we keep numbers.
  const [exactText, setExactText] = useState<Record<string, string>>({});
  const [shareVal, setShareVal] = useState<Record<string, number>>({});
  const [pctText, setPctText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setMode(method);
    const inc = new Set(splits.map((sp) => sp.memberId));
    setIncluded(inc.size ? inc : new Set(members.map((m) => m.id)));
    const ex: Record<string, string> = {};
    const sh: Record<string, number> = {};
    const pc: Record<string, string> = {};
    for (const sp of splits) {
      if (method === 'exact') ex[sp.memberId] = formatMinorPlain(sp.value, currency);
      if (method === 'shares') sh[sp.memberId] = sp.value;
      if (method === 'percent') pc[sp.memberId] = String(sp.value);
    }
    setExactText(ex);
    setShareVal(sh);
    setPctText(pc);
  }, [visible]);

  const includedMembers = useMemo(() => members.filter((m) => included.has(m.id)), [members, included]);

  // Build the SplitPart[] for the CURRENT mode + state.
  const buildSplits = (m: SplitMethod): SplitPart[] =>
    includedMembers.map((mem) => {
      let value = 0;
      if (m === 'exact') value = parseAmount(exactText[mem.id] ?? '', currency) ?? 0;
      else if (m === 'shares') value = Math.max(0, Math.round(shareVal[mem.id] ?? 1));
      else if (m === 'percent') value = Number(pctText[mem.id] ?? '') || 0;
      return { memberId: mem.id, value };
    });

  const currentSplits = buildSplits(mode);

  // Live preview: run the same math the ledger uses. The remainder lands on a
  // dummy single payer that's also a participant, so it shows somewhere sane.
  const preview = useMemo(() => {
    if (totalMinor <= 0 || currentSplits.length === 0) return new Map<string, number>();
    const dummy: Expense = {
      id: 'preview',
      description: '',
      amount: totalMinor,
      currency,
      rate: 1,
      payers: [{ memberId: currentSplits[0].memberId, amount: totalMinor }],
      splitMethod: mode,
      splits: currentSplits,
      category: 'general',
      date: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    return computeOwed(dummy);
  }, [currentSplits, mode, totalMinor, currency]);

  const exactSum = exactSplitTotal(currentSplits);
  const pctSum = mode === 'percent' ? currentSplits.reduce((a, sp) => a + sp.value, 0) : 0;

  const toggle = (id: string) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bumpShare = (id: string, delta: number) =>
    setShareVal((prev) => ({ ...prev, [id]: Math.max(0, Math.round((prev[id] ?? 1) + delta)) }));

  const canDone = includedMembers.length > 0;

  const done = () => {
    if (!canDone) return;
    onChange({ method: mode, splits: currentSplits });
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
              {t('split.title')}
            </Text>
            <Pressable onPress={done} disabled={!canDone} accessibilityRole="button" accessibilityLabel={t('common.done')} hitSlop={8} style={!canDone && { opacity: 0.35 }}>
              <Text style={s.done}>{t('common.done')}</Text>
            </Pressable>
          </View>

          {/* Segmented control */}
          <View style={s.segment}>
            {METHODS.map((mt) => {
              const on = mode === mt.key;
              return (
                <Pressable
                  key={mt.key}
                  onPress={() => setMode(mt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t(mt.labelKey)}
                  style={({ pressed }) => [s.segItem, on && s.segItemOn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[s.segText, on && s.segTextOn]}>{t(mt.labelKey)}</Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.s7 }} keyboardShouldPersistTaps="handled">
            {members.map((m) => {
              const on = included.has(m.id);
              const owed = preview.get(m.id) ?? 0;
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
                    <View style={{ flex: 1 }}>
                      <Text style={s.personName} numberOfLines={1}>
                        {m.displayName}
                      </Text>
                      {on ? (
                        <Text style={s.owedPreview}>{formatMoney(owed, currency)}</Text>
                      ) : null}
                    </View>
                  </Pressable>

                  {on && mode === 'exact' ? (
                    <View style={s.amountField}>
                      <Text style={s.fieldCode}>{currency}</Text>
                      <TextInput
                        style={s.amountInput}
                        value={exactText[m.id] ?? ''}
                        onChangeText={(v) => setExactText((p) => ({ ...p, [m.id]: v }))}
                        placeholder="0"
                        placeholderTextColor={c.fgSubtle}
                        keyboardType="decimal-pad"
                        accessibilityLabel={t('split.exactA11y', { name: m.displayName })}
                      />
                    </View>
                  ) : null}

                  {on && mode === 'shares' ? (
                    <View style={s.stepper}>
                      <Pressable onPress={() => bumpShare(m.id, -1)} accessibilityRole="button" accessibilityLabel={t('split.fewerShares')} hitSlop={6} style={s.stepBtn}>
                        <Minus size={16} color={c.fg} />
                      </Pressable>
                      <Text style={s.stepValue}>{Math.max(0, Math.round(shareVal[m.id] ?? 1))}</Text>
                      <Pressable onPress={() => bumpShare(m.id, 1)} accessibilityRole="button" accessibilityLabel={t('split.moreShares')} hitSlop={6} style={s.stepBtn}>
                        <Plus size={16} color={c.fg} />
                      </Pressable>
                    </View>
                  ) : null}

                  {on && mode === 'percent' ? (
                    <View style={s.amountField}>
                      <TextInput
                        style={s.amountInput}
                        value={pctText[m.id] ?? ''}
                        onChangeText={(v) => setPctText((p) => ({ ...p, [m.id]: v }))}
                        placeholder="0"
                        placeholderTextColor={c.fgSubtle}
                        keyboardType="decimal-pad"
                        accessibilityLabel={t('split.percentA11y', { name: m.displayName })}
                      />
                      <Text style={s.fieldCode}>%</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}

            {mode === 'exact' ? (
              <View style={s.foot}>
                <Text style={s.footLine}>
                  {t('split.exactAssigned', {
                    assigned: formatMoney(exactSum, currency),
                    total: formatMoney(totalMinor, currency),
                  })}
                </Text>
                <Text style={s.footNote}>{t('split.leftoverNote')}</Text>
              </View>
            ) : null}

            {mode === 'percent' ? (
              <View style={s.foot}>
                <Text style={[s.footLine, { color: pctSum === 100 ? c.accent : c.warning }]}>{t('split.pctAssigned', { pct: pctSum })}</Text>
              </View>
            ) : null}

            {mode === 'equal' && includedMembers.length > 0 ? (
              <Text style={s.footNote}>
                {includedMembers.length === 1
                  ? t('split.splitWaysOne', { count: includedMembers.length })
                  : t('split.splitWaysOther', { count: includedMembers.length })}
              </Text>
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

    segment: {
      flexDirection: 'row',
      backgroundColor: c.bgSubtle,
      borderRadius: radius.md,
      padding: space.s1,
      marginBottom: space.s5,
    },
    segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, borderRadius: radius.sm },
    segItemOn: { backgroundColor: c.bgElevated, borderWidth: hairline, borderColor: c.hairline },
    segText: { ...ty.sm, fontFamily: fontFamily.sansMedium, color: c.fgMuted },
    segTextOn: { color: c.fg, fontFamily: fontFamily.sansSemibold },

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
    personName: { ...ty.base, fontFamily: fontFamily.sansMedium, color: c.fg },
    owedPreview: { ...ty.sm, fontFamily: fontFamily.mono, color: c.fgMuted, marginTop: 1 },

    amountField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.s4,
      minHeight: 40,
      minWidth: 100,
    },
    fieldCode: { ...ty.sm, fontFamily: fontFamily.sansMedium, color: c.fgMuted },
    amountInput: { ...ty.base, fontFamily: fontFamily.mono, color: c.fg, flex: 1, textAlign: 'right', paddingVertical: space.s2 },

    stepper: { flexDirection: 'row', alignItems: 'center', gap: space.s4 },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepValue: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.fg, minWidth: 24, textAlign: 'center' },

    foot: { marginTop: space.s4, gap: 2 },
    footLine: { ...ty.sm, fontFamily: fontFamily.sansSemibold, color: c.fgMuted },
    footNote: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: space.s3 },
  });
}
