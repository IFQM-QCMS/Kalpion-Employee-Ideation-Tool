import axios from 'axios';

const getBaseURL = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    if (window.location.port !== '4000' && window.location.port !== '5173') {
      return 'http://localhost:4000/api';
    }
  }
  return '/api';
};

const api = axios.create({
  baseURL: getBaseURL(),
});

// Attach JWT token from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ifqm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const org = localStorage.getItem('ifqm_org');
  if (org && !config.params?.org_slug) {
    config.params = { ...config.params, org_slug: org };
  }

  // Belt and braces for multipart: make sure nothing has pinned a Content-Type on a FormData
  // body, so the browser is free to set `multipart/form-data; boundary=...` itself. axios v1
  // stores headers in an AxiosHeaders object, where a bare `delete headers['Content-Type']`
  // does not reliably remove a value inherited from the instance defaults - use its own API
  // when it is available.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (typeof config.headers?.delete === 'function') {
      config.headers.delete('Content-Type');
    } else {
      delete config.headers['Content-Type'];
      delete config.headers['content-type'];
    }
  }
  return config;
});

// Attach org_slug to non-GET requests via the request body.
api.interceptors.request.use((config) => {
  if (['post','put','patch','delete'].includes(config.method)) {
    const org = localStorage.getItem('ifqm_org');

    // A FormData body must be left completely alone.
    const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData;

    if (org && !isFormData && config.data && typeof config.data === 'object' && !config.data.org_slug) {
      config.data = { ...config.data, org_slug: org };
    }
  }
  return config;
});

// A 401 now means the session is genuinely gone: expired, or revoked server-side because
// the account was deactivated, its role changed, or its password was reset.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // A 401 means "your session went away" ONLY if there was a session.
    const hadSession = !!localStorage.getItem('ifqm_token');
    if (err.response?.status === 401 && hadSession && !isPublicEndpoint(err.config?.url)) {
      localStorage.removeItem('ifqm_token');
      localStorage.removeItem('ifqm_org');
      if (!window.location.pathname.startsWith('/login') && window.location.pathname !== '/') {
        window.location.replace('/');
      }
    }
    return Promise.reject(err);
  }
);

// Endpoints whose 401 is an answer, not an expiry - they must surface as a form error
// rather than a redirect, even for somebody who happens to be signed in.
function isPublicEndpoint(url = '') {
  return [
    '/auth/login', '/auth/reset-password', '/auth/forgot-password',
    '/auth/otp/', '/auth/password-reset/', '/auth/check-reset-token',
    '/registrations/',
  ].some((p) => url.includes(p));
}

export default api;

// Auth
/** The browser's IANA time zone, e.g. "Asia/Kolkata". Empty on very old ones. */
function clientTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
  catch { return ''; }
}

