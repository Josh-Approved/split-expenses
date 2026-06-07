/**
 * Settle-up reminders — a gentle, opt-in, per-device nudge.
 *
 * STRICTLY SELF-ONLY: the notification only ever asks the person holding THIS
 * phone to glance at their own balances. It never names, mentions, or messages
 * anyone else, and it carries no data about other members. We schedule a single
 * recurring weekly local notification — never push, never a server.
 *
 * Off by default. The Settings switch owns the user's stored preference; these
 * functions own the OS permission + the actual schedule.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// A stable channel for Android so the recurring reminder lands in one place.
const ANDROID_CHANNEL_ID = 'settle-up-reminders';

// Weekly, Sunday late-morning — a calm, low-frequency cadence (1 = Sunday).
const WEEKDAY = 1;
const HOUR = 11;
const MINUTE = 0;

const TITLE = 'Settle up?';
const BODY = 'Check what you owe or are owed in your groups.';

let handlerSet = false;

/** Register the foreground handler once. Quiet by default — no sound, no badge;
 *  this is a nudge, not an alarm. Safe to call repeatedly. */
export function ensureNotificationHandler(): void {
  if (handlerSet) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  handlerSet = true;
}

async function ensureAndroidChannel(): Promise<void> {
  // Android requires a notification channel; iOS has no equivalent. This only
  // sets up the channel — the reminder feature itself runs on both platforms.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Settle-up reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: undefined,
    });
  }
}

/**
 * Request permission and, if granted, schedule the recurring weekly reminder.
 * Returns whether reminders are now on (false if the user declined permission).
 * Idempotent: clears any existing schedule first so we never stack duplicates.
 */
export async function enableReminders(): Promise<boolean> {
  ensureNotificationHandler();

  const settings = await Notifications.getPermissionsAsync();
  let granted =
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted =
      req.granted ||
      req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }
  if (!granted) return false;

  await ensureAndroidChannel();
  // Start clean so re-enabling never schedules a second copy.
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: TITLE,
      body: BODY,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: WEEKDAY,
      hour: HOUR,
      minute: MINUTE,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null),
    },
  });
  return true;
}

/** Cancel every scheduled reminder. Safe to call when none exist. */
export async function disableReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    /* nothing scheduled — fine */
  }
}
