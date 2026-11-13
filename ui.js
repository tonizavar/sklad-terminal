/* Keyboard parity for controls and accessible modal focus. */
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.kpi-card, th.sortable, #shiftPill, #syncStatus, #brandTag').forEach(el => {
    el.tabIndex = 0; el.setAttribute('role', 'button');
  });
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    const title = el.querySelector('h3');
    if (title) { title.id ||= `${el.id}Title`; el.setAttribute('aria-labelledby', title.id); }
  });
  document.addEventListener('keydown', e => {
    const modal = [...document.querySelectorAll('.modal-overlay.show')].at(-1);
    if (e.key === 'Tab' && modal) {
      const controls = [...modal.querySelectorAll('button, input, textarea, [tabindex="0"]')].filter(el => !el.disabled && el.offsetParent !== null);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    }
    const el = e.target.closest('[role="button"]');
    if (el && ['Enter', ' '].includes(e.key)) { e.preventDefault(); el.click(); }
  });
});
