/*
 * On a phone every data table turns into a stack of cards (see the ≤640px block in
 * index.css). A card needs the column heading next to each value, and CSS can only print it
 * from an attribute - so this copies each <th> onto the <td>s beneath it as data-label.
 *
 * Done once, centrally, from the shell: thirty pages render tables, and none of them should
 * have to know about it. The observer re-labels whenever React re-renders rows.
 */
// The visible words of a heading - not the InfoDot's help text, its <style> block, or a
// sort button's glyph.
function headingText(th) {
  const copy = th.cloneNode(true);
  copy.querySelectorAll('style, script, button, .ifqm-infodot, [aria-hidden="true"]').forEach((n) => n.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

function labelTable(table) {
  const heads = Array.from(table.querySelectorAll(':scope > thead th')).map(headingText);
  if (!heads.length) return;
  // Four or more columns cannot be read side by side on a phone; the stylesheet stacks
  // those. A page may pin either behaviour itself with .table-stack / .table-scroll.
  if (heads.length >= 4 && !table.classList.contains('table-scroll')) table.classList.add('table-stack');
  table.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
    let col = 0;
    Array.from(tr.children).forEach((td) => {
      if (td.tagName !== 'TD') return;
      const span = td.colSpan || 1;
      // A cell spanning the row (spinner, "no results") is a message, not a value.
      if (span === 1 && heads[col]) td.setAttribute('data-label', heads[col]);
      else td.removeAttribute('data-label');
      col += span;
    });
  });
}

export function labelTablesIn(root) {
  if (!root) return;
  root.querySelectorAll('table').forEach(labelTable);
}

// A tab strip scrolls sideways on a phone; the tab that is open should be the one in view
// when a screen appears, not whichever happened to be first.
let lastActiveTab = null;
function revealActiveTab(root) {
  const tab = root.querySelector('.tab-bar .tab.active, .tabs .tab.active');
  if (!tab || tab === lastActiveTab) return;
  lastActiveTab = tab;
  const strip = tab.parentElement;
  if (strip && strip.scrollWidth > strip.clientWidth) {
    tab.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
}

/** Keep every table under `root` labelled for as long as it lives. Returns a disposer. */
export function watchTables(root) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let scheduled = false;
  const run = () => { scheduled = false; labelTablesIn(root); revealActiveTab(root); };
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  run();
  return () => mo.disconnect();
}
