# Split Expenses

Split shared costs with a group (a trip, a household, a couple) and see who
owes whom, settled in the fewest payments. No paywall. No ads. No tracking. No
accounts. Your data stays with you.

## What it does

- **Track who paid for what** across as many groups as you like, with as many
  expenses as you like. No limits, no "Pro" tier.
- **Split any way:** evenly, by exact amounts, by shares, or by percentage. More
  than one person can pay for the same expense.
- **See the fewest payments that settle up.** Every balance can be tapped to see
  exactly how it was worked out.
- **Any currency.** Enter an expense in one currency and settle in another; the
  rate is captured when you add it, so past balances never shift.
- **Share a group with a link or QR code.** Everyone's phone stays in sync, with
  no account and nothing held on a company server. See [PRIVACY.md](PRIVACY.md)
  for exactly how.
- **Settle up your way:** record a cash payment, or hand off to Venmo, PayPal,
  or Cash App. The app never touches the money. It just opens the right screen.
- **Attach receipt photos**, add categories, and export a group to CSV for
  accounting.
- Works fully offline; a shared group catches up when you're back online.

## Platforms

iOS and Android, full parity: every action works the same on both.

## How to get it

Coming soon to the App Store and Google Play. Until then, the source is here and
there's a page at [joshapproved.com/apps/split-expenses](https://joshapproved.com/apps/split-expenses).

## Run it locally

```bash
git clone https://github.com/Josh-Approved/split-expenses
cd split-expenses
npm install
npx expo run:ios      # or: npx expo run:android
```

It's an Expo app, so you'll need the Expo / React Native toolchain (Xcode for
iOS, Android Studio for Android). `npm test` runs the split-math unit tests.

## Built with

React Native + Expo. The shared-group sync uses end-to-end encryption over free,
public relays; balances are derived on each device and never stored or synced.

## Privacy

See [PRIVACY.md](PRIVACY.md). Short version: there's no account and no server
holding your data. Your groups live on your phone, and a shared group is passed
encrypted through public drop boxes we don't run and can't read.

## Feedback

Found a bug or want something? Email **feedback@joshapproved.com**, or open an
issue. If the app's useful to you, there's an optional tip jar in the app.

## License

[MIT](LICENSE).

---

A *Josh Approved* app.
