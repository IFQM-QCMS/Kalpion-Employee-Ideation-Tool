import { settingsApi } from '../services/api';

// Organisation settings are read by several unrelated components (the shell, the screen
// guard on every idea page, the upload control).
let pending = null;

export function loadOrgSettings() {
  if (!pending) {
    pending = settingsApi.get()
      .then((res) => res.data?.settings || {})
      .catch(() => ({}));            // a failed read must not break a screen
  }
  return pending;
}

export function resetOrgSettings() {
  pending = null;
}

// Reads a numeric setting, falling back when it is absent, blank or not a number.
export function numSetting(settings, key, fallback) {
  const n = parseInt(settings?.[key], 10);
  return Number.isFinite(n) ? n : fallback;
}
