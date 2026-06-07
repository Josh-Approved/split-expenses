/**
 * Add / edit an expense — the hero flow. "Fast expense entry" is the category's
 * most-praised trait, so the common case is ~2 taps: the amount keyboard is up
 * on open, and the defaults (you paid, split equally among everyone, today,
 * General) are usually right. Everything else is one tap to a focused editor.
 *
 * Full-screen (registered as a modal in the stack). EDIT mode prefills from the
 * existing expense and offers Delete; otherwise CREATE with smart defaults.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as LucideIcons from 'lucide-react-native';
import { X, Trash2, Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import type { RootStackParamList } from '../navigation';
import { useGroups, type NewExpense } from '../store/groups';
import type { Payer, SplitPart, SplitMethod } from '../data/types';
import { parseAmount, formatMoney } from '../data/money';
import { CATEGORIES, category, DEFAULT_CATEGORY } from '../data/categories';
import { currencyLabel } from '../data/currencies';
import { useRate } from '../data/fx';
import { payersTotal } from '../math/split';
import { activeMembers, memberName, formatDate } from '../lib/format';
import { useTheme, fontFamily, space, radius, target, type as t, hairline, type Colors } from '../theme';
import { Button, EmptyState } from '../components/ui';
import { useConfirm, usePrompt, useActionMenu } from '../components/Dialogs';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { PayerEditor } from '../components/PayerEditor';
import { SplitEditor } from '../components/SplitEditor';

type Props = NativeStackScreenProps<RootStackParamList, 'AddEditExpense'>;

export default function AddEditExpenseScreen({ navigation, route }: Props) {
  const { groupId, expenseId } = route.params;
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const group = useGroups((st) => st.groups.find((g) => g.id === groupId));
  const meId = useGroups((st) => st.me[groupId]);
  const addExpense = useGroups((st) => st.addExpense);
  const updateExpense = useGroups((st) => st.updateExpense);
  const deleteExpense = useGroups((st) => st.deleteExpense);

  const confirm = useConfirm();
  const ratePrompt = usePrompt();
  const receiptMenu = useActionMenu();
  const permissionInfo = useConfirm();

  const members = useMemo(() => (group ? activeMembers(group) : []), [group]);
  const existing = expenseId ? group?.expenses.find((e) => e.id === expenseId) : undefined;
  const isEdit = !!existing;

  // ---- field state (seeded once from existing / defaults) ------------------
  const defaultPayerId = meId ?? members[0]?.id;

  const [amountText, setAmountText] = useState(() =>
    existing ? formatMinorOrEmpty(existing.amount, existing.currency) : '',
  );
  const [currency, setCurrency] = useState(() => existing?.currency ?? group?.baseCurrency ?? 'USD');
  const [description, setDescription] = useState(() => existing?.description ?? '');
  const [note, setNote] = useState(() => existing?.note ?? '');
  const [categoryKey, setCategoryKey] = useState(() => existing?.category ?? DEFAULT_CATEGORY);
  const [date, setDate] = useState(() => new Date(existing?.date ?? Date.now()));
  const [showDate, setShowDate] = useState(false);
  const [receiptUri, setReceiptUri] = useState<string | undefined>(() => existing?.receiptUri);

  const [payers, setPayers] = useState<Payer[]>(() =>
    existing ? existing.payers : defaultPayerId ? [{ memberId: defaultPayerId, amount: 0 }] : [],
  );
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(() => existing?.splitMethod ?? 'equal');
  const [splits, setSplits] = useState<SplitPart[]>(() =>
    existing ? existing.splits : members.map((m) => ({ memberId: m.id, value: 0 })),
  );

  const [editingPayers, setEditingPayers] = useState(false);
  const [editingSplit, setEditingSplit] = useState(false);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [showPayerHint, setShowPayerHint] = useState(false);

  // Manual rate override the user typed (overrides the looked-up rate).
  const [manualRate, setManualRate] = useState<number | null>(() =>
    existing && existing.currency !== (group?.baseCurrency ?? '') ? existing.rate : null,
  );

  const baseCurrency = group?.baseCurrency ?? 'USD';
  const foreign = currency !== baseCurrency;
  const fx = useRate(foreign ? currency : baseCurrency, baseCurrency);
  const effectiveRate = !foreign ? 1 : manualRate ?? fx.rate;

  const amountMinor = parseAmount(amountText, currency) ?? 0;

  // When the amount changes and there's exactly one payer, keep them paying the
  // full new amount (the fast path: "I paid for it").
  const singlePayerId = payers.length === 1 ? payers[0].memberId : null;
  const effectivePayers: Payer[] = singlePayerId
    ? [{ memberId: singlePayerId, amount: amountMinor }]
    : payers;

  const paidSum = payersTotal(effectivePayers);
  const payersMatch = paidSum === amountMinor;

  // ---- summaries -----------------------------------------------------------
  const payerSummary = useMemo(() => {
    if (effectivePayers.length === 0) return 'Choose who paid';
    if (effectivePayers.length === 1) {
      const id = effectivePayers[0].memberId;
      return id === meId ? 'You' : memberName(group!, id);
    }
    return `${effectivePayers.length} people`;
  }, [effectivePayers, group, meId]);

  const splitSummary = useMemo(() => {
    const n = splits.length;
    const label =
      splitMethod === 'equal'
        ? 'Equally'
        : splitMethod === 'exact'
          ? 'Exact amounts'
          : splitMethod === 'shares'
            ? 'By shares'
            : 'By percent';
    if (n === 0) return 'Choose a split';
    return `${label} between ${n}`;
  }, [splits, splitMethod]);

  if (!group) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <EmptyState title="Group not found" />
      </View>
    );
  }

  const CatIcon = (key: string) => (LucideIcons as any)[category(key).icon] ?? LucideIcons.Receipt;

  const canSave = amountMinor > 0 && payersMatch && splits.length > 0;

  const onSave = () => {
    if (!canSave) {
      if (!payersMatch) setShowPayerHint(true);
      return;
    }
    const payload: NewExpense = {
      description: description.trim(),
      amount: amountMinor,
      currency,
      rate: effectiveRate,
      payers: effectivePayers,
      splitMethod,
      splits,
      category: categoryKey,
      date: date.getTime(),
      note: note.trim() || undefined,
      receiptUri,
    };
    if (isEdit && expenseId) updateExpense(groupId, expenseId, payload);
    else addExpense(groupId, payload);
    navigation.goBack();
  };

  const onDelete = () =>
    confirm.open({
      title: 'Delete this expense?',
      message: 'It will be removed for everyone in the group.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        if (expenseId) deleteExpense(groupId, expenseId);
        navigation.goBack();
      },
    });

  const onDateChange = (ev: DateTimePickerEvent, picked?: Date) => {
    // Android fires once then dismisses; iOS keeps the inline picker open.
    if (Platform.OS === 'android') setShowDate(false);
    if (ev.type === 'set' && picked) setDate(picked);
  };

  const openRateOverride = () => {
    ratePrompt.open({
      title: 'Set the rate',
      message: `Units of ${baseCurrency} per 1 ${currency}.`,
      keyboardType: 'decimal-pad',
      initialValue: String(effectiveRate),
      confirmLabel: 'Use this rate',
      onSubmit: (txt) => {
        const r = Number(txt.replace(',', '.'));
        if (Number.isFinite(r) && r > 0) setManualRate(r);
      },
    });
  };

  // ---- receipt photo (local-only; never synced — see data/types.ts) -------
  const notifyDenied = (what: string) =>
    permissionInfo.open({
      title: `${what} is off`,
      message: `Split Expenses can't use your ${what.toLowerCase()} until you allow it in Settings. Your photo stays on this device.`,
      confirmLabel: 'OK',
      onConfirm: () => {},
    });

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      notifyDenied('Camera');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled && result.assets[0]) setReceiptUri(result.assets[0].uri);
  };

  const choosePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      notifyDenied('Photo access');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!result.canceled && result.assets[0]) setReceiptUri(result.assets[0].uri);
  };

  const openReceiptMenu = () =>
    receiptMenu.open({
      title: receiptUri ? 'Receipt photo' : 'Attach receipt',
      options: [
        { label: 'Take photo', onPress: () => void takePhoto() },
        { label: 'Choose photo', onPress: () => void choosePhoto() },
        ...(receiptUri
          ? [{ label: 'Remove', destructive: true, onPress: () => setReceiptUri(undefined) }]
          : []),
      ],
    });

  return (
    <View style={[s.screen, { paddingTop: insets.top + space.s2 }]}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8}>
          <X size={24} color={c.fgMuted} />
        </Pressable>
        <Text style={s.title} accessibilityRole="header">
          {isEdit ? 'Edit expense' : 'New expense'}
        </Text>
        {isEdit ? (
          <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete expense" hitSlop={8}>
            <Trash2 size={22} color={c.danger} />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.s9 }} keyboardShouldPersistTaps="handled">
          {/* Amount — the hero input */}
          <View style={s.amountRow}>
            <TextInput
              style={s.amountInput}
              value={amountText}
              onChangeText={setAmountText}
              placeholder="0"
              placeholderTextColor={c.fgSubtle}
              keyboardType="decimal-pad"
              autoFocus={!isEdit}
              accessibilityLabel="Amount"
            />
            <Pressable onPress={() => setPickingCurrency(true)} accessibilityRole="button" accessibilityLabel={`Currency ${currency}`} style={({ pressed }) => [s.currencyChip, pressed && { opacity: 0.6 }]}>
              <Text style={s.currencyChipText}>{currencyLabel(currency)}</Text>
            </Pressable>
          </View>

          {foreign ? (
            <Pressable onPress={openRateOverride} accessibilityRole="button" accessibilityLabel="Change exchange rate" style={({ pressed }) => [s.rateLine, pressed && { opacity: 0.6 }]}>
              <Text style={s.rateText}>
                1 {currency} = {effectiveRate.toFixed(4)} {baseCurrency} ·{' '}
                {manualRate != null ? 'manual' : fx.source}
              </Text>
              {fx.source === 'fallback' && manualRate == null ? (
                <Text style={[s.rateWarn, { color: c.warning }]}>rates may be offline — tap to set</Text>
              ) : null}
            </Pressable>
          ) : null}

          {/* Description */}
          <Text style={s.label}>Description</Text>
          <TextInput
            style={s.input}
            value={description}
            onChangeText={setDescription}
            placeholder="What was it for?"
            placeholderTextColor={c.fgSubtle}
            returnKeyType="done"
          />

          {/* Paid by */}
          <Text style={s.label}>Paid by</Text>
          <Pressable onPress={() => setEditingPayers(true)} accessibilityRole="button" accessibilityLabel={`Paid by ${payerSummary}`} style={({ pressed }) => [s.selectRow, pressed && { opacity: 0.6 }]}>
            <Text style={s.selectValue}>{payerSummary}</Text>
            <Text style={s.chevron}>›</Text>
          </Pressable>
          {showPayerHint && !payersMatch ? (
            <Text style={[s.inlineHint, { color: c.warning }]}>
              The payers add up to {formatMoney(paidSum, currency)}, but the expense is {formatMoney(amountMinor, currency)}.
            </Text>
          ) : null}

          {/* Split */}
          <Text style={s.label}>Split</Text>
          <Pressable onPress={() => setEditingSplit(true)} accessibilityRole="button" accessibilityLabel={`Split ${splitSummary}`} style={({ pressed }) => [s.selectRow, pressed && { opacity: 0.6 }]}>
            <Text style={s.selectValue}>{splitSummary}</Text>
            <Text style={s.chevron}>›</Text>
          </Pressable>

          {/* Category */}
          <Text style={s.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.catScroll}>
            {CATEGORIES.map((cat) => {
              const on = cat.key === categoryKey;
              const Icon = CatIcon(cat.key);
              return (
                <Pressable
                  key={cat.key}
                  onPress={() => setCategoryKey(cat.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={cat.label}
                  style={({ pressed }) => [s.catChip, on && s.catChipOn, pressed && { opacity: 0.6 }]}
                >
                  <Icon size={16} color={on ? c.appAccent : c.fgMuted} />
                  <Text style={[s.catChipText, on && s.catChipTextOn]}>{cat.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Date */}
          <Text style={s.label}>Date</Text>
          <Pressable onPress={() => setShowDate((v) => !v)} accessibilityRole="button" accessibilityLabel={`Date ${formatDate(date.getTime())}`} style={({ pressed }) => [s.selectRow, pressed && { opacity: 0.6 }]}>
            <Text style={s.selectValue}>{formatDate(date.getTime())}</Text>
            <Text style={s.chevron}>›</Text>
          </Pressable>
          {showDate ? (
            Platform.OS === 'ios' ? (
              <View style={s.datePanel}>
                <DateTimePicker value={date} mode="date" display="compact" onChange={onDateChange} maximumDate={new Date()} />
              </View>
            ) : (
              <DateTimePicker value={date} mode="date" display="default" onChange={onDateChange} maximumDate={new Date()} />
            )
          ) : null}

          {/* Note */}
          <Text style={s.label}>Note</Text>
          <TextInput
            style={[s.input, s.noteInput]}
            value={note}
            onChangeText={setNote}
            placeholder="Optional"
            placeholderTextColor={c.fgSubtle}
            multiline
          />

          {/*
           * Receipt photo — local-only. The image blob never leaves this device
           * (the sync engine strips receiptUri before sealing; see
           * sync/engine.ts and data/types.ts). Reading the total off the photo
           * (OCR) is a separate, later step.
           */}
          {receiptUri ? (
            <Pressable
              onPress={openReceiptMenu}
              accessibilityRole="button"
              accessibilityLabel="Receipt photo. Tap to change or remove."
              style={({ pressed }) => [s.receiptRow, pressed && { opacity: 0.6 }]}
            >
              <Image source={{ uri: receiptUri }} style={s.receiptThumb} accessibilityIgnoresInvertColors />
              <View style={{ flex: 1 }}>
                <Text style={s.scanText}>Receipt attached</Text>
                <Text style={s.receiptHint}>Stays on this device · tap to change</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={openReceiptMenu}
              accessibilityRole="button"
              accessibilityLabel="Attach receipt"
              style={({ pressed }) => [s.scanRow, pressed && { opacity: 0.6 }]}
            >
              <Camera size={18} color={c.fgMuted} />
              <Text style={s.scanText}>Attach receipt</Text>
            </Pressable>
          )}

          <Button
            label={isEdit ? 'Save changes' : 'Add expense'}
            onPress={onSave}
            disabled={!canSave}
            accent
            style={{ marginTop: space.s6 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <CurrencyPicker visible={pickingCurrency} selected={currency} onPick={setCurrency} onClose={() => setPickingCurrency(false)} />
      <PayerEditor
        visible={editingPayers}
        members={members}
        currency={currency}
        totalMinor={amountMinor}
        value={effectivePayers}
        onChange={(next) => {
          setPayers(next);
          setShowPayerHint(false);
        }}
        onClose={() => setEditingPayers(false)}
      />
      <SplitEditor
        visible={editingSplit}
        members={members}
        currency={currency}
        totalMinor={amountMinor}
        method={splitMethod}
        splits={splits}
        onChange={({ method, splits: next }) => {
          setSplitMethod(method);
          setSplits(next);
        }}
        onClose={() => setEditingSplit(false)}
      />
      {confirm.element}
      {ratePrompt.element}
      {receiptMenu.element}
      {permissionInfo.element}
    </View>
  );
}

/** Show an existing minor-unit amount as an editable plain string, or '' for 0. */
function formatMinorOrEmpty(minor: number, code: string): string {
  if (minor === 0) return '';
  const { formatMinorPlain } = require('../data/money') as typeof import('../data/money');
  return formatMinorPlain(minor, code);
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.s5 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.s4 },
    title: { ...t.md, fontFamily: fontFamily.sansSemibold, color: c.fg },

    amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingVertical: space.s4 },
    amountInput: {
      flex: 1,
      fontSize: 40,
      lineHeight: 46,
      fontFamily: fontFamily.sansSemibold,
      letterSpacing: -0.5,
      color: c.fg,
      padding: 0,
    },
    currencyChip: {
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.pill,
      paddingHorizontal: space.s5,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    currencyChipText: { ...t.base, fontFamily: fontFamily.sansSemibold, color: c.fg },

    rateLine: { paddingBottom: space.s3, gap: 2 },
    rateText: { ...t.sm, fontFamily: fontFamily.sans, color: c.fgMuted },
    rateWarn: { ...t.xs, fontFamily: fontFamily.sansMedium },

    label: { ...t.sm, fontFamily: fontFamily.sansSemibold, color: c.fgMuted, marginTop: space.s5, marginBottom: space.s3 },
    input: {
      ...t.base,
      fontFamily: fontFamily.sans,
      color: c.fg,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.s5,
      minHeight: target.min,
      justifyContent: 'center',
    },
    noteInput: { minHeight: 72, paddingTop: space.s4, textAlignVertical: 'top' },

    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.s5,
      minHeight: target.min,
    },
    selectValue: { ...t.base, fontFamily: fontFamily.sansMedium, color: c.fg },
    chevron: { fontSize: 24, lineHeight: 26, color: c.fgSubtle, fontFamily: fontFamily.sans },
    inlineHint: { ...t.sm, fontFamily: fontFamily.sansMedium, marginTop: space.s3 },

    catScroll: { gap: space.s3, paddingRight: space.s5 },
    catChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s2,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.pill,
      paddingHorizontal: space.s4,
      height: 36,
    },
    catChipOn: { backgroundColor: c.appAccentBg, borderColor: c.appAccent },
    catChipText: { ...t.sm, fontFamily: fontFamily.sansMedium, color: c.fgMuted },
    catChipTextOn: { color: c.appAccent },

    datePanel: { marginTop: space.s3, alignItems: 'flex-start' },

    scanRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s5, marginTop: space.s4 },
    scanText: { ...t.sm, fontFamily: fontFamily.sansMedium, color: c.fg },
    receiptRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      borderWidth: hairline,
      borderColor: c.hairlineStrong,
      borderRadius: radius.md,
      padding: space.s3,
      marginTop: space.s4,
    },
    receiptThumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: c.bgElevated },
    receiptHint: { ...t.xs, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: 1 },
  });
}
