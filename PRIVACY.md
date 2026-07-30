# Privacy

Split Expenses is built so your money stuff stays your business. No paywall. No
ads. No tracking. No accounts. Your data stays with you.

## What we collect

Nothing. There is no account, no sign-up, no email or phone number, no profile,
and no analytics. We don't have a server that stores your groups, and we never
see your expenses, your balances, the people in your groups, or anything else
you put in the app.

## Where your data lives

Your groups, expenses, and balances are kept on your phone. That's the whole
store. There is no copy of it sitting on a company server somewhere.

When you **share a group** with other people, that group also needs to travel
between your phones so everyone sees the same thing. Here's exactly how that
works, in plain terms:

- Everything in a shared group is **encrypted on your phone first**, with a key
  that only the people you shared the group with have. The key comes from the
  share link or QR code. It is never sent to us or anyone else.
- The encrypted bundle is passed through **free, public "drop boxes"** (a swarm
  of open relays that anyone can use). We don't run these drop boxes, we don't
  pay for them, and we can't read what passes through them. To a drop box, your
  group is just a blob of scrambled bytes addressed to a random-looking label.
- Other members' phones pick up that bundle and decrypt it locally. The
  balances everyone sees are then **calculated on each phone** from the shared
  records. They are never stored or sent as numbers, so nobody can be shown a
  different total.

So a shared group is readable only on the phones of the people you shared it
with. Not by us, not by the drop boxes, not by anyone in between.

## Payment hand-offs

When you settle up, you can record a cash payment, or hand off to a payment app
(Venmo, PayPal, Cash App) the recipient chose to share. We **never move,
hold, or confirm money**: we just open that app with the amount filled in. If a
member adds a payment handle, it travels encrypted inside the group like
everything else, and is only ever visible to that group.

## Currency rates

If you enter an expense in another currency, the app downloads a **whole table
of exchange rates** and does the conversion on your phone. It never sends the
amount, the currencies, or anything about your expense to look up a rate. So a
rate lookup tells the outside world nothing about you.

## Permissions

- **Camera**: only if you scan a group's QR code or snap a receipt. Receipt
  photos are kept on your phone and are not shared with the group.
- **Notifications**: only if you turn on settle-up reminders. Those are gentle
  nudges on **your own** phone about **your own** balances. We never message,
  email, or notify anyone else. There is no way for the app to do that.

Both are off until you use the feature, and neither is ever used to contact
another person.

## Backups

You can export a backup of your data to a file you control, any time. A shared
trip also lives on every member's phone, so it re-syncs if you get a new device.
We are not part of any of that. There is nothing for us to back up, because we
never have your data.

## Open source

The app is open source. You can read exactly what it does:
https://github.com/Josh-Approved/split-expenses

## Contact

Questions? info@joshapproved.com