export const authApi = {
  // The browser's own time zone travels with the sign-in request itself, in the body, so the
  // platform console can say roughly where a staff sign-in came from without anybody's
  // address being sent to a geolocation service.
  login: (data) => api.post('/auth/login', { ...data, client_timezone: clientTimezone() }),
  // Platform admin account verification.
  platformVerifyStatus: () => api.get('/auth/platform/verify/status'),
  platformVerifySend: (data) => api.post('/auth/platform/verify/send', data),
  platformVerifyConfirm: (data) => api.post('/auth/platform/verify/confirm', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  forgotPassword: (data) => api.post('/auth/forgot-password', data),
  resetPassword: (data) => api.post('/auth/reset-password', data),
  // Public. Asked by the sign-in screen before anyone has a session, so it can explain why
  // sign-in is refused instead of showing a bare error.
  maintenance: () => api.get('/auth/maintenance'),
  // Signed-in change; also the way out of the forced change a bulk-imported employee faces
  // on first login.
  changePassword: (data) => api.post('/auth/change-password', data),
  // MOM §4.1 / §4.2 - sign in with a one-time code sent by SMS.
  otpStatus: () => api.get('/auth/otp/status'),
  otpRequest: (identifier, purpose = 'login') => api.post('/auth/otp/request', { identifier, purpose }),
  otpVerify: (identifier, code) => api.post('/auth/otp/verify', { identifier, code }),
  // Reset by code - for somebody who cannot reach the mailbox a link would go to.
  // `identifier` is an email address or a mobile number; the server works out which and
  // sends by the matching channel.
  resetCodeRequest: (identifier) => api.post('/auth/password-reset/request-code', { identifier }),
  resetCodeVerify: (identifier, code) => api.post('/auth/password-reset/verify-code', { identifier, code }),
};

// Ideas
export const ideasApi = {
  dashboard: () => api.get('/ideas/dashboard'),
  my: () => api.get('/ideas/my'),
  list: (params) => api.get('/ideas', { params }),
  get: (id) => api.get(`/ideas/${id}`),
  saveDraft: (data) => api.post('/ideas/draft', data),
  submit: (data) => api.post('/ideas/submit', data),
  reviewAction: (data) => api.post('/ideas/review-action', data),
  bulkReview: (data) => api.post('/ideas/bulk-review', data),
  // The person-raised "this might be worth a patent" tick.
  setPatentableFlag: (idea_id, patentable) =>
    api.post('/ideas/patentable-flag', { idea_id, patentable }),
  bulkArchive: (data) => api.post('/ideas/bulk-archive', data),
  reviewerDecision: (data) => api.post('/ideas/reviewer-decision', data),
  assignReviewers: (data) => api.post('/ideas/assign-reviewers', data),
  checkDuplicate: (params) => api.get('/ideas/check-duplicate', { params }),
  reviewQueue: () => api.get('/ideas/review'),
  // These are '/ideas/roi' and '/ideas/implementation' - NOT '/ideas/update-*'.
  updateRoi: (data) => api.post('/ideas/roi', data),
  updateImplementation: (data) => api.post('/ideas/implementation', data),
};

// Votes
export const votesApi = {
  castVote: (data) => api.post('/votes/rate', data),
  stats: (params) => api.get('/votes/stats', { params }),
  communityStats: (params) => api.get('/votes/community-stats', { params }),
  upvote: (data) => api.post('/votes/upvote', data),
  downvote: (data) => api.post('/votes/downvote', data),
  pollAll: () => api.get('/votes/poll-all'),
  communityVote: (data) => api.post('/votes/community', data),
  board: (params) => api.get('/votes/board', { params }),
};

// Leaderboard
export const leaderboardApi = {
  get: (params) => api.get('/leaderboard', { params }),
};

// Notifications
export const notifApi = {
  list: () => api.get('/notifications'),
  // No argument means "mark every one read", including any beyond the page the panel is
  // showing. Passing ids marks exactly those.
  markRead: (ids) => api.post('/notifications/mark-read', Array.isArray(ids) ? { ids } : {}),
};

// Users
export const usersApi = {
  // Changing your own mobile number, verified by a code to the NEW number - it is where
  // sign-in codes and password resets go, so it is not a field anybody should be able to
  // change unchallenged.
  requestPhoneCode: (phone) => api.post('/users/me/phone/request-code', { phone }),
  confirmPhoneChange: (phone, code) => api.post('/users/me/phone/confirm', { phone, code }),
  // §13.8 - a user's full reporting line, in one call.
  chain: (id) => api.get(`/users/${id}/chain`),
  list: (params) => api.get('/users', { params }),
  analytics: () => api.get('/reports/analytics'),
  audit: () => api.get('/reports/audit'),
  hierarchy: () => api.get('/users/hierarchy'),
  // Paginated + server-side search: a tenant can now hold 10,000 employees, so the console
  // can no longer pull the whole table down at once.
  adminList: (params) => api.get('/users/admin', { params }),
  managers: () => api.get('/users/managers'),
  createUser: (data) => api.post('/users', data),
  updateUser: (data) => api.put(`/users/${data.id}`, data),
  // Hierarchy screen: change only who a user reports to (escalation chain edge).
  updateManager: (id, managerId) => api.put(`/users/${id}/manager`, { manager_id: managerId }),
  deleteUser: (id) => api.delete(`/users/${id}`),
  profile: () => api.get('/users/profile'),
  // Saves only the descriptive fields; the server ignores anything else it is sent, so role,
  // points and reporting line cannot be set from here.
  updateProfile: (data) => api.post('/users/profile', data),
};

// Bulk employee import (org admin)
export const userImportApi = {
  downloadTemplate: async () => {
    const res = await api.get('/users/import/template', { responseType: 'blob' });
    saveBlob(res.data, 'ifqm-employee-import-template.xlsx');
  },
  // Dry run: validates and reports, writes nothing.
  preview: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/users/import/preview', fd);
  },
  // Real run. Returns 202 + a job id; the accounts are created in the background.
  start: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/users/import', fd);
  },
  job: (id) => api.get(`/users/import/${id}`),
  downloadErrors: async (id) => {
    const res = await api.get(`/users/import/${id}/errors.csv`, { responseType: 'blob' });
    saveBlob(res.data, `import-${id}-errors.csv`);
  },
};

