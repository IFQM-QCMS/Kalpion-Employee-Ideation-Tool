/**
 * Support tickets — the channel between a tenant's users and IFQM.
 *
 * Everything lives in ifqm_master (see db/master.sql for why): a platform admin
 * answers tickets without ever opening a customer's database.
 *
 * ── Who can see what ────────────────────────────────────────────────────────
 *   tenant user   their OWN tickets, in their OWN org
 *   tenant admin  every ticket raised in their OWN org
 *   platform      every ticket in every org, plus internal notes
 *
 * Two rules are load-bearing and enforced in SQL, not in the UI:
 *
 *  1. Every tenant read is filtered by tenant_id taken from the caller's own
 *     resolved tenant — never from a parameter. Otherwise ticket #5 belonging to
 *     TVS would be readable by anyone at L&T who guessed the id.
 *  2. is_internal messages are stripped from every tenant-facing read. They are
 *     IFQM's private notes on the account.
 */
import { masterDb } from '../database/master.js';
import { getTenantPool } from '../database/tenant.js';
import { getOrgSettings, sendSmtpEmail } from './mailerService.js';
import { badRequest, forbidden, notFound } from '../utils/respond.js';
import logger from '../utils/logger.js';

const CATEGORIES = ['bug', 'question', 'access', 'feature', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
/*
 * Far enough along to be filed away. Defined once and used by both the
 * single-ticket and the bulk path, because they are the same rule and having
 * written it twice is how they came to disagree.
 */
const ARCHIVABLE_STATUSES = ['resolved', 'closed'];

/*
 * Every status a ticket can hold. ARCHIVABLE_STATUSES above is the subset that
 * may be archived without saying so explicitly; this is the vocabulary the
 * status filter is checked against, so an unrecognised value narrows the match
 * to nothing rather than widening it to everything.
 */
const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

// Statuses a tenant may set themselves. They can withdraw a request or confirm
// it is done; triage (in_progress/waiting/resolved) belongs to IFQM.
const TENANT_SETTABLE = ['closed'];

const isTenantAdmin = (role) => role === 'admin' || role === 'super_admin';
const MAX_SUBJECT = 200;
const MAX_BODY = 8000;

function cleanText(v, max, label) {
  const s = String(v ?? '').trim();
  if (!s) throw badRequest(`${label} is required.`);
  if (s.length > max) throw badRequest(`${label} must be ${max} characters or fewer.`);
  return s;
}

/** TKT-00001. Derived from the row's own id so codes are stable and unique. */
async function assignCode(db, id) {
  const code = `TKT-${String(id).padStart(5, '0')}`;
  await db.execute('UPDATE support_tickets SET ticket_code = ? WHERE id = ?', [code, id]);
  return code;
}

/**
 * Email the person who raised a ticket when IFQM replies to it. The requester
 * is often someone who cannot use the app right now (a broken temporary
 * password is the canonical support ticket), so the answer must reach them
 * outside the app.
 *
 * Mail goes out through the requester's own org's SMTP settings — email config
 * is per-tenant, and this is a message to that tenant's user. Best-effort by
 * design: the reply is already saved, and a missing or broken SMTP config must
 * never turn it into a 500. Callers do not await this.
 */
async function emailRequesterAboutReply(ticket, authorName, replyBody) {
  // Platform-raised tickets have no requester to notify.
  if (!ticket.requester_email) return;
  try {
    const [[tenant] = []] = await masterDb().execute(
      'SELECT * FROM tenants WHERE id = ? LIMIT 1',
      [ticket.tenant_id]
    );
    if (!tenant) return;

    const settings = await getOrgSettings(getTenantPool(tenant));
    if (settings.email_enabled !== '1' || !String(settings.smtp_host || '').trim()) return;

    const html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
      '<body style="font-family:Arial,sans-serif;padding:20px;color:#1e293b">' +
      `<h2 style="color:#4f46e5">IFQM Support — ${escapeHtml(ticket.ticket_code)}</h2>` +
      `<p>Hi ${escapeHtml(ticket.requester_name)},</p>` +
      `<p>${escapeHtml(authorName)} replied to your ticket &ldquo;${escapeHtml(ticket.subject)}&rdquo;:</p>` +
      '<blockquote style="margin:0;padding:12px 16px;background:#f1f5f9;border-left:3px solid #4f46e5;white-space:pre-line">' +
      escapeHtml(replyBody) +
      '</blockquote>' +
      '<p style="color:#64748b;font-size:12px">To respond, open the Support page in IFQM — replies to this email are not received.</p>' +
      '</body></html>';

    await sendSmtpEmail(
      settings,
      ticket.requester_email,
      ticket.requester_name,
      `[${ticket.ticket_code}] ${ticket.subject}`,
      html
    );
  } catch (e) {
    logger.error(`support: reply email for ${ticket.ticket_code} failed`, e.message);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

// ── Tenant side ────────────────────────────────────────────────────

/** POST /api/support/tickets */
export async function createTicket(tenant, user, body) {
  const subject = cleanText(body?.subject, MAX_SUBJECT, 'Subject');
  const message = cleanText(body?.body, MAX_BODY, 'Message');
  const category = CATEGORIES.includes(body?.category) ? body.category : 'question';
  // Priority is a request, not a promise — IFQM re-triages. Still worth taking
  // from the user: "I cannot sign in" and "typo on a label" are not the same.
  const priority = PRIORITIES.includes(body?.priority) ? body.priority : 'normal';

  const db = masterDb();
  const [res] = await db.execute(
    `INSERT INTO support_tickets
       (ticket_code, tenant_id, tenant_slug, requester_user_id, requester_name,
        requester_email, requester_role, raised_by, subject, category, priority, status)
     VALUES ('', ?, ?, ?, ?, ?, ?, 'tenant', ?, ?, ?, 'open')`,
    [tenant.id, tenant.slug, user.id, user.name, user.email ?? null, user.role, subject, category, priority]
  );
  const code = await assignCode(db, res.insertId);

  await db.execute(
    `INSERT INTO support_ticket_messages (ticket_id, author_type, author_name, body, is_internal)
     VALUES (?, 'tenant', ?, ?, 0)`,
    [res.insertId, user.name, message]
  );

  logger.info(`support: ${code} raised by ${user.email} @ ${tenant.slug}`);
  return { success: true, ticket_id: res.insertId, ticket_code: code };
}

/** GET /api/support/tickets — own tickets, or the whole org for an admin. */
export async function listTenantTickets(tenant, user, query = {}) {
  const where = ['t.tenant_id = ?'];
  const params = [tenant.id];

  if (!isTenantAdmin(user.role)) {
    where.push('t.requester_user_id = ?');
    params.push(user.id);
  }
  if (STATUSES.includes(query.status)) {
    where.push('t.status = ?');
    params.push(query.status);
  }

  const [rows] = await masterDb().execute(
    `SELECT t.id, t.ticket_code, t.subject, t.category, t.priority, t.status,
            t.requester_name, t.raised_by, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM support_ticket_messages m
              WHERE m.ticket_id = t.id AND m.is_internal = 0) AS message_count
       FROM support_tickets t
      WHERE ${where.join(' AND ')}
      ORDER BY FIELD(t.status,'open','in_progress','waiting','resolved','closed'), t.updated_at DESC`,
    params
  );
  return { success: true, tickets: rows };
}

/** Fetch a ticket the caller is allowed to see, or throw. */
async function tenantTicketOr403(tenant, user, id) {
  const [rows] = await masterDb().execute(
    'SELECT * FROM support_tickets WHERE id = ? AND tenant_id = ? LIMIT 1',
    [Number(id) || 0, tenant.id]
  );
  const ticket = rows[0];
  // Same answer for "not yours" and "does not exist" — a different 404 would
  // confirm that ticket #5 exists in some other organisation.
  if (!ticket) throw notFound('Ticket not found.');
  if (!isTenantAdmin(user.role) && ticket.requester_user_id !== user.id) {
    throw notFound('Ticket not found.');
  }
  return ticket;
}

/** GET /api/support/tickets/:id — thread, internal notes stripped. */
export async function getTenantTicket(tenant, user, id) {
  const ticket = await tenantTicketOr403(tenant, user, id);
  const [messages] = await masterDb().execute(
    `SELECT id, author_type, author_name, body, created_at
       FROM support_ticket_messages
      WHERE ticket_id = ? AND is_internal = 0
      ORDER BY created_at ASC`,
    [ticket.id]
  );
  return { success: true, ticket, messages };
}

/** POST /api/support/tickets/:id/messages */
export async function replyAsTenant(tenant, user, id, body) {
  const ticket = await tenantTicketOr403(tenant, user, id);
  if (ticket.status === 'closed') throw badRequest('This ticket is closed. Raise a new one.');
  const message = cleanText(body?.body, MAX_BODY, 'Message');

  const db = masterDb();
  await db.execute(
    `INSERT INTO support_ticket_messages (ticket_id, author_type, author_name, body, is_internal)
     VALUES (?, 'tenant', ?, ?, 0)`,
    [ticket.id, user.name, message]
  );
  // A customer reply on a resolved ticket means it was not resolved.
  const nextStatus = ticket.status === 'resolved' ? 'open' : ticket.status;
  await db.execute(
    'UPDATE support_tickets SET status = ?, updated_at = NOW() WHERE id = ?',
    [nextStatus, ticket.id]
  );
  return { success: true, status: nextStatus };
}

/** PATCH /api/support/tickets/:id — a tenant may only close. */
export async function updateTenantTicket(tenant, user, id, body) {
  const ticket = await tenantTicketOr403(tenant, user, id);
  const status = String(body?.status ?? '');
  if (!TENANT_SETTABLE.includes(status)) {
    throw forbidden('You can only close your own ticket.');
  }
  await masterDb().execute(
    'UPDATE support_tickets SET status = ?, updated_at = NOW() WHERE id = ?',
    [status, ticket.id]
  );
  return { success: true, status };
}

// ── Platform side ──────────────────────────────────────────────────

/** GET /api/platform/tickets — the whole queue, across every tenant. */
export async function listPlatformTickets(query = {}) {
  const where = [];
  const params = [];

  /*
   * MOM §12.3 — archived tickets are hidden unless asked for. Archiving is not
   * the same as closing: closing is the outcome of the conversation, archiving
   * is the operator saying "stop showing me this". A closed ticket still belongs
   * in the recent list; an archived one does not.
   */
  if (String(query.archived) === '1') where.push('t.archived_at IS NOT NULL');
  else if (String(query.archived) !== 'all') where.push('t.archived_at IS NULL');

  if (STATUSES.includes(query.status)) { where.push('t.status = ?'); params.push(query.status); }
  if (PRIORITIES.includes(query.priority)) { where.push('t.priority = ?'); params.push(query.priority); }
  if (query.tenant_id) { where.push('t.tenant_id = ?'); params.push(Number(query.tenant_id)); }
  if (query.q) {
    where.push('(t.subject LIKE ? OR t.ticket_code LIKE ? OR t.requester_name LIKE ?)');
    const like = `%${String(query.q).slice(0, 80)}%`;
    params.push(like, like, like);
  }

  const [rows] = await masterDb().execute(
    `SELECT t.*, a.name AS assignee_name,
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
       LEFT JOIN platform_admins a ON a.id = t.assignee_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY FIELD(t.status,'open','in_progress','waiting','resolved','closed'),
               FIELD(t.priority,'urgent','high','normal','low'), t.updated_at DESC`,
    params
  );

  const [[counts]] = await masterDb().query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'open') AS open_count,
            SUM(status = 'in_progress') AS in_progress_count,
            SUM(priority = 'urgent' AND status NOT IN ('resolved','closed')) AS urgent_count,
            SUM(archived_at IS NOT NULL) AS archived_count
       FROM support_tickets`
  );

  return {
    success: true,
    tickets: rows,
    counts: {
      total: Number(counts.total) || 0,
      open: Number(counts.open_count) || 0,
      in_progress: Number(counts.in_progress_count) || 0,
      urgent: Number(counts.urgent_count) || 0,
      archived: Number(counts.archived_count) || 0,
    },
  };
}

/** GET /api/platform/tickets/:id — full thread including internal notes. */
export async function getPlatformTicket(id) {
  const [rows] = await masterDb().execute(
    `SELECT t.*, a.name AS assignee_name FROM support_tickets t
       LEFT JOIN platform_admins a ON a.id = t.assignee_id
      WHERE t.id = ? LIMIT 1`,
    [Number(id) || 0]
  );
  const ticket = rows[0];
  if (!ticket) throw notFound('Ticket not found.');

  const [messages] = await masterDb().execute(
    `SELECT id, author_type, author_name, body, is_internal, created_at
       FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
    [ticket.id]
  );
  return { success: true, ticket, messages };
}

/** POST /api/platform/tickets/:id/messages — reply, or leave an internal note. */
export async function replyAsPlatform(admin, id, body) {
  const [rows] = await masterDb().execute('SELECT * FROM support_tickets WHERE id = ? LIMIT 1', [Number(id) || 0]);
  const ticket = rows[0];
  if (!ticket) throw notFound('Ticket not found.');

  const message = cleanText(body?.body, MAX_BODY, 'Message');
  const isInternal = body?.is_internal === true;

  const db = masterDb();
  await db.execute(
    `INSERT INTO support_ticket_messages (ticket_id, author_type, author_name, body, is_internal)
     VALUES (?, 'platform', ?, ?, ?)`,
    [ticket.id, admin.name, message, isInternal ? 1 : 0]
  );

  // An internal note is not an answer, so it must not move the ticket on and
  // make it look like the customer was replied to.
  if (!isInternal && ticket.status === 'open') {
    await db.execute("UPDATE support_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = ?", [ticket.id]);
  } else {
    await db.execute('UPDATE support_tickets SET updated_at = NOW() WHERE id = ?', [ticket.id]);
  }

  // Internal notes are IFQM's private record — the customer must not be told
  // one was written, let alone shown its contents.
  if (!isInternal) void emailRequesterAboutReply(ticket, admin.name, message);

  return { success: true, is_internal: isInternal };
}

/** PATCH /api/platform/tickets/:id — status, priority, assignment. */
export async function updatePlatformTicket(id, body) {
  const [rows] = await masterDb().execute('SELECT * FROM support_tickets WHERE id = ? LIMIT 1', [Number(id) || 0]);
  const ticket = rows[0];
  if (!ticket) throw notFound('Ticket not found.');

  const updates = [];
  const params = [];

  if (body?.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw badRequest('Invalid status.');
    updates.push('status = ?');
    params.push(body.status);
    updates.push('resolved_at = ?');
    params.push(['resolved', 'closed'].includes(body.status) ? new Date() : null);
  }
  if (body?.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) throw badRequest('Invalid priority.');
    updates.push('priority = ?');
    params.push(body.priority);
  }
  if (body?.assignee_id !== undefined) {
    const assignee = body.assignee_id === null ? null : Number(body.assignee_id);
    if (assignee !== null) {
      const [[found] = []] = await masterDb().execute('SELECT id FROM platform_admins WHERE id = ? LIMIT 1', [assignee]);
      if (!found) throw badRequest('Unknown platform admin.');
    }
    updates.push('assignee_id = ?');
    params.push(assignee);
  }

  /*
   * MOM §12.3. Reversible on purpose — an archive that cannot be undone is a
   * delete with a friendlier name.
   *
   * Archiving one ticket is held to the same rule as archiving fifty: only a
   * ticket that has been resolved or closed may go. The bulk endpoint has
   * enforced that since it was written; this path did not, so the rule could be
   * walked around simply by doing it one at a time — and a still-open ticket
   * archived by accident is a customer waiting for an answer that is now
   * invisible to everybody.
   *
   * Restoring is never restricted. Getting something back must always be easier
   * than losing it.
   */
  if (body?.archived !== undefined) {
    const archiving = !!body.archived;
    if (archiving && !ARCHIVABLE_STATUSES.includes(ticket.status)) {
      throw badRequest(
        `This ticket is still ${ticket.status.replace('_', ' ')}. `
        + 'Resolve or close it before archiving, so nobody is left waiting on an answer '
        + 'that has been filed away.'
      );
    }
    updates.push('archived_at = ?');
    params.push(archiving ? new Date() : null);
  }

  if (!updates.length) throw badRequest('Nothing to update.');
  params.push(ticket.id);
  await masterDb().execute(`UPDATE support_tickets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  return { success: true };
}

/**
 * Archive a whole batch of tickets in one go.
 *
 * The screen already had a filter, but filtering only changes what you are
 * looking at - the tickets stay in the queue for everybody else. Clearing out
 * last year's closed tickets one at a time was the actual complaint.
 *
 * Choose them three ways, combined with AND if more than one is given: an
 * explicit list of ids, everything last touched before a date, or everything in
 * a named set of statuses.
 *
 * Open tickets are left alone unless `include_open` is set or the caller named
 * the statuses outright, because archiving something nobody has answered yet is
 * how a customer gets forgotten.
 */
export async function bulkArchiveTickets(body = {}) {
  const archive = !(body.archived === false || body.archived === 0 || body.archived === '0');
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map((n) => Number(n)).filter((n) => n > 0))].slice(0, 2000)
    : [];
  const beforeDate = String(body.before_date ?? '').trim();
  const includeOpen = body.include_open === true || body.include_open === '1';

  /*
   * Archive by status.
   *
   * The date and the explicit list both answer "which tickets", and neither
   * answers the question actually asked at the end of a quarter: clear out
   * everything that is resolved. Doing that through the date option means
   * picking a date that happens to separate them, which is a guess.
   *
   * Whitelisted rather than passed through, because this string reaches a WHERE
   * clause; an unknown status is dropped rather than widening the match.
   */
  const statuses = (Array.isArray(body.statuses) ? body.statuses : [])
    .map((v) => String(v).trim().toLowerCase())
    .filter((v) => TICKET_STATUSES.includes(v));

  if (!ids.length && !beforeDate && !statuses.length) {
    throw badRequest('Choose the tickets to archive, a status, or a date to archive before.');
  }
  if (beforeDate && !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    throw badRequest('before_date must be in YYYY-MM-DD form.');
  }

  const where = [];
  const params = [];
  if (ids.length) {
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (beforeDate) {
    where.push('updated_at < ?');
    params.push(`${beforeDate} 00:00:00`);
  }
  if (statuses.length) {
    where.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  /*
   * The open-ticket guard, and the two cases it does not apply to.
   *
   * It exists because archiving something nobody has answered is how a customer
   * gets forgotten. That reasoning is entirely about archiving:
   *
   *  - `archive === false` is RESTORING, and restoring must never be harder
   *    than losing something. Left in, this clause silently refused to bring
   *    back an open ticket that had been archived — the ticket would sit in the
   *    archive with no way out of it short of resolving it first, which is
   *    precisely backwards.
   *  - Naming the statuses outright is an explicit instruction. Dropping those
   *    rows anyway would report a number that does not match what was asked
   *    for, which is worse than refusing.
   */
  if (archive && !includeOpen && !statuses.length) {
    where.push(`status IN (${ARCHIVABLE_STATUSES.map(() => '?').join(',')})`);
    params.push(...ARCHIVABLE_STATUSES);
  }
  where.push(archive ? 'archived_at IS NULL' : 'archived_at IS NOT NULL');

  const [res] = await masterDb().execute(
    `UPDATE support_tickets SET archived_at = ${archive ? 'NOW()' : 'NULL'}, updated_at = NOW()
      WHERE ${where.join(' AND ')}`,
    params
  );
  const n = res.affectedRows || 0;
  return {
    success: true,
    affected: n,
    archived: archive,
    message: n
      ? `${n} ticket(s) ${archive ? 'archived' : 'restored'}.`
      : 'Nothing to change.',
  };
}

/**
 * POST /api/platform/tickets — IFQM opens a ticket against a tenant (outreach,
 * maintenance notice, following up an incident). It lands in that org's list.
 */
export async function createPlatformTicket(admin, body) {
  const subject = cleanText(body?.subject, MAX_SUBJECT, 'Subject');
  const message = cleanText(body?.body, MAX_BODY, 'Message');
  const tenantId = Number(body?.tenant_id) || 0;
  if (!tenantId) throw badRequest('Choose an organisation.');

  const db = masterDb();
  const [[tenant] = []] = await db.execute('SELECT id, slug FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
  if (!tenant) throw notFound('Tenant not found.');

  const priority = PRIORITIES.includes(body?.priority) ? body.priority : 'normal';
  const [res] = await db.execute(
    `INSERT INTO support_tickets
       (ticket_code, tenant_id, tenant_slug, requester_user_id, requester_name,
        requester_email, requester_role, raised_by, subject, category, priority, status)
     VALUES ('', ?, ?, NULL, ?, NULL, 'platform_admin', 'platform', ?, 'other', ?, 'open')`,
    [tenant.id, tenant.slug, admin.name, subject, priority]
  );
  const code = await assignCode(db, res.insertId);
  await db.execute(
    `INSERT INTO support_ticket_messages (ticket_id, author_type, author_name, body, is_internal)
     VALUES (?, 'platform', ?, ?, 0)`,
    [res.insertId, admin.name, message]
  );
  logger.info(`support: ${code} raised by IFQM (${admin.name}) → ${tenant.slug}`);
  return { success: true, ticket_id: res.insertId, ticket_code: code };
}

export default {
  createTicket, listTenantTickets, getTenantTicket, replyAsTenant, updateTenantTicket,
  listPlatformTickets, getPlatformTicket, replyAsPlatform, updatePlatformTicket, createPlatformTicket,
};
