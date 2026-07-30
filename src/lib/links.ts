/**
 * Canonical external links + the version label, in one place so the Settings
 * About block and the primary-screen funding row stay in sync (canon
 * § Funding & feedback, § Settings/About).
 */

import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Gates the IAP tip jar — the sanctioned funding surface (App Store guideline
 * 3.1.1 requires digital donations to go through In-App Purchase, not an
 * external link-out). Powers the home support button and the Settings/About
 * support row, each opening the canonical TipJarSheet.
 */
export const TIP_JAR_ENABLED: boolean = true;

export const STUDIO_URL = 'https://joshapproved.com';
export const REPO_URL = 'https://github.com/Josh-Approved/split-expenses';
export const PRIVACY_URL =
  'https://github.com/Josh-Approved/split-expenses/blob/main/PRIVACY.md';

/** In-app feedback goes to the dedicated inbox (canon § Feedback inbox).
 *  `info@` is reserved for store-listing contacts. */
export const FEEDBACK_EMAIL = 'feedback@joshapproved.com';

// Filled once the App Store Connect record exists; empty is the pre-store state.
export const IOS_APP_STORE_ID = '';
export const ANDROID_PACKAGE = 'com.joshapproved.splitexpenses';

/** "1.0.0 (3)" — version + build number, read from the bundle so users can
 *  quote it verbatim in feedback (canon § Settings/About). */
export function versionLabel(): string {
  const cfg = Constants.expoConfig;
  const version = cfg?.version ?? '1.0.0';
  const build =
    Platform.OS === 'ios'
      ? cfg?.ios?.buildNumber
      : cfg?.android?.versionCode != null
        ? String(cfg.android.versionCode)
        : undefined;
  return build ? `${version} (${build})` : version;
}

export function openUrl(url: string) {
  Linking.openURL(url).catch(() => {});
}

export function openFeedbackMail() {
  const subject = encodeURIComponent(`Split Expenses ${versionLabel()}`);
  openUrl(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
}

export function openReview() {
  const url =
    Platform.OS === 'ios'
      ? `itms-apps://apps.apple.com/app/id${IOS_APP_STORE_ID}?action=write-review`
      : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&showAllReviews=true`;
  openUrl(url);
}
