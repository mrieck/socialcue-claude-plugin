/** URL-based link activation for discovery. No ref, text, or coordinate fallback. */
export async function openLinkOnPage(page, url) {
  const destination = new URL(url);
  if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password) {
    throw new Error('open_link requires an absolute HTTP(S) URL without credentials.');
  }
  const result = await page.evaluate((expectedUrl) => {
    // Resolve and activate in one browser task: a rerender cannot swap the
    // destination between our validation and click. Include open shadow roots.
    const links = [];
    function visit(root) {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'A' && el.href === expectedUrl) links.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    }
    visit(document);
    const link = links.find(el => {
      const style = getComputedStyle(el);
      return el.isConnected && el.getClientRects().length &&
        style.visibility !== 'hidden' && style.display !== 'none' &&
        !el.closest('[hidden], [inert], [aria-hidden="true"]');
    });
    if (!link) throw new Error(`No visible link to ${expectedUrl}. Read the page again; no click was performed.`);
    if (link.hasAttribute('download') || link.getAttribute('aria-disabled') === 'true' ||
        (link.getAttribute('role') && link.getAttribute('role') !== 'link') ||
        link.closest('button, [role="button"]')) {
      throw new Error('Target is a download, disabled link, or action control; no click was performed.');
    }
    if (link.target && link.target.toLowerCase() !== '_self') {
      throw new Error('Link opens another browsing context. Use open_tab with the explicit URL instead.');
    }
    const label = link.innerText || link.getAttribute('aria-label') || '';
    link.click(); // Preserve SPA routing (Threads redirects direct page loads to its feed).
    return { requestedUrl: expectedUrl, label, activated: true };
  }, destination.href);
  // Activation is distinct from successful navigation; report the actual URL
  // so the caller can read the destination and detect redirects/loading errors.
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  return { ...result, url: page.url() };
}
