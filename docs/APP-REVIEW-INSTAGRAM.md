# Instagram messaging — App Review submission

**Status: prepared, not submitted.** Submission needs the app dashboard and
Business Manager, which need Samer. Everything that can be written in advance is
written here.

## Why this is required — from Meta's own documentation, not inference

Meta defines two access levels. The distinction is the whole reason Instagram
DMs do not reach this product:

> **Standard Access** — "the default access level for all apps that limits the
> data your app can get and is intended for apps that will only be used by
> **people who have roles on them**, during app development, or for testing."

> **Advanced Access** — "the access level required if your app serves Instagram
> professional accounts that you don't own or manage and **can be used by app
> users who do not have a role on your app** or a role on a business portfolio
> that has claimed your app. This access level **requires App Review and
> Business Verification**."

A customer messaging @voyahlebanon has no role on app `912301501380919` and no
role on the VoyahLebanon portfolio. Under Standard Access their message is
therefore not served to us — which is exactly what has been observed: the
`instagram` webhook object is subscribed, active and pointing at our production
callback, and no Instagram delivery has ever been recorded.

It also explains Meta's error on the Instagram conversations listing,
`code -2 / subcode 2534084`, **"too many conversations with users who do not
have a role on app"** — Meta filtering the list to role-holders and timing out
doing it. That sentence is Standard Access describing itself.

⚠ **`Published` is not Advanced Access.** The app's sidebar reads
`Publish → Published`, and the Instagram page states webhooks require published
state — so that gate is passed and is a different gate. Publishing controls
whether the app is live; access level controls whose data it may serve. Do not
read one as the other.

## What to request

| Permission | Why | Note |
|---|---|---|
| `instagram_manage_messages` | receive and send Instagram DMs | the one that matters |
| `instagram_basic` | read the account the DMs arrive at | dependency |
| `pages_messaging` | the Page path Instagram messaging runs over | |
| `pages_show_list` | resolve the Page | |
| `pages_read_engagement` | read the Page's linked Instagram account | |
| `business_management` | **dependency of `pages_messaging`, `pages_show_list` and `instagram_manage_messages`** | Meta's docs say to call this dependency out explicitly in the submission |

Request these six and no more. Extra scopes are both a security risk and an App
Review problem (rule 10).

## Prerequisites before submitting

1. **Business Verification** on the VoyahLebanon portfolio `1235692167762623` —
   required for every Advanced Access request. The portfolio already holds a
   WhatsApp blue check, so verification may already be complete; confirm rather
   than assume.
2. **At least one successful API call per requested permission.** Meta: *"You
   are required to make at least 1 successful API call using each permission for
   which you are requesting advanced access, and the API call data will be
   logged within 2 days."* The staff diagnosis at
   `/api/channels/diagnose?account=ig-voyah` exercises the Page and Instagram
   reads; sending a DM from a role-holder's account exercises the messaging
   permission under Standard Access.
3. **App settings complete** — app icon, privacy policy URL, app category.
4. **Screen recordings**, 1080p or better, one per requested permission, showing
   a user granting the permission and the app using it. A permission with no
   recording is not approved.

## Screencast script

Record once, covering every permission in one continuous take where possible.

**Setup shown on camera:** the MONZA AI Inbox at `/inbox`, signed in as staff.

1. **Grant** — show the business portfolio granting the app access to the Voyah
   Lebanon Page (`408893845643871`) and @voyahlebanon (`17841457996874250`).
   Covers `business_management`, `pages_show_list`.
2. **Receive** — from a second phone, send a DM to @voyahlebanon. Show it
   appearing in the MONZA AI Inbox, filed under the VOYAH brand. Covers
   `instagram_manage_messages`, `instagram_basic`, `pages_read_engagement`.
3. **Read the thread** — open the conversation and show the message history.
   Covers `pages_messaging`.
4. **Reply** — a staff member types a reply and sends it; show it arriving on
   the customer's phone. Covers `instagram_manage_messages` (send).

⚠ Step 4 requires `CHANNELS_SEND_MODE="live"`. Sending is log-only until
receiving, storage, routing and human review are all proven (rule 24). Do the
recording on a staff-owned test account, and set the flag back afterwards.

## Use-case description to submit

> MONZA SAL is the authorised Dongfeng dealer for the Voyah and MHERO vehicle
> brands in Lebanon. Customers contact us through Instagram Direct to ask about
> vehicle availability, service appointments and parts.
>
> This app receives those messages into a private staff inbox so our sales and
> service teams can answer them from one place alongside Facebook Messenger,
> rather than from a phone. Staff read the conversation and write every reply
> themselves; the app does not send automated messages to customers.
>
> `instagram_manage_messages` is used to receive customer messages at our own
> Instagram professional accounts and to deliver the replies our staff write.
> `instagram_basic` identifies which of our accounts a message arrived at.
> `pages_messaging`, `pages_show_list` and `pages_read_engagement` reach the
> Facebook Page each Instagram account is linked to.
> `business_management` is a required dependency of the three above.
>
> The app is internal to MONZA SAL. It serves only Instagram professional
> accounts our business portfolio owns.

## Reviewer test instructions

> The app is private to MONZA SAL staff and cannot be signed into by a reviewer.
> To observe the permission in use, send an Instagram Direct message to
> @voyahlebanon. The screencast shows the full path from that message arriving
> to a staff member replying.

## The three brands need three submissions

Each brand is a separate Meta app with its own secret and its own access level:

| Brand | App | Instagram account |
|---|---|---|
| VOYAH | `912301501380919` | `17841457996874250` |
| MHERO | `1793221688521200` | `17841469421956644` |
| MONZA SAL | `1603541974633258` | `17841457813791186` |

Prove VOYAH end to end first. Do not submit three reviews for a flow that has
never once been observed working.

## Sources

- [Overview of the Instagram API](https://developers.facebook.com/docs/instagram-platform/overview/)
- [App Review — Instagram Messaging](https://developers.facebook.com/docs/messenger-platform/instagram/app-review/)
- [App Review — Instagram Platform](https://developers.facebook.com/docs/instagram-platform/app-review/)
- [App Review submission guide](https://developers.facebook.com/docs/app-review/submission-guide/)
- [Permissions reference](https://developers.facebook.com/docs/permissions/)
