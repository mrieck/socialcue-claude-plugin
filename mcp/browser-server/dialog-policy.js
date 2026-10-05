// Native dialogs are never auto-answered. Playwright would dismiss them on any
// page without a listener, so we listen on every tab and keep the dialog pending.
const armed = new WeakSet();
const pending = new WeakMap();

export function installDialogPolicy(context) {
  const arm = (pg) => {
    if (armed.has(pg)) return;
    armed.add(pg);
    pg.on('dialog', (dialog) => {
      pending.set(pg, { type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue(), dialog, at: Date.now() });
    });
  };
  context.pages().forEach(arm);
  context.on('page', arm);
}

export function pendingDialog(page) {
  const p = pending.get(page);
  if (!p) return null;
  return { type: p.type, message: p.message, defaultValue: p.defaultValue, ageMs: Date.now() - p.at };
}

export async function handleDialog(page, action, text) {
  const p = pending.get(page);
  if (!p) throw new Error('No dialog is open on this tab.');
  pending.delete(page);
  if (action === 'accept') await p.dialog.accept(text ?? undefined);
  else await p.dialog.dismiss();
  return { handled: action, type: p.type, message: p.message };
}