// AI Score
export const scoreApi = {
  batchRescore: () => api.post('/score/batch-rescore'),
};

// Settings
export const settingsApi = {
  // The organisation's own billing page.
  billing: () => api.get('/settings/billing'),
  payStart: (data) => api.post('/settings/billing/pay', data),
  payVerify: (data) => api.post('/settings/billing/verify', data),
  // Where this organisation's own account stands: plan, dates, days left.
  subscription: () => api.get('/settings/subscription'),
  get: () => api.get('/settings'),
  update: (data) => api.post('/settings', data),
  testEmail: () => api.get('/settings/test-email'),
};

// QCMS integration (org admin only) Approved ideas are pushed to the QCMS tool.
export const integrationApi = {
  approvedIdeas: () => api.get('/integrations/approved-ideas'),
  getConfig: () => api.get('/integrations/qcms'),
  saveConfig: (data) => api.put('/integrations/qcms', data),
  // body: { idea_ids?: number[], only_pending?: boolean }
  push: (data) => api.post('/integrations/push', data || {}),
};

// Challenges
export const challengesApi = {
  list: () => api.get('/challenges'),
  create: (data) => api.post('/challenges', data),
  update: (data) => api.put(`/challenges/${data.id}`, data),
  delete: (id) => api.delete(`/challenges/${id}`),
};

// Idea categories (per-organisation) `list` is readable by every signed-in user - it is
// what the submission wizard renders its category chips from.
export const categoriesApi = {
  list: () => api.get('/categories'),
  create: (name) => api.post('/categories', { name }),
  delete: (id) => api.delete(`/categories/${id}`),
};

// Export These used to build URLs with the JWT in the query string (`?token=<jwt>`), which
// leaks the credential into browser history, proxy and server access logs, and the Referer
// header of any outbound link.
async function downloadBlob(path, filename) {
  const res = await api.get(path, { responseType: 'blob' });
  saveBlob(res.data, filename);
}

// Rewards & Recognition.
const rrQuery = (o = {}) => {
  const q = new URLSearchParams();
  if (o.period) q.set('period', o.period);
  if (o.offset != null) q.set('offset', String(o.offset));
  if (o.from) q.set('from', o.from);
  if (o.to) q.set('to', o.to);
  if (o.include_all) q.set('include_all', '1');
  return q.toString();
};

export const rewardsApi = {
  leaderboard: (o) => api.get(`/rewards/leaderboard?${rrQuery(o)}`),
  excel: (o, name) => downloadBlob(`/rewards/export.xlsx?${rrQuery(o)}`, name),
  pdf: (o, name) => downloadBlob(`/rewards/export.pdf?${rrQuery(o)}`, name),
};

export const exportApi = {
  // The product manual. Authenticated, so it cannot be a plain <a href> - it goes through
  // the same blob download as every other export here.
  userGuide: () => downloadBlob('/export/user-guide', 'Kalpion-User-Guide.pdf'),
  ideasCsv: () => downloadBlob('/export/ideas', 'ideas.csv'),
  leaderboardCsv: () => downloadBlob('/export/leaderboard', 'leaderboard.csv'),
  // The leaderboard as a filable document.
  leaderboardPdf: (period = 'all') =>
    downloadBlob(`/export/leaderboard-pdf?period=${encodeURIComponent(period)}`,
      `leaderboard_${period}.pdf`),
  // Server-side send, with the PDF attached. Restricted to the roles that may already export
  // organisation-wide reports.
  sendLeaderboard: (body) => api.post('/export/leaderboard/send', body),
  analyticsHtml: () => downloadBlob('/export/analytics', 'analytics.html'),
  // Single idea pre-formatted Closure Summary PDF (reviewer/hierarchy only, enforced
  // server-side). Downloads a fresh PDF each time.
  ideaPdf: (id, code) => downloadBlob(`/export/idea/${id}/pdf`, `idea_${code || id}_closure_summary.pdf`),
};

