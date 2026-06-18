/**
 * Members — who's in this group, and which one is you. Identity here is just a
 * name you pick in this group: no account, no phone/email lookup. Tap a person
 * for the cross-platform action menu (this is me / rename / payment handles /
 * color / remove). Payment handles are opt-in and group-only — they're what
 * others tap to pay you at settle-up.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { X, Plus, Check } from 'lucide-react-native';

import type { RootStackParamList } from '../navigation';
import { useGroups } from '../store/groups';
import { activeMembers } from '../lib/format';
import { hasAnyHandle } from '../lib/payments';
import { MEMBER_COLORS } from '../data/avatars';
import {
  useTheme,
  fontFamily,
  space,
  radius,
  target,
  type as ty,
  hairline,
  type Colors,
} from '../theme';
import { Avatar, EmptyState } from '../components/ui';
import { useActionMenu, usePrompt, useConfirm } from '../components/Dialogs';
import { t } from '../i18n';
import type { Member, PaymentHandles } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Members'>;

/** Plain hint for the row subtitle, e.g. "Venmo · PayPal". */
function handlesHint(handles: PaymentHandles | undefined): string | undefined {
  if (!hasAnyHandle(handles)) return undefined;
  const parts: string[] = [];
  if (handles?.venmo?.trim()) parts.push('Venmo');
  if (handles?.paypal?.trim()) parts.push('PayPal');
  if (handles?.cashapp?.trim()) parts.push('Cash App');
  return parts.join(' · ');
}

