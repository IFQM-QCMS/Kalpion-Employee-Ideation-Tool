# Hosting comparison — Azure vs AWS vs Hostinger

MOM 29 Jul 2026 §15.1. Written to support a decision, not to make it.

**Costs below are indicative and were checked in August 2026.** Cloud pricing
moves, and every provider has India-region rates, reserved-instance discounts
and startup credits that change the answer materially. Confirm on the vendor's
own calculator before committing.

---

## What this app actually needs

Worth stating first, because it rules several options in and out immediately:

| Requirement | Note |
|---|---|
| Node.js 18+ process | Long-running. Not a serverless function — the app holds DB pools per tenant. |
| **MySQL 8** | Not Postgres. This rules out the free tiers of several PaaS providers. |
| Static file hosting | The React build. Any CDN or static host. |
| **Persistent disk** | Uploads live on disk (`backend/uploads/`) while their rows live in the DB. An ephemeral filesystem silently breaks attachments. |
| Outbound SMTP | For password reset and notifications. |
| TLS | The app enforces HTTPS and HSTS in production. |

Scale today is modest: a handful of tenants, tens to low hundreds of users each,
bursty rather than sustained traffic.

---

## Side by side

| | **Azure App Service** | **AWS (Elastic Beanstalk / Lightsail)** | **Hostinger VPS** |
|---|---|---|---|
| Indicative cost | ~$30–60/mo (B1/B2 + Azure DB for MySQL Flexible Server) | ~$25–50/mo Beanstalk (EC2 + ALB + storage); Lightsail from ~$10 | ~$8–25/mo, MySQL self-hosted on the same box |
| MySQL | Managed (Flexible Server), backups + PITR included | Managed (RDS/Aurora), backups + PITR included | You install and maintain it |
| Persistent disk | Yes | Yes (EBS) | Yes |
| TLS certs | Managed | Managed (ACM) | Let's Encrypt, you renew |
| Scaling | Autoscale built in | Autoscale built in | Resize the VPS manually |
| Ops burden | Low | Medium (most moving parts) | **High — OS patching, MySQL, backups, TLS are all yours** |
| Backups | Automatic | Automatic | You script it (`npm run backup` exists) |
| **OAuth / SSO fit** | **Entra ID is first-party** | Cognito, or federate to Entra | Nothing native |
| India regions | Central & South India | Mumbai, Hyderabad | EU/US; India via CDN only |
| Lock-in | Moderate | Moderate–high | Minimal (it is a Linux box) |

---

## Recommendation

**Azure, primarily because of a decision already taken.** MOM §12.7 specifies
Azure for OAuth and §12.6 asks for SSO across QCMS, DWM and Skills. If identity
is going to live in Entra ID, hosting the app in the same cloud removes a
cross-cloud identity federation from the critical path of a feature that is
already non-trivial. That reason outweighs the cost difference at this scale —
the gap between providers here is a few thousand rupees a month, which is less
than the engineering time federation would consume.

Concretely: **App Service (Linux, B1)** + **Azure Database for MySQL Flexible
Server (Burstable B1ms)** + **Azure Blob Storage** for uploads, so attachments
stop depending on instance disk. Static frontend on Azure Static Web Apps or any
CDN.

**AWS** is the equal of Azure technically and cheaper on Lightsail, but has no
advantage here that offsets the identity argument — and Beanstalk has the most
parts to understand for a team that will inherit this.

**Hostinger** is the cheapest by a wide margin and the wrong choice for this
handover. Everything a managed platform does silently — patching, MySQL
upgrades, backup verification, certificate renewal — becomes a named person's
recurring job. The MOM (§1.4, §3.3) is explicitly about IFQM being able to
sustain this tool after handover; a VPS maximises exactly the work that is
hardest to sustain. It is a reasonable staging or demo box.

---

## One thing to fix regardless of provider

**Uploads are on local disk.** That is fine on a VPS or a single always-on
instance, and quietly wrong the moment there is more than one instance or the
platform recycles the filesystem. Attachments disappear while their database
rows survive, so the UI shows a file that 404s.

Moving `backend/uploads/` to object storage (Azure Blob, S3) should happen
before or with the migration, not after. It is contained: `uploadService`,
`brandingService` and `platformSettingsService` are the only writers.

Related, and already documented in `docs/FREE_DEPLOY.md`: the current free-tier
deployment (Render) has an ephemeral disk, so this is a live limitation today,
not a hypothetical one.

---

## The current zero-cost baseline

Useful as the thing to compare paid options against, since it exists and works:

Vercel (frontend) + Render (backend) + Aiven MySQL, ₹0/month. Trade-offs are
written up in `docs/FREE_DEPLOY.md`: the backend sleeps after 15 minutes idle
(~1 minute cold start), uploads do not survive a restart, and the database is
capped at 1 GB. Fine for UAT and demos; not a production answer.

---

Sources: [AWS Elastic Beanstalk pricing](https://pricingnow.com/question/aws-elastic-beanstalk-pricing/) ·
[Elastic Beanstalk vs Azure App Service](https://www.trustradius.com/compare-products/aws-elastic-beanstalk-vs-azure-app-service) ·
[Azure hosting plans in India](https://cloudminister.com/blog/azure-cloud-hosting-best-plans/) ·
[Node.js hosting providers](https://www.hostinger.com/in/tutorials/best-node-js-hosting/)
