// Light/dark lives on <html data-theme> (set before first paint by index.html) and in
// localStorage. Two places switch it - the topbar on a desktop, the drawer on a phone - so the
// three lines live here rather than in both.
export function isDarkTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function toggleTheme() {
  const next = isDarkTheme() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ifqm-theme', next);
  return next === 'dark';
}