/** Trigger a browser "save as" for an in-memory blob. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has definitely been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Upload
export const uploadApi = {
  // Same fix as the import: no hand-written Content-Type, or the multipart boundary is lost
  // and the server sees a file-less request.
  upload: (formData) => api.post('/upload', formData),
  delete: (id) => api.delete(`/upload/${id}`),

  // Attachments are no longer public files on disk - they are fetched through an
  // authenticated, tenant-scoped endpoint. <img src> and <a href> cannot carry an
  // Authorization header, so we pull the bytes and hand back an object URL rather than
  // putting a credential in the URL.
  fetchBlob: (id) => api.get(`/upload/${id}/download`, { responseType: 'blob' }).then((r) => r.data),
  download: async (id, filename) => {
    const blob = await uploadApi.fetchBlob(id);
    saveBlob(blob, filename);
  },
};

// Branding (per-tenant org name + logo) `get` is readable by every user in the tenant - it
// is what their sidebar renders.
export const brandingApi = {
  get: () => api.get('/branding'),
  updateName: (org_name) => api.put('/branding', { org_name }),
  // No hand-written Content-Type - see the FormData note on uploadApi.
  updateLogo: (formData) => api.post('/branding/logo', formData),
  removeLogo: () => api.delete('/branding/logo'),
};

// Platform (platform admin only) Support tickets (tenant side) Any signed-in user may
// raise one and follow their own; a tenant admin sees every ticket raised in their org.
export const supportApi = {
  list: (params) => api.get('/support/tickets', { params }),
  create: (data) => api.post('/support/tickets', data),
  get: (id) => api.get(`/support/tickets/${id}`),
  reply: (id, body) => api.post(`/support/tickets/${id}/messages`, { body }),
  close: (id) => api.patch(`/support/tickets/${id}`, { status: 'closed' }),
};

// tenantHierarchy is gone deliberately: it returned the tenant's full org chart (employee
// names, managers, per-person idea counts) to IFQM staff. tenantDetail now returns
// aggregates only - counts, role spread, and the org's admin contacts.
// MSME self-registration. `submit` and `checkEmail` are the only calls in this file that
// work without a token - they are what an unauthenticated visitor on /signup uses.
export const registrationsApi = {
  submit: (data) => api.post('/registrations', data),
  checkEmail: (email) => api.get('/registrations/check-email', { params: { email } }),
  sendOtp: (email) => api.post('/registrations/send-otp', { email }),
  verifyOtp: (email, code) => api.post('/registrations/verify-otp', { email, code }),
  // The mobile leg. Both must be verified before an application is accepted - the server
  // checks it too, from the consumed code rows.
  sendPhoneOtp: (phone) => api.post('/registrations/send-phone-otp', { phone }),
  verifyPhoneOtp: (phone, code) => api.post('/registrations/verify-phone-otp', { phone, code }),
  // Which channels can actually carry a code, so the form does not offer a button that
  // cannot work.
  channels: () => api.get('/registrations/channels'),
};

// MOM §13.2 / §13.10 - org-admin decisions on an idea.
export const ideaAdminApi = {
  setArchived: (idea_id, archived, note = '') => api.post('/ideas/archive', { idea_id, archived, note }),
  setPatentability: (idea_id, patentability, patentability_note = '') =>
    api.post('/ideas/patentability', { idea_id, patentability, patentability_note }),
  // Archive a whole selection, or everything before a date, in one request.
  bulkArchive: (data) => api.post('/ideas/bulk-archive', data),
};

export const platformApi = {
  tenants: () => api.get('/platform/tenants'),
  registrations: (status = '') => api.get('/platform/registrations', { params: { status } }),
  // Exceptions to the corporate-email rule: one address, or a whole personal mailbox
  // provider, allowed to apply.
  emailWhitelist:       ()     => api.get('/platform/registrations/whitelist'),
  emailWhitelistAdd:    (data) => api.post('/platform/registrations/whitelist', data),
  emailWhitelistRemove: (id)   => api.delete(`/platform/registrations/whitelist/${id}`),
  // §12.12 - sign-in activity feed.
  activity: (params = {}) => api.get('/platform/activity', { params }),
  // The plan and trial length are chosen at the moment of approval, when the company's size
  // and turnover are in front of the approver.
  approveRegistration: (id, data) => api.post(`/platform/registrations/${id}/approve`,
    typeof data === 'string' ? { slug: data } : data),
  rejectRegistration: (id, note) => api.post(`/platform/registrations/${id}/reject`, { note }),
  tenantDetail: (id) => api.get(`/platform/tenants/${id}`),
  createTenant: (data) => api.post('/platform/tenants', data),
  updateTenant: (id, data) => api.patch(`/platform/tenants/${id}`, data),
  resetTenantAdminPassword: (id, admin_email) =>
    api.post(`/platform/tenants/${id}/reset-admin-password`, { admin_email }),
  // confirm_slug must echo the org code; drop_database is opt-in.
  deleteTenant: (id, data) => api.delete(`/platform/tenants/${id}`, { data }),

  // Maintenance mode - the whole platform on hold. Staff-only, and reachable while it is ON,
  // which is what makes it possible to turn back off.
  getMaintenance: () => api.get('/platform/maintenance'),
  setMaintenance: (data) => api.put('/platform/maintenance', data),

  // Settings. Note there is no smtp_pass on the way in or out: the server never returns it
  // (only smtp_pass_set), and only writes it when a non-empty value is sent - so an
  // untouched field can never wipe a tenant's mail password.
  getDefaults: () => api.get('/platform/settings/defaults'),
  updateDefaults: (data) => api.put('/platform/settings/defaults', data),
  tenantSettings: (id) => api.get(`/platform/tenants/${id}/settings`),
  updateTenantSettings: (id, data) => api.put(`/platform/tenants/${id}/settings`, data),

  bulkArchiveTickets: (data) => api.post('/platform/tickets/bulk-archive', data),

  // Messaging: the SMS/DLT connector, code policy, and email health Same contract as
  // smtp_pass above and for the same reason: the gateway API key never comes back (only
  // api_key_set), and an empty field on the way in means "keep the stored one" rather than
  // "erase it".
  messaging: () => api.get('/platform/messaging'),
  updateMessaging: (data) => api.put('/platform/messaging', data),
  // A real send to a real handset - see messagingService for why a dry check would not prove
  // anything worth knowing.
  testSms: (data) => api.post('/platform/messaging/test', data),
  testMail: (data) => api.post('/platform/messaging/test-mail', data),

  // Billing The plan catalogue, and what each organisation is on.
  plans: (params = {}) => api.get('/platform/plans', { params }),
  plan: (id) => api.get(`/platform/plans/${id}`),
  createPlan: (data) => api.post('/platform/plans', data),
  updatePlan: (id, data) => api.patch(`/platform/plans/${id}`, data),
  // Retires rather than deletes: organisations point at plans, and their history refers to
  // them.
  retirePlan: (id) => api.delete(`/platform/plans/${id}`),

  // Every organisation's billing state in one request.
  billingOverview: (params = {}) => api.get('/platform/billing/overview', { params }),
  // The Razorpay merchant account. Same secret contract as everywhere else: key_secret never
  // comes back, and an empty field means "keep it".
  gateway: () => api.get('/platform/billing/gateway'),
  updateGateway: (data) => api.put('/platform/billing/gateway', data),
  testGateway: () => api.post('/platform/billing/gateway/test'),
  subscription: (tenantId) => api.get(`/platform/tenants/${tenantId}/subscription`),
  assignPlan: (tenantId, data) => api.post(`/platform/tenants/${tenantId}/plan`, data),
  setTrial: (tenantId, data) => api.post(`/platform/tenants/${tenantId}/trial`, data),
  markPaid: (tenantId, data) => api.post(`/platform/tenants/${tenantId}/mark-paid`, data),
  // dry_run reports who would be held without changing anything.
  sweepBilling: (dryRun = false) =>
    api.post('/platform/billing/sweep', null, { params: dryRun ? { dry_run: 1 } : {} }),
  sendMonthlyInvoices: () => api.post('/platform/billing/send-invoices'),

  admins: () => api.get('/platform/admins'),
  createAdmin: (data) => api.post('/platform/admins', data),
  deleteAdmin: (id) => api.delete(`/platform/admins/${id}`),
  changeOwnPassword: (data) => api.post('/platform/admins/change-password', data),
  // Moving a platform admin's number.
  requestOwnPhoneChange: (data) => api.post('/platform/admins/me/phone/request-code', data),
  confirmOwnPhoneChange: (data) => api.post('/platform/admins/me/phone/confirm', data),
  // Correcting somebody else's, for an account created with a mistyped number.
  updateAdminPhone: (id, data) => api.put(`/platform/admins/${id}/phone`, data),

  health: () => api.get('/platform/health'),

  // Support queue - every tenant's tickets, plus IFQM-only internal notes.
  tickets: (params) => api.get('/platform/tickets', { params }),
  ticket: (id) => api.get(`/platform/tickets/${id}`),
  ticketReply: (id, body, is_internal = false) =>
    api.post(`/platform/tickets/${id}/messages`, { body, is_internal }),
  ticketUpdate: (id, data) => api.patch(`/platform/tickets/${id}`, data),
  ticketCreate: (data) => api.post('/platform/tickets', data),
};
