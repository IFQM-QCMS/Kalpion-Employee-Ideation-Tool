# What we need to switch on OTP verification

**Everything below is procurement, not engineering.** The code is written, tested
and deployed; every field named here has a box waiting for it in
**Platform → Settings → Messaging**. Nothing on this list needs a developer, and
nothing needs a release.

| | |
|---|---|
| **SMS codes** | Jio DLT registration + an SMS gateway account |
| **Email codes** | A ZeptoMail account with one verified domain |
| **Who can do it** | Anyone with an IFQM platform-admin login |
| **Blocked on** | The two accounts below. Nothing else. |

> [!IMPORTANT]
> **DLT registration is the long pole — start it first.** Operator approval of an
> entity takes days, and template approval takes hours to days after that.
> ZeptoMail can be done in an afternoon. Do them in parallel.

---

## 1. Jio DLT — for codes sent by SMS

Under TRAI's rules no business can send a text to an Indian mobile without
registering first. Registration happens on an operator's DLT portal; Jio's is
**Jio TrueConnect** (`trueconnect.jio.com`). Registering once with Jio covers
every operator — you do not repeat it for Airtel and VI.

### 1.1 What you upload to register the business

| # | Item | Notes |
|---|---|---|
| 1 | **PAN** of the company | |
| 2 | **GSTIN** or CIN | Whichever the entity has |
| 3 | **Certificate of incorporation** / Udyam certificate | |
| 4 | **Authorised signatory** — name, designation, email, mobile | Must be a person who can sign for the company |
| 5 | **Letter of authorisation** on company letterhead | Jio supply the template |
| 6 | **Company address proof** | |

Approval produces the first thing we need:

> **① Principal Entity ID (PE ID)** — about 19 digits.

### 1.2 Register the sender name

You then register a **Header**, which is the six characters the recipient sees
instead of a phone number.

- Exactly **6 characters**, uppercase letters only.
- For codes it must be registered as **transactional**, not promotional.
  Promotional headers are blocked on DND numbers, which is most people.
- Suggest `IFQMOT` or `IFQMIN` — check availability, headers are first-come.

> **② Header / Sender ID** — 6 characters.

### 1.3 Register the message wording

This is the step that catches everybody. The **exact text** has to be approved in
advance, with `{#var#}` marking anything that changes.

Submit this, character for character:

```
{#var#} is your IFQM sign-in code. It expires in {#var#} minute(s). Do not share it with anyone.
```

Category: **Transactional** (or Service Implicit). Approval gives:

> **③ Content Template ID** — about 19 digits.

> [!WARNING]
> **If the text sent does not match the approved template exactly, the carrier
> drops the message and tells nobody.** No error, no delivery report, no bounce —
> the gateway even reports success. The user simply says nothing arrived.
> This is why the approved wording is stored in the console as an editable field
> rather than hard-coded: if you change the template on the DLT portal, change it
> in the console too, and the two stay in step.

### 1.4 An SMS gateway account

DLT registration gives you permission. It does not give you an API. You still
need a gateway to actually send through, and you register your PE ID with them.

Any of these work — the connector is written against the shape they all share:

| Gateway | Notes |
|---|---|
| **Jio's own SMS API** | Ask your Jio account manager. Simplest if the DLT registration is already with Jio. |
| **MSG91** | Widely used for OTP in India, good documentation. |
| **Gupshup / Kaleyra / Airtel IQ** | All fine. |

From whichever you pick, we need:

> **④ API key / auth token**
> **⑤ The send endpoint URL** — e.g. `https://api.msg91.com/api/v5/flow/`

The endpoint field currently holds `https://api.jiodlt.com/sms/v1/send`, which is
a **placeholder and does not resolve**. It must be replaced with the real one
from your provider. The console will say so plainly if you test before changing
it.

### 1.5 Also worth asking the gateway for

- **Delivery reports** — whether they can post delivery receipts back. We do not
  consume them yet, but it is the difference between "accepted" and "arrived".
- **Rate limits** — messages per second and per day.
- **Cost per message** and whether it differs by operator.

---

## 2. ZeptoMail — for codes sent by email, and for all platform email

ZeptoMail is Zoho's transactional email service. It is a good choice here for a
reason worth stating: **our current host blocks outbound SMTP ports**, so a
perfectly correct mail server cannot be reached at all. ZeptoMail is an HTTPS
API, so it is not blocked.

### 2.1 Setting it up

1. Create a ZeptoMail account at `zoho.com/zeptomail`.
   **Pick the India data centre** if the account is Indian — this matters, see
   the warning below.
2. **Add and verify a sending domain.** Zoho give you DNS records to add:
   - **SPF** — a TXT record
   - **DKIM** — a TXT record
   - **DMARC** — recommended, not required to start
   These go wherever your domain's DNS is hosted. Verification is usually
   minutes once the records propagate.
