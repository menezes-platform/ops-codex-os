function js(value) { return JSON.stringify(value); }
const { buildCommanderSetupScript } = require('./commander-script');

function buildFindAssistantLineScript({ runId, chatId, line }) {
  const taskName = `persist:${runId}`;
  const url = `https://chatgpt.com/c/${chatId}`;
  return `
await taskSpaces.useOrCreate(${js(taskName)})
await browser.openOrReuseTab(${js(url)}, { wait: true, timeout: 20000 })
let found = false
try {
  found = Boolean(await page.waitForFunction((line) => [...document.querySelectorAll('[data-message-author-role="assistant"]')].some((el) => String(el.innerText || el.textContent || '').split(/\\r?\\n/).map((item) => item.trim()).includes(line)), ${js(line)}, { timeout: 10000 }))
} catch { found = false }
console.log('PERSISTD_RESULT:' + JSON.stringify({ status: found ? 'LINE_FOUND' : 'LINE_MISSING', ok: found, chatId: ${js(chatId)}, line: ${js(line)} }))
`;
}

function buildAssistantStartScript(waitForAssistantStart) {
  if (!waitForAssistantStart) return 'let assistantStarted = true';
  return `
let assistantStarted = false
if (sent && !rateLimited) {
  try {
    assistantStarted = Boolean(await page.waitForFunction((before) => {
      const stop = document.querySelector('[data-testid="stop-button"]')
      const count = document.querySelectorAll('[data-message-author-role="assistant"]').length
      return Boolean(stop) || count > before
    }, beforeAssistant, { timeout: 60000 }))
  } catch { assistantStarted = false }
}
`;
}

function buildSendMessageScript({ runId, chatId, message, verifyLine, attachCommander = false, waitForAssistantStart = false }) {
  const taskName = `persist:${runId}`;
  const url = `https://chatgpt.com/c/${chatId}`;
  const commanderSetup = attachCommander ? buildCommanderSetupScript() : '';
  const assistantStart = buildAssistantStartScript(waitForAssistantStart);
  return `
await taskSpaces.useOrCreate(${js(taskName)})
await browser.openOrReuseTab(${js(url)}, { wait: true, timeout: 20000 })
const composer = page.locator('#prompt-textarea')
const ready = await composer.waitFor({ state: 'visible', timeout: 15000 })
if (!ready) throw new Error('Message composer not ready')
const preflightText = String(await page.locator('body').evaluate((el) => el.innerText || '')).toLowerCase()
const preflightRateLimited = preflightText.includes('too many requests') || preflightText.includes('muitas solicita') || preflightText.includes('excesso de solicitações') || preflightText.includes('excesso de solicita') || preflightText.includes('solicitações rápido demais') || preflightText.includes('solicitacoes rapido demais')
if (preflightRateLimited) {
  console.log('PERSISTD_RESULT:' + JSON.stringify({ status: 'RATE_LIMITED', ok: false, sent: false, assistantStarted: false, rateLimited: true, chatId: ${js(chatId)} }))
  return
}
let alreadyResumed = false
try {
  const resumeState = await page.evaluate((line) => {
    const messages = [...document.querySelectorAll('[data-message-author-role]')]
    let confirmationIndex = -1
    let lastUserIndex = -1
    for (let i = 0; i < messages.length; i++) {
      const role = messages[i].getAttribute('data-message-author-role')
      if (role !== 'user') continue
      lastUserIndex = i
      const lines = String(messages[i].innerText || messages[i].textContent || '').split(/\\r?\\n/).map((item) => item.trim())
      if (lines.includes(line)) confirmationIndex = i
    }
    const assistantAfter = confirmationIndex >= 0 && messages.slice(confirmationIndex + 1).some((el) => el.getAttribute('data-message-author-role') === 'assistant')
    const activeAfter = confirmationIndex >= 0 && confirmationIndex === lastUserIndex && Boolean(document.querySelector('[data-testid="stop-button"]'))
    return { confirmationIndex, lastUserIndex, assistantAfter, activeAfter }
  }, ${js(verifyLine)})
  alreadyResumed = Boolean(resumeState && (resumeState.assistantAfter || resumeState.activeAfter))
} catch { alreadyResumed = false }
if (alreadyResumed) {
  console.log('PERSISTD_RESULT:' + JSON.stringify({ status: 'ALREADY_RESUMED', ok: true, sent: true, assistantStarted: true, chatId: ${js(chatId)} }))
  return
}
let previousTurnIdle = false
try {
  previousTurnIdle = Boolean(await page.waitForFunction(() => !document.querySelector('[data-testid="stop-button"]'), undefined, { timeout: 30000 }))
} catch { previousTurnIdle = false }
if (!previousTurnIdle) throw new Error('Previous assistant turn did not settle')
const assistants = page.locator('[data-message-author-role="assistant"]')
const beforeAssistant = await assistants.count()
await composer.fill(${js(message)})
${commanderSetup}
const sendButton = page.locator('[data-testid="send-button"]')
if ((await sendButton.count()) > 0) await sendButton.first().click()
else await composer.press('Enter')
let sent = false
try {
  sent = Boolean(await page.waitForFunction((line) => [...document.querySelectorAll('[data-message-author-role="user"]')].some((el) => String(el.innerText || el.textContent || '').split(/\\r?\\n/).map((item) => item.trim()).includes(line)), ${js(verifyLine)}, { timeout: 15000 }))
} catch { sent = false }
let rateLimited = false
try {
  rateLimited = Boolean(await page.waitForFunction(() => {
    const text = String(document.body && document.body.innerText || '').toLowerCase()
    return text.includes('too many requests') || text.includes('muitas solicita') || text.includes('excesso de solicitações') || text.includes('excesso de solicita') || text.includes('solicitações rápido demais') || text.includes('solicitacoes rapido demais')
  }, undefined, { timeout: 2500 }))
} catch { rateLimited = false }
${assistantStart}
const ok = sent && assistantStarted && !rateLimited
console.log('PERSISTD_RESULT:' + JSON.stringify({
  status: rateLimited ? 'RATE_LIMITED' : (ok ? ${js(waitForAssistantStart ? 'ASSISTANT_STARTED' : 'MESSAGE_SENT')} : (sent ? 'ASSISTANT_NOT_STARTED' : 'MESSAGE_NOT_SEEN')),
  ok, sent, assistantStarted, rateLimited, beforeAssistant, chatId: ${js(chatId)}
}))
`;
}

module.exports = { buildFindAssistantLineScript, buildSendMessageScript };
