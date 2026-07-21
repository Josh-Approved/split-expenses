/**
 * Share a group — the whole pairing handshake.
 *
 * Person 1: a QR + a link, sent however they like. Person 2: scan it or tap
 * it. No account, no sign-up, ever. After this one handshake the devices stay
 * synced — the link is just the introduction. Honest about how that sync works:
 * the group lives on members' phones and is passed, end-to-end encrypted,
 * through free public drop boxes the studio doesn't run and can't read.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Share,
  Linking,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X, Share2, ScanLine } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation';
import { useGroups } from '../store/groups';
import { buildShareLink, parseShareLink } from '../sync/share';
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
import { boundedContent } from '../theme';
import { t } from '../i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Share'>;

export default function ShareScreen({ route, navigation }: Props) {
  const { groupId } = route.params;
  const { c } = useTheme();
  const s = makeStyles(c);

  const group = useGroups((st) => st.groups.find((g) => g.id === groupId));
  const shareGroup = useGroups((st) => st.shareGroup);

  const [secret, setSecret] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  // Mint the share secret on mount (or reuse the existing one). The store
  // returns null only if the group is missing.
  useEffect(() => {
    setSecret(shareGroup(groupId));
  }, [groupId, shareGroup]);

  const link = secret ? buildShareLink(secret) : '';

  const onSend = () => {
    if (link) Share.share({ message: link }).catch(() => {});
  };

  const onScanned = ({ data }: { data: string }) => {
    if (scannedRef.current) return;
    const sec = parseShareLink(data);
    if (!sec) return;
    scannedRef.current = true;
    setScanning(false);
    const id = useGroups.getState().joinShared(sec);
    // Claim a member first (forwards to the group once "me" is set).
    navigation.replace('ClaimMember', { groupId: id });
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        // Still flip into scan mode so the calm denied-state shows.
        setScanning(true);
        return;
      }
    }
    scannedRef.current = false;
    setScanning(true);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">
          {scanning ? t('share.scanTitle') : t('share.shareTitle')}
        </Text>
        <Pressable
          onPress={() => (scanning ? setScanning(false) : navigation.goBack())}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}
        >
          <X size={22} color={c.fg} strokeWidth={1.5} />
        </Pressable>
      </View>

      {scanning ? (
        <View style={s.scanWrap}>
          {permission?.granted ? (
            <>
              <CameraView
                style={s.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onScanned}
              />
              <Text style={s.hint}>{t('share.scanHint')}</Text>
            </>
          ) : (
            <View style={s.deniedWrap}>
              <Text style={s.deniedTitle}>{t('share.cameraOff')}</Text>
              <Text style={s.deniedBody}>
                {t('share.cameraBody')}
              </Text>
              <Pressable
                onPress={() => Linking.openSettings().catch(() => {})}
                accessibilityRole="button"
                accessibilityLabel={t('share.openSettings')}
                style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
              >
                <Text style={s.primaryText}>{t('share.openSettings')}</Text>
              </Pressable>
              <Pressable
                onPress={() => requestPermission()}
                accessibilityRole="button"
                accessibilityLabel={t('share.tryAgain')}
                style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}
              >
                <Text style={s.ghostText}>{t('share.tryAgain')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : (
        <View style={s.body}>
          <Text style={s.lead}>
            {t('share.leadBefore')}
            <Text style={s.leadStrong}>{group?.name ?? t('group.thisGroup')}</Text>
            {t('share.leadAfter')}
          </Text>
          {link ? (
            <View style={s.qrCard}>
              <QRCode value={link} size={220} backgroundColor="#FFFFFF" color="#000000" />
            </View>
          ) : null}
          <Pressable
            onPress={onSend}
            accessibilityRole="button"
            accessibilityLabel={t('share.sendLink')}
            style={({ pressed }) => [s.primaryBtn, s.primaryBtnRow, pressed && s.pressed]}
          >
            <Share2 size={18} color={c.inkButtonText} strokeWidth={1.5} />
            <Text style={s.primaryText}>{t('share.sendLink')}</Text>
          </Pressable>
          <Pressable
            onPress={startScan}
            accessibilityRole="button"
            accessibilityLabel={t('share.scanInstead')}
            style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}
          >
            <ScanLine size={18} color={c.fg} strokeWidth={1.5} />
            <Text style={s.ghostText}>{t('share.scanInstead')}</Text>
          </Pressable>
          <Text style={s.fineprint}>
            {t('share.fineprint')}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    pressed: { opacity: 0.6 },
    header: {
      ...boundedContent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.s5,
      paddingVertical: space.s4,
    },
    title: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg },
    iconBtn: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },

    body: { ...boundedContent, flex: 1, alignItems: 'center', paddingHorizontal: space.s7, gap: space.s6 },
    lead: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgMuted, textAlign: 'center', marginTop: space.s4 },
    leadStrong: { fontFamily: fontFamily.sansSemibold, color: c.fg },
    qrCard: {
      padding: space.s6,
      backgroundColor: '#FFFFFF',
      borderRadius: radius.lg,
      borderWidth: hairline,
      borderColor: c.hairline,
    },
    primaryBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: target.min,
      paddingHorizontal: space.s7,
      backgroundColor: c.inkButton,
      borderRadius: radius.md,
      alignSelf: 'stretch',
    },
    primaryBtnRow: { flexDirection: 'row', gap: space.s3 },
    primaryText: { ...ty.base, fontFamily: fontFamily.sansSemibold, color: c.inkButtonText },
    ghostBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.s3,
      minHeight: target.min,
    },
    ghostText: { ...ty.base, fontFamily: fontFamily.sans, color: c.fg },
    fineprint: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted, textAlign: 'center', lineHeight: 20 },

    scanWrap: { flex: 1, alignItems: 'center', gap: space.s5 },
    camera: { width: '86%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', marginTop: space.s5 },
    hint: { ...ty.sm, fontFamily: fontFamily.sans, color: c.fgMuted, textAlign: 'center' },

    deniedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s7, gap: space.s5 },
    deniedTitle: { ...ty.md, fontFamily: fontFamily.sansSemibold, color: c.fg, textAlign: 'center' },
    deniedBody: { ...ty.base, fontFamily: fontFamily.sans, color: c.fgMuted, textAlign: 'center', lineHeight: 22 },
  });
}
