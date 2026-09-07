/** The DLT-registered SMS templates, as approved by Jio for header IFQMID-T. */

// Registered on 26 Aug 2026.
export const DLT_TEMPLATES = {
  // 1. Registration OTP
  registration_phone: {
    id: '1277178671564743852',
    text: 'Dear Customer, use OTP {#var#} to complete your registration on IFQM Ideation. Do not share this OTP with anyone.',
    registered: true,
    label: 'Registration OTP',
  },

  // 2. Sign-in OTP
  login: {
    id: '1277178730169418603',
    text: 'Dear Customer, use OTP {#var#} to complete your sign-in on IFQM Ideation. Do not share this OTP with anyone.',
    registered: true,
    label: 'Sign-in OTP',
  },

  // 3. Password Reset OTP
  password_reset: {
    id: '1277178730612100625',
    text: 'Dear Customer, use OTP {#var#} to reset your password on IFQM Ideation. Do not share this OTP with anyone.',
    registered: true,
    label: 'Password Reset OTP',
  },

  // 4. Mobile Number Changed - security alert.
  phone_changed: {
    id: '1277178823569994190',
    text: 'Your IFQM Ideation sign-in number was changed to one ending {#var#}. If this was not you, contact your administrator.',
    registered: true,
    label: 'Mobile Number Changed - Security Alert',
  },

  // 5. Number Change OTP - verifying a NEW number on an existing account.
  phone_verify: {
    id: '',
    text: 'Dear Customer, use OTP {#var#} to confirm your new mobile number on IFQM Ideation. Do not share this OTP with anyone.',
    registered: false,
    fallback: 'registration_phone',
    label: 'Number Change OTP',
    pendingReason: 'Submitted to Jio DLT; awaiting a template id.',
  },

  // 6. Platform admin account verification.
  platform_admin_phone: {
    id: '',
    text: 'Dear Customer, use OTP {#var#} to verify your mobile number for IFQM platform administrator access. Do not share this OTP with anyone.',
    registered: false,
    fallback: 'registration_phone',
    label: 'Platform Admin Verification OTP',
    pendingReason: 'Not yet submitted to Jio DLT; sending on the registration template.',
  },
};

/** What would actually be sent for a purpose, today. */
export function resolveTemplate(purpose) {
  const spec = DLT_TEMPLATES[purpose];
  if (!spec) return { id: '', text: '', sendable: false, usingFallback: null, label: purpose, pendingReason: null };

  if (spec.registered && spec.id) {
    return {
      id: spec.id, text: spec.text, sendable: true,
      usingFallback: null, label: spec.label, pendingReason: null,
    };
  }

  const alt = spec.fallback ? DLT_TEMPLATES[spec.fallback] : null;
  if (alt && alt.registered && alt.id) {
    return {
      id: alt.id,
      text: alt.text,           // the fallback's own wording - the matched pair
      sendable: true,
      usingFallback: spec.fallback,
      label: spec.label,
      pendingReason: spec.pendingReason || null,
    };
  }

  // Nothing deliverable. The caller must decline rather than send.
  return {
    id: '', text: spec.text, sendable: false,
    usingFallback: null, label: spec.label, pendingReason: spec.pendingReason || null,
  };
}

/** The sender header, as it goes on the wire: six characters. */
export const DLT_SENDER_ID = 'IFQMID';

/** Kaleyra account SID - a path segment in every request, not a header. */
export const KALEYRA_SID = 'HXAP1678914824IN';

/** Header validity - liberal in what is accepted, strict in what is sent. */
export const SENDER_ID_RE = /^[A-Za-z0-9]{6}(-[TSP])?$/i;

/** The six characters to put in the `sender` field. */
export function senderHeader(value) {
  return String(value ?? '').trim().replace(/-[TSP]$/i, '');
}

/** The purposes that can be delivered today, for status displays. */
export function templateStatus() {
  return Object.entries(DLT_TEMPLATES).map(([purpose, t]) => {
    const r = resolveTemplate(purpose);
    return {
      purpose,
      label: t.label,
      id: r.id,
      registered: t.registered && !!t.id,
      sendable: r.sendable,
      using_fallback: r.usingFallback,
      pending_reason: r.pendingReason,
    };
  });
}

export default {
  DLT_TEMPLATES, DLT_SENDER_ID, KALEYRA_SID, SENDER_ID_RE, senderHeader,
  templateStatus, resolveTemplate,
};
