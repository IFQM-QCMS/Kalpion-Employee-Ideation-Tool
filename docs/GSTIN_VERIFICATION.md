# GSTIN verification at registration

**MOM 24/08/2026 §2** — *"Explore the feasibility of implementing GSTIN
verification during organisation registration."*

This note answers the feasibility question and records what was built.

---

## The short version

There are two different things "verify a GSTIN" can mean. One is free and is now
live. The other needs a commercial contract and is not.

| | Structural verification | Live GSTN lookup |
|---|---|---|
| Confirms the number is well-formed | yes | yes |
| Catches typos and invented numbers | yes | yes |
| Confirms the number was actually **issued** | no | yes |
| Confirms it belongs to **this** business | no | yes |
| Confirms it is **currently active** | no | yes |
| Cost | none | per-call, contracted |
| External dependency | none | a GSP, with its uptime |
| **Status** | **implemented** | **not implemented — see below** |

---

## What is implemented

`backend/src/utils/gstin.js`, called from `registrationService.submit()`.

A GSTIN is not an opaque string. It is:

```
27 AAPFU0939F 1 Z V
├┘ ├────────┘ │ │ └ check character over the first 14
│  │          │ └── always 'Z' (reserved)
│  │          └──── registration count for this PAN in this state
│  └─────────────── the holder's PAN, embedded verbatim
└────────────────── state code
```

Three things are therefore checkable offline, and all three are checked:

1. **The check digit.** Weights alternate 1, 2 from the left; each product is
   folded back into base 36 as quotient plus remainder before summing. The fold
   is what makes the algorithm catch a transposition and not only a
   substitution.
2. **The state code**, against the issued list. The gaps are real — there is no
   39–96 — so it is a set, not a range. `97` (Other Territory) and `99` (Centre
   Jurisdiction) are valid and accepted.
3. **The embedded PAN**, against the PAN field on the same form. The GSTIN
   contains the PAN, so a form where the two disagree has one of them wrong.

### What this replaced

A regex. It accepted `27AAAAA0000A1Z9` — correctly shaped, and not a GSTIN —
which then reached a human reviewer with nothing to distinguish it from a real
one.

### How strongly it was tested

Property-based rather than against a list of remembered numbers (an earlier
version of the test did that, and three of its five "known-good" numbers turned
out to be invented — the test data was wrong, not the algorithm):

- the GSTN's canonical documented example verifies
- 20,000 generated numbers verify against their own computed check character
- **210,000** single-character mutations — every one rejected
- **5,127** adjacent transpositions — every one rejected

### What it deliberately does not do

The error message for a failed check digit does **not** quote the expected
character back. Doing so would turn the error into a recipe for fabricating a
passing number: type anything, read off the correct final character, resubmit.
An applicant holding a real certificate needs to be told to re-read it, which is
what it says.

Nothing in the UI or the reviewer's screen uses the word "verified" for a number
that has only passed arithmetic. Telling a reviewer a GSTIN is verified when all
we did was check a digit would be a claim they might act on.

---

## The live lookup, and why it is not built

Confirming a GSTIN was issued, is active, and belongs to the applicant means
calling the GSTN. That is not a public API.

**What it requires**

- A **GSP** (GST Suvidha Provider) contract, or an authorised reseller such as
  ClearTax, Masters India, Signzy or KarzaHQ. Direct GSTN access is granted to
  licensed GSPs only.
- A paid plan, billed per call. Typical reseller pricing is roughly ₹0.50–₹2.00
  per lookup at low volume, with a minimum commitment.
- Credentials held server-side and rotated. They must never reach the browser —
  which means the sign-up form cannot call the API directly, and the check has
  to be proxied through our backend, rate-limited per IP.
- A defined behaviour for downtime. The GSTN has scheduled outages and
  unscheduled ones, and they cluster around filing deadlines — which is exactly
  when a business is most likely to be doing paperwork and signing up.

**The design question it forces**

If the lookup is unavailable, does registration block or proceed? Blocking makes
a third party's uptime a prerequisite for acquiring a customer. Proceeding means
the verification is advisory, and an application can be approved without it —
in which case the reviewer needs to see *which* applications were checked and
which were not, or the badge means nothing.

That is a product decision with a recurring cost attached, not an engineering
task, which is why this note stops here rather than guessing at it.

**Recommendation.** Structural verification already removes the entire class of
problem it is cheap to remove: typos, transpositions and invented numbers. What
remains — a real GSTIN belonging to somebody else — is a deliberate act of
fraud, and it is caught better by the existing manual approval step, where a
human compares the company name, the domain and the applicant's address, than by
an API call that only confirms the number exists.

Revisit if self-service registration is ever opened without manual approval. At
that point the human check disappears and the API stops being optional.

---

## If it is commissioned later

The seam is already in place. `verifyGstin()` returns a result object rather
than a boolean, so a `live: { active, legal_name, state }` block can be added to
it without touching any caller. `registrationService.submit()` inspects `.ok`
and nothing else.

Suggested order:

1. Add the GSP client behind an org-level feature flag, default off.
2. Call it **after** structural verification passes — never before. There is no
   reason to spend a paid call on a number that fails its own check digit, and
   at typical typo rates that is a meaningful share of submissions.
3. Cache by GSTIN for 30 days. Registration details do not change often, and
   the same applicant retrying a form should not bill twice.
4. Store the response verbatim on the registration row, so a reviewer months
   later can see what the GSTN actually said rather than a boolean somebody
   derived from it.