export default function MembersScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const group = useGroups((st) => st.groups.find((g) => g.id === groupId));
  const me = useGroups((st) => st.me[groupId]);
  const addMember = useGroups((st) => st.addMember);
  const updateMember = useGroups((st) => st.updateMember);
  const setHandles = useGroups((st) => st.setHandles);
  const removeMember = useGroups((st) => st.removeMember);
  const mergeMembers = useGroups((st) => st.mergeMembers);

  const menu = useActionMenu();
  const prompt = usePrompt();
  const confirm = useConfirm();

  // The payment-handles editor (its own page sheet, like CreateGroupSheet).
  const [editing, setEditing] = useState<Member | null>(null);

  if (!group) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <View style={s.topbar}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={s.iconBtn}>
            <Text style={s.backChevron}>‹</Text>
          </Pressable>
          <Text style={s.topTitle} accessibilityRole="header">
            {t('members.title')}
          </Text>
          <View style={s.iconBtn} />
        </View>
        <EmptyState title={t('group.notFound')} />
      </View>
    );
  }

  const members = activeMembers(group);

  const cycleColor = (member: Member) => {
    const used = members.map((m) => m.color).filter(Boolean) as string[];
    menu.open({
      title: t('members.color'),
      options: MEMBER_COLORS.map((color) => ({
        label:
          (member.color === color ? '● ' : used.includes(color) ? '◦ ' : '○ ') +
          color,
        onPress: () => updateMember(groupId, member.id, { color }),
      })),
    });
  };

  // Fold this person into another (the duplicate fix): pick who they really
  // are; their expenses move over and the duplicate is removed.
  const mergeFlow = (member: Member) => {
    const others = members.filter((m) => m.id !== member.id);
    menu.open({
      title: t('members.isReally', { name: member.displayName }),
      options: others.map((target) => ({
        label: target.displayName,
        onPress: () =>
          confirm.open({
            title: t('members.mergeTitle', { a: member.displayName, b: target.displayName }),
            message: t('members.mergeMessage', { a: member.displayName, b: target.displayName }),
            confirmLabel: t('common.merge'),
            destructive: true,
            onConfirm: () => mergeMembers(groupId, target.id, member.id),
          }),
      })),
    });
  };

  const meName = members.find((m) => m.id === me)?.displayName;

  const openMember = (member: Member) => {
    menu.open({
      title: member.displayName,
      options: [
        // Identity ("who you are") is not set per-member here — that lives in
        // the single "Change who I am" flow, so there's no way to casually
        // re-point yourself at an arbitrary person. See § identity.
        {
          label: t('common.rename'),
          onPress: () =>
            prompt.open({
              title: t('members.renamePerson'),
              initialValue: member.displayName,
              selectAll: true,
              confirmLabel: t('common.save'),
              onSubmit: (text) => updateMember(groupId, member.id, { displayName: text }),
            }),
        },
        { label: t('members.paymentHandles'), onPress: () => setEditing(member) },
        { label: t('members.color'), onPress: () => cycleColor(member) },
        ...(members.length > 1
          ? [{ label: t('members.mergeInto'), onPress: () => mergeFlow(member) }]
          : []),
        {
          label: t('common.remove'),
          destructive: true,
          onPress: () =>
            confirm.open({
              title: t('members.removeTitle', { name: member.displayName }),
              message: t('members.removeMessage'),
              confirmLabel: t('common.remove'),
              destructive: true,
              onConfirm: () => removeMember(groupId, member.id),
            }),
        },
      ],
    });
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.topbar}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={s.iconBtn}>
          <Text style={s.backChevron}>‹</Text>
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1} accessibilityRole="header">
          {t('members.title')}
        </Text>
        <View style={s.iconBtn} />
      </View>

      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.s5, paddingBottom: insets.bottom + space.s7 }}
        ListEmptyComponent={<EmptyState title={t('members.emptyTitle')} message={t('members.emptyMessage')} />}
        ListHeaderComponent={
          <Pressable
            onPress={() => navigation.navigate('ClaimMember', { groupId, change: true })}
            accessibilityRole="button"
            accessibilityLabel={meName ? t('members.youAreA11y', { name: meName }) : t('members.setWhoA11y')}
            style={({ pressed }) => [s.identityRow, pressed && s.pressed]}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.identityLabel}>{meName ? t('members.youAre') : t('members.setWho')}</Text>
              {meName ? <Text style={s.identityName}>{meName}</Text> : null}
            </View>
            <Text style={s.identityChevron}>›</Text>
          </Pressable>
        }
        renderItem={({ item }) => {
          const isMe = item.id === me;
          const hint = handlesHint(item.handles);
          return (
            <Pressable
              onPress={() => openMember(item)}
              accessibilityRole="button"
              accessibilityLabel={
                isMe
                  ? t('members.optionsMeA11y', { name: item.displayName })
                  : t('members.optionsA11y', { name: item.displayName })
              }
              style={({ pressed }) => [s.memberRow, pressed && s.pressed]}
            >
              <Avatar name={item.displayName} color={item.color} emoji={item.emoji} size={40} />
              <View style={s.memberBody}>
                <View style={s.nameRow}>
                  <Text style={s.memberName} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  {isMe ? (
                    <View style={s.youPill}>
                      <Text style={s.youPillText}>{t('members.you')}</Text>
                    </View>
                  ) : null}
                </View>
                {hint ? (
                  <Text style={s.memberHint} numberOfLines={1}>
                    {hint}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <View>
            <Pressable
              onPress={() =>
                prompt.open({
                  title: t('members.addPerson'),
                  placeholder: t('members.name'),
                  confirmLabel: t('common.add'),
                  onSubmit: (text) => addMember(groupId, text),
                })
              }
              accessibilityRole="button"
              accessibilityLabel={t('members.addPerson')}
              style={({ pressed }) => [s.addRow, pressed && s.pressed]}
            >
              <Plus size={18} color={c.appAccent} />
              <Text style={s.addRowText}>{t('members.addPerson')}</Text>
            </Pressable>
            <Text style={s.footer}>
              {t('members.footer')}
            </Text>
          </View>
        }
      />

      <HandlesSheet
        member={editing}
        isMe={editing?.id === me}
        onClose={() => setEditing(null)}
        onSave={(handles) => {
          if (editing) setHandles(groupId, editing.id, handles);
          setEditing(null);
        }}
      />
      {menu.element}
      {prompt.element}
      {confirm.element}
    </View>
  );
}

/* ---- Payment-handles editor (page sheet, sibling of CreateGroupSheet) ---- */

function HandlesSheet({
  member,
  isMe,
  onClose,
  onSave,
}: {
  member: Member | null;
  isMe: boolean;
  onClose: () => void;
  onSave: (handles: PaymentHandles) => void;
}) {
  const { c } = useTheme();
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();

  const [venmo, setVenmo] = useState('');
  const [paypal, setPaypal] = useState('');
  const [cashapp, setCashapp] = useState('');

  // Prefill from the member each time the sheet opens for someone.
  const id = member?.id;
  React.useEffect(() => {
    if (!member) return;
    setVenmo(member.handles?.venmo ?? '');
    setPaypal(member.handles?.paypal ?? '');
    setCashapp(member.handles?.cashapp ?? '');
    // Only re-seed when the target member changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = () => onSave({ venmo, paypal, cashapp });

  return (
    <Modal visible={member != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheetScreen, { paddingTop: insets.top + space.s4 }]}>
          <View style={s.sheetHeader}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8}>
              <X size={24} color={c.fgMuted} />
            </Pressable>
            <Text style={s.sheetTitle} accessibilityRole="header">
              {t('members.paymentHandles')}
            </Text>
            <Pressable onPress={save} accessibilityRole="button" accessibilityLabel={t('common.save')} hitSlop={8} style={({ pressed }) => pressed && s.pressed}>
              <Check size={24} color={c.appAccent} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.s7 }} keyboardShouldPersistTaps="handled">
            <Text style={s.sheetLead}>
              {isMe
                ? t('members.leadMe')
                : t('members.leadOther', { name: member?.displayName ?? t('members.thisPerson') })}
            </Text>

            <Text style={s.label}>{t('members.venmoLabel')}</Text>
            <TextInput
              style={s.input}
              value={venmo}
              onChangeText={setVenmo}
              placeholder={t('members.username')}
              placeholderTextColor={c.fgSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Text style={s.helper}>{t('members.handleHelper')}</Text>

            <Text style={s.label}>{t('members.paypalLabel')}</Text>
            <TextInput
              style={s.input}
              value={paypal}
              onChangeText={setPaypal}
              placeholder={t('members.handle')}
              placeholderTextColor={c.fgSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Text style={s.helper}>{t('members.paypalHelper')}</Text>

            <Text style={s.label}>{t('members.cashappLabel')}</Text>
            <TextInput
              style={s.input}
              value={cashapp}
              onChangeText={setCashapp}
              placeholder={t('members.cashtag')}
              placeholderTextColor={c.fgSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={save}
            />
            <Text style={s.helper}>{t('members.handleHelper')}</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.bg },
    pressed: { opacity: 0.6 },

    iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    backChevron: { fontSize: 30, lineHeight: 32, color: c.fg, fontFamily: fontFamily.sans },
    topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s4, paddingVertical: space.s3, gap: space.s2 },
    topTitle: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg, flex: 1 },

    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      paddingVertical: space.s4,
      paddingHorizontal: space.s5,
      marginBottom: space.s4,
      borderRadius: radius.lg,
      borderWidth: hairline,
      borderColor: c.hairline,
      backgroundColor: c.bgElevated,
    },
    identityLabel: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted },
    identityName: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.fg, marginTop: 1 },
    identityChevron: { ...ty.md, fontFamily: fontFamily.sans, color: c.fgSubtle },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s4,
      paddingVertical: space.s4,
      borderBottomWidth: hairline,
      borderBottomColor: c.hairline,
    },
    memberBody: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
    memberName: { ...ty.base, fontFamily: fontFamily.sansMedium, color: c.fg, flexShrink: 1 },
    memberHint: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted, marginTop: 1 },
    youPill: {
      paddingHorizontal: space.s3,
      height: 22,
      borderRadius: radius.pill,
      backgroundColor: c.appAccentBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    youPillText: { ...ty.xs, fontFamily: fontFamily.sansSemibold, color: c.appAccent },

    addRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s5 },
    addRowText: { ...ty.base, fontFamily: fontFamily.sansMedium, color: c.appAccent },
    footer: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgSubtle, marginTop: space.s4, lineHeight: 20 },

    // Handles sheet
    sheetScreen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: space.s5 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.s5 },
    sheetTitle: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg },
    sheetLead: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgMuted, lineHeight: 22, marginBottom: space.s4 },
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
    helper: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgSubtle, marginTop: space.s3 },
  });
}
