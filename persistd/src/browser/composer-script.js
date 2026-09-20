function buildComposerResolveScript({ timeoutMs = 30000 } = {}) {
  const timeout = Math.max(1000, Number(timeoutMs) || 30000);
  return `
let composer = page.locator('#prompt-textarea').first()
let composerReady = false
let composerStrategy = 'none'
let composerDiagnostics = null
const composerDeadline = Date.now() + ${timeout}
while (!composerReady && Date.now() < composerDeadline) {
  const composerCandidates = [
    ['prompt-textarea-id', page.locator('#prompt-textarea').first()],
    ['prompt-textarea-testid', page.locator('[data-testid="prompt-textarea"]').first()],
    ['semantic-role', page.getByRole('textbox', { name: /converse com o chatgpt|message chatgpt|ask chatgpt|pergunte ao chatgpt|mensagem|message/i }).first()],
    ['main-role', page.locator('main [contenteditable="true"][role="textbox"]').first()],
    ['lexical-editor', page.locator('[contenteditable="true"][data-lexical-editor="true"]').first()],
    ['contenteditable-role', page.locator('[contenteditable="true"][role="textbox"]').first()],
  ]
  for (const [strategy, candidate] of composerCandidates) {
    try {
      if ((await candidate.count()) > 0 && await candidate.isVisible()) {
        composer = candidate
        composerReady = true
        composerStrategy = strategy
        break
      }
    } catch {}
  }
  if (!composerReady) await page.waitForTimeout(400)
}
if (!composerReady) {
  try {
    composerDiagnostics = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      candidates: [...document.querySelectorAll('[role="textbox"], textarea, [contenteditable="true"]')].slice(0, 20).map((el) => ({
        tag: el.tagName,
        id: el.id || null,
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        testid: el.getAttribute('data-testid'),
        contenteditable: el.getAttribute('contenteditable'),
        hidden: Boolean(el.hidden || el.getAttribute('aria-hidden') === 'true'),
      })),
    }))
  } catch (error) {
    composerDiagnostics = { diagnosticError: error && error.message ? String(error.message) : String(error) }
  }
}
`;
}

module.exports = { buildComposerResolveScript };
