# IFQM EIT — Flows and Timeline

MOM 29 Jul 2026 §2.1.

Each flow is a drawn diagram. The Mermaid source that describes it is kept
underneath in a collapsed block — open it to edit the flow, then rebuild the
images with `python docs/flow_drawings.py`. The picture is what most readers
want; the source is what the next person to change it wants.

---

## 1. Idea lifecycle

The core loop. Everything else in the product exists to keep an idea moving
along this path.

![1. Idea lifecycle](diagrams/F1_idea_lifecycle.png)

<details>
<summary>Mermaid source for this diagram</summary>

```mermaid
flowchart TD
    A[Employee opens Submit] --> B[Step 1: title + present situation]
    B --> C{Duplicate detected?}
    C -- yes --> C1[Similar ideas shown<br/>submitter decides] --> D
    C -- no --> D[Step 2: proposed solution,<br/>impact areas, tags]
    D --> E[Step 3: business case<br/>feasibility · time required · investment]
    E --> F[Step 4: attachments]
    F --> G[Step 5: co-suggesters]
    G --> H{Submit or save draft?}
    H -- draft --> H1[(Status: Draft)]
    H1 --> B
    H -- submit --> I[AI / heuristic scores 0-100<br/>across six dimensions]
    I --> J[(Status: Submitted)<br/>+10 points · SLA clock starts]
    J --> K{Workflow type}
    K -- hierarchical --> L[Routed to line manager]
    K -- multi-reviewer --> M[Committee assigned<br/>approval threshold applies]
    L --> N{Reviewer decision}
    M --> N
    N -- reject --> O[(Status: Rejected)<br/>reason recorded in timeline]
    N -- approve, not final --> P[Escalates to next role in chain]
    P --> N
    N -- approve, final role --> Q[(Status: Approved)<br/>+25 points]
    Q --> R[Implementation owner + target date]
    R --> S[(Status: Implemented)<br/>+65 points · ROI captured]
    S --> T{QCMS configured?}
    T -- yes --> U[Pushed to QCMS<br/>counted in the platform console]
    T -- no --> V[Ends here]
    O --> W[Visible in Rejected Ideas<br/>with its reason]
```

</details>

**SLA and escalation.** `review_sla_days` flags an idea as overdue; nothing is
reassigned. `escalation_days` moves it up the chain. Both are per organisation,
and the distinction is the reason those fields carry info buttons (§12.13).

---

## 2. MSME registration and approval

Nothing an anonymous caller does provisions anything. The worst a flood of junk
applications achieves is a full review queue.

![2. MSME registration and approval](diagrams/F2_registration.png)

<details>
<summary>Mermaid source for this diagram</summary>

```mermaid
flowchart TD
    A[MSME visits the landing page] --> B[Register your organisation]
    B --> C[Step 1: company + applicant]
    C --> D{Work email domain?}
    D -- gmail / outlook / disposable --> D1[Rejected inline<br/>before the long form] --> C
    D -- corporate domain --> E[Step 2: Udyam, GSTIN, PAN,<br/>entity type, MSME category,<br/>NIC, headcount, turnover]
    E --> F[Step 3: address + confirm authority]
    F --> G[(tenant_registrations: pending)]
    G --> H[Reference REG-n shown]
    G --> I[Platform → Registrations<br/>badge appears]
    I --> J{Platform admin decision}
    J -- reject --> K[(rejected, note kept internally)]
    J -- approve --> L[Org code confirmed]
    L --> M[Tenant database provisioned<br/>from tenant_schema.sql]
    M --> N[First admin created<br/>one-time password shown ONCE]
    N --> O[Operator relays it out of band]
    O --> P[Admin signs in,<br/>forced password change]
    P --> Q[Bulk-import staff · configure<br/>categories and approval chain]
    Q --> R[Organisation live]
```

</details>

A duplicate application returns the same response as a new one. Telling an
anonymous caller "this company already has an account" is a free customer-list
lookup.

---

## 3. Authentication

![3. Authentication](diagrams/F3_authentication.png)

<details>
<summary>Mermaid source for this diagram</summary>

```mermaid
flowchart TD
    A[Sign in: email or phone + password] --> B{Account locked?}
    B -- yes --> B1[429, minutes remaining<br/>recorded as a lockout]
    B -- no --> C{Matches a platform admin?}
    C -- yes --> D[Platform console session]
    C -- no --> E{Org code supplied?}
    E -- yes --> F[Open exactly that organisation]
    E -- no --> G[Resolve org from the login directory<br/>email or phone]
    F --> H{Password correct?}
    G --> H
    H -- no --> I[Failure counted · generic message<br/>5 strikes = 15-minute lock]
    H -- yes --> J[JWT issued · sign-in recorded ·<br/>tenants.last_login_at stamped]
    J --> K{Must change password?}
    K -- yes --> L[Forced change screen<br/>only Support reachable]
    K -- no --> M[Dashboard for their role]
```

</details>

Every subsequent request re-reads the user from the database, so deactivation,
role change and password reset take effect immediately rather than at token
expiry.

---

## 4. Who sees what

![4. Who sees what](diagrams/F4_visibility.png)

<details>
<summary>Mermaid source for this diagram</summary>

```mermaid
flowchart LR
    subgraph Platform["IFQM platform admin"]
        P1[Organisations + aggregate counts]
        P2[Registration queue]
        P3[Support tickets]
        P4[Sign-in activity]
        P5["NEVER: employee rows,<br/>idea content, files"]
    end
    subgraph Org["Organisation"]
        A1[Org admin: everything in their org]
        A2[Plant head / executive: all ideas]
        A3[Manager: their reports' ideas]
        A4[Employee: own ideas + titles of all]
    end
    Platform -.->|provisions, never reads| Org
```

</details>

The full proposal text follows the org's `solution_visibility` setting, on top
of the role scoping above.

---

## 5. Timeline

| When | Milestone |
|---|---|
| Early 2026 | PHP prototype: capture and basic review |
| — | Multi-tenancy: registry + schema per organisation |
| — | Rewrite to React + Node/Express; JWT replaces sessions |
| — | Configurable approval chains, SLA/escalation, committees |
| — | Points, leaderboard, challenges, community voting |
| — | Implementation tracking, ROI, analytics, audit log |
| — | Security hardening: lockout, per-request re-auth, console privacy contract |
| — | 7-language i18n, bulk import, email/phone login |
| — | QCMS integration |
| **29 Jul 2026** | **Review meeting — this MOM** |
| Aug 2026 | MSME self-registration, solution privacy, podium leaderboard, on-hold vs inactive, quotas, patentability, archiving |
| Aug 2026 | Free-tier deployment live (Vercel + Render + Aiven) |
| Next | SMTP in production · OTP login · UAT · Azure OAuth + SSO · billing |

Dates before the MOM are deliberately unanchored: the repository history has the
commit dates, and inventing precise milestones for a handover document would be
worse than saying so.
