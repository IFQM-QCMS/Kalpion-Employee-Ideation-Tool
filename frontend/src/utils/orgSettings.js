import { settingsApi } from '../services/api';

/*
 * Organisation settings are read by several unrelated components (the shell, the
 * screen guard on every idea page, the upload control). Each one asking the
 * server separately meant the same request four times on a single navigation.
 *
 * One in-flight promise per session, shared. It is deliberately not a store with
 * invalidation: these settings change from the admin panel, which reloads the
 * screen anyway, and a stale read here only affects a display preference.
 */
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

/* Reads a numeric setting, falling back when it is absent, blank or not a
   number. Written out rather than `parseInt(v) || d` because that form quietly
   turns a legitimate 0 into the fallback. */
export function numSetting(settings, key, fallback) {
  const n = parseInt(settings?.[key], 10);
  return Number.isFinite(n) ? n : fallback;
}
