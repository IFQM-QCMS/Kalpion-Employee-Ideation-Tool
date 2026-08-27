# DLT template requests — outstanding

Two content templates are still needed under header **IFQMID-T**
(PE ID `1201174858303838784`, Kaleyra SID `HXAP1678914824IN`).

The code is already written for both. Each has its wording fixed and a slot
waiting for an ID in `backend/src/config/smsTemplates.js`; when an ID is
granted, paste it in and set `registered: true`. Nothing else changes and no
redeploy logic is involved.

---

## 1. Number Change OTP — *new, please register*

**Why it is needed.** An employee changing the mobile number on their account is
sent a code to prove they hold the new handset. There is no template for this
today, so it borrows the **Registration OTP** — meaning somebody changing their
number is told to *"complete your registration"*. It arrives and the code works;
the wording describes the wrong action.

It borrows the registration's ID **and** its text together, so nothing is being
dropped. This request is about the wording, not about delivery.

**Category:** Transactional (it carries a one-time password)

**Requested wording:**

```
Dear Customer, use OTP {#number#} to confirm your new mobile number on IFQM Ideation. Do not share this OTP with anyone.
```

Same shape as the three already approved: one variable, no expiry period, the
"do not share" closing. 114 characters filled — one SMS segment.

---

## 2. Mobile Number Changed — *re-submission*

**Status.** Submitted; Jio classified it **Service Implicit** rather than
Transactional, so it has no ID and is **not being sent at all**.

**Why it matters.** This is the only warning the rightful owner of a number gets
if somebody moves an account onto a different handset. Until it has an ID the
platform declines to send it — deliberately, because sending it without a
registration means the gateway accepts it, the carrier discards it, and every
log here records a delivery that never happened. A security alert that silently
reports success is worse than one that is visibly switched off. The e-mail half
of the alert still goes out.

**Requested wording (unchanged):**

```
Your IFQM Ideation sign-in number was changed to one ending {#number#}. If this was not you, contact your administrator.
```

**On the Service Implicit classification.** Worth pushing back on. The message is
sent as the direct result of an action the account holder just took on their own
account, to the number that was on file before the change — it is not a
service update, a notification or anything the recipient opted into. It is the
security confirmation of a credential change, in the same family as the OTP
templates already approved as Transactional.

If Jio holds the Service Implicit classification, that is workable — Service
Implicit messages are still delivered to non-DND numbers, which covers the case
this alert exists for. Either category is better than the current state, which
is not sending it.

---

## Already approved — no action

| Template | ID |
|---|---|
| Registration OTP | `1277178671564743852` |
| Sign-in OTP | `1277178730169418603` |
| Password Reset OTP | `1277178730612100625` |

---

## When an ID arrives

In `backend/src/config/smsTemplates.js`:

```js
phone_verify: {          // or phone_changed
  id: '<the new id>',    // ← paste
  registered: true,      // ← flip
  ...
}
```

Redeploy. The boot log states which templates are live and which are not, so the
change is confirmed in the first lines the server prints:

```
sms: kaleyra via IFQMID-T — 5 template(s) registered (…)
```