3. Create a **Mail Agent** (ZeptoMail's name for a sending identity).
4. From that Mail Agent, copy the **Send Mail token**.

### 2.2 What we need

> **⑥ Send Mail token** — a long string beginning `Zoho-enczapikey `.
> Paste it exactly as Zoho show it, prefix included.
>
> **⑦ From address** — e.g. `noreply@ifqm.in`. Must be on the verified domain
> **and** belong to the same Mail Agent the token came from.
>
> **⑧ Which data centre** — India, Global or Europe. Chosen from a dropdown.

> [!CAUTION]
> **The region must match.** `api.zeptomail.in` and `api.zeptomail.com` are
> separate installations. A token from one returns **401 Access Denied** on the
> other, and the error does not mention regions — it looks exactly like a wrong
> token. The console appends a hint about this to any 401 it sees, because it
> costs an afternoon otherwise.

### 2.3 Free tier

ZeptoMail gives 10,000 emails free on signup, then sells credits. For sign-in
codes and notifications at MSME scale that is a long runway.

---

## 3. The complete list, on one page

Hand this to whoever is doing the procurement.

| # | What | From | Looks like |
|---|---|---|---|
| ① | Principal Entity ID | Jio TrueConnect | `1101234567890123456` |
| ② | Header / Sender ID | Jio TrueConnect | `IFQMOT` — exactly 6 chars |
| ③ | Content Template ID | Jio TrueConnect | `1107161234567890123` |
| ④ | Gateway API key | Your SMS gateway | a long secret string |
| ⑤ | Gateway endpoint URL | Your SMS gateway | `https://…` — must be https |
| ⑥ | ZeptoMail Send Mail token | ZeptoMail Mail Agent | `Zoho-enczapikey …` |
| ⑦ | Verified From address | Your DNS + ZeptoMail | `noreply@ifqm.in` |
| ⑧ | ZeptoMail data centre | Your Zoho account | India / Global / Europe |

Nothing else is required. No code change, no deployment, no environment
variable, no database work.

---

## 4. Once you have them

1. Sign in as a platform admin → **Settings → Messaging**.
2. Fill in ① to ⑤ under **Jio DLT SMS gateway**, switch the connector on, save.
3. **Send test message** to your own mobile. This sends a real message using the
   registered template — which is the only way to prove the template is genuinely
   approved. A check that merely validated the fields would pass on a template
   the carrier has never seen.
4. Fill in ⑥ to ⑧ under **ZeptoMail**, switch it on, save, **Send test email**.
5. Only then switch on **Sign-in by one-time code**.

> [!NOTE]
> The console **refuses** to enable code sign-in while the gateway could not
> deliver, and names the field that is missing. That is deliberate: a sign-in
> method offered on the login screen that silently never works is worse than one
> that is not offered, because the user abandons a password that works for a code
> that never comes.

**"Accepted by the gateway" is not "delivered to the handset."** The console says
so on the test result. A carrier can still drop a message whose template is not
registered. Always confirm the test actually arrived.

---

## 5. What is already built

For the avoidance of doubt, none of this is outstanding work:

- Codes are generated from a cryptographic RNG, stored **bcrypt-hashed**, single
  use, and expire on a configurable timer.
- Requesting a code reveals **nothing** about whether the number is registered —
  the response is identical either way, so the endpoint cannot be used to test
  which numbers belong to staff.
- Wrong guesses are counted per code and burn it after five, so six digits cannot
  be guessed at network speed.
- Issuing a new code invalidates the previous one.
- The gateway key and mail token are **never sent to the browser**, and an empty
  field on save means "keep the stored one" rather than erasing it.
- Every send attempt is logged with the recipient masked to its last four digits.
  The message body — which contains the code — is never recorded.
- The whole thing is off until you switch it on, and cannot be switched on while
  it could not deliver.

---

## 6. Two things found while building this

Worth knowing, because both were silent failures.

**One-time-code sign-in has been complete and unreachable since it was built.**
The policy rows existed in the database, but they were on no whitelist, so no
screen and no endpoint could ever set `otp_enabled` to `1`. The feature could not
be turned on by any means short of editing the database by hand. That is fixed —
the settings are now writable, and there is a test pinning it.

**Notification emails have never been sent.** `processEmailQueue` was written and
tested and then called by nothing at all. Every idea submission and every
approval decision queued an email that sat in the table forever. On this machine
there were **23 waiting, the oldest from 10 July** — a month of notifications
that nobody received, while the application reported success at every step,
because queueing succeeded. A scheduler now drains the queue every 60 seconds,
and the Messaging screen shows the backlog so it cannot go unnoticed again.
