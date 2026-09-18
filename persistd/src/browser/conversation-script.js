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
${commanderSetup}
const assistants = page.locator('[data-message-author-role="assistant"]')
const beforeAssistant = await assistants.count()
await composer.fill(${js(message)})
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

function buildChatGPTProbeScript({ runId = 'swarm', chatId, openIfMissing = false, timeoutMs = 20000 }) {
  const taskName = `persist:${runId}`;
  const url = `https://chatgpt.com/c/${chatId}`;
  return `
await taskSpaces.useOrCreate(${js(taskName)})
const tabs = await browser.listTabs({ includeChrome: false })
const exact = tabs.find((tab) => {
  const match = /\\/c\\/([^/?#]+)/.exec(tab.url || '')
  return match && match[1] === ${js(chatId)}
})

if (!exact && !${js(openIfMissing)}) {
  console.log('PERSISTD_RESULT:' + JSON.stringify({
    status: 'TAB_MISSING',
    ok: true,
    tabFound: false,
    chatId: ${js(chatId)},
    browserRunning: true,
    processAlive: true,
    windowOpen: false,
    isGenerating: false,
    stopButtonVisible: false,
    observedAt: new Date().toISOString()
  }))
  return
}

if (!exact && ${js(openIfMissing)}) {
  await browser.openOrReuseTab(${js(url)}, { wait: true, timeout: ${js(timeoutMs)} })
} else if (exact) {
  await browser.switchTab(exact.targetId)
}

const probe = await page.evaluate(() => {
  const currentUrl = window.location.href || ''
  const bodyText = (document.body && (document.body.innerText || document.body.textContent) || '').toLowerCase()

  const loginBtn = document.querySelector('a[data-testid="login-button"], button[data-testid="login-button"], [href*="/auth/login"], #login-button')
  const cfChallenge = Boolean(document.querySelector('#cf-challenge, .cf-turnstile, #challenge-running') || currentUrl.includes('challenges.cloudflare.com'))
  const loginRequired = Boolean(loginBtn || currentUrl.includes('/auth/login') || currentUrl.includes('login.openai.com'))
  const isLoggedIn = !loginRequired && !cfChallenge

  const rateLimitExceeded = bodyText.includes('too many requests') ||
    bodyText.includes('muitas solicita') ||
    bodyText.includes('excesso de solicita') ||
    bodyText.includes('solicitações rápido demais') ||
    bodyText.includes('solicitacoes rapido demais') ||
    bodyText.includes('rate limit')

  const errorBanner = document.querySelector('[role="alert"], .bg-red-500, [data-testid*="error"]')
  const isErrorScreen = Boolean(errorBanner && !rateLimitExceeded)
  const error = errorBanner ? String(errorBanner.textContent || '').trim() : null

  const stopButton = document.querySelector('[data-testid="stop-button"]')
  const stopButtonVisible = Boolean(stopButton)
  const streamingIndicator = Boolean(document.querySelector('.result-streaming'))
  const isGenerating = stopButtonVisible || streamingIndicator

  const assistantEls = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
  const assistantCount = assistantEls.length
  let lastAssistantText = ''
  let outputLength = 0
  if (assistantEls.length > 0) {
    const last = assistantEls[assistantEls.length - 1]
    lastAssistantText = String(last.innerText || last.textContent || '').trim()
    outputLength = lastAssistantText.length
  }

  const toolNodes = document.querySelectorAll(
    '[data-testid*="tool"], [data-testid*="code-execution"], [data-testid="kernel-output"], button[aria-label*="Analyz"], button[aria-label*="Pesquisar"], button[aria-label*="Searched"], .result-streaming'
  )
  const toolCount = toolNodes.length

  const composer = document.querySelector('#prompt-textarea')
  const promptReady = Boolean(composer && !composer.disabled && !stopButtonVisible)
  const promptInput = composer ? String(composer.value || composer.textContent || '').trim() : ''

  let completed = false
  let taskStatus = null
  if (!isGenerating && lastAssistantText) {
    if (/\\b(TASK_DONE|WORKER_DONE|\\[DONE\\]|SWARM_DONE)\\b/.test(lastAssistantText)) {
      completed = true
      taskStatus = 'DONE'
    }
  }

  return {
    tabFound: true,
    currentUrl,
    browserRunning: true,
    processAlive: true,
    windowOpen: true,
    isLoggedIn,
    loginRequired,
    authWall: loginRequired || cfChallenge,
    cloudflareChallenge: cfChallenge,
    turnstileBlocked: cfChallenge,
    rateLimitExceeded,
    isErrorScreen,
    error,
    stopButtonVisible,
    isGenerating,
    assistantCount,
    outputLength,
    outputSize: outputLength,
    responseText: lastAssistantText.slice(-500),
    toolCount,
    promptReady,
    promptInput,
    completed,
    taskStatus
  }
})

console.log('PERSISTD_RESULT:' + JSON.stringify({
  status: 'PROBE_COMPLETE',
  ok: true,
  chatId: ${js(chatId)},
  ...probe,
  observedAt: new Date().toISOString()
}))
`;
}

function buildGenericChatGPTSendScript({
  runId = 'swarm',
  chatId,
  message,
  verifyLine,
  taskMarker,
  waitForAssistantStart = true,
  timeoutMs = 20000,
}) {
  const taskName = `persist:${runId}`;
  const url = `https://chatgpt.com/c/${chatId}`;
  const effectiveMessage = taskMarker && !message.includes(taskMarker)
    ? `[SWARM_TASK_MARKER:${taskMarker}]\n${message}`
    : message;

  return `
await taskSpaces.useOrCreate(${js(taskName)})
await browser.openOrReuseTab(${js(url)}, { wait: true, timeout: ${js(timeoutMs)} })

const composer = page.locator('#prompt-textarea')
const ready = await composer.waitFor({ state: 'visible', timeout: 15000 })
if (!ready) throw new Error('Message composer not ready')

const preflightText = String(await page.locator('body').evaluate((el) => el.innerText || '')).toLowerCase()
const preflightRateLimited = preflightText.includes('too many requests') || preflightText.includes('muitas solicita') || preflightText.includes('excesso de solicita') || preflightText.includes('solicitações rápido demais') || preflightText.includes('solicitacoes rapido demais')
if (preflightRateLimited) {
  console.log('PERSISTD_RESULT:' + JSON.stringify({
    status: 'RATE_LIMITED',
    ok: false,
    sent: false,
    rateLimited: true,
    chatId: ${js(chatId)},
    taskMarker: ${js(taskMarker || null)}
  }))
  return
}

let previousTurnIdle = false
try {
  previousTurnIdle = Boolean(await page.waitForFunction(() => !document.querySelector('[data-testid="stop-button"]'), undefined, { timeout: 30000 }))
} catch { previousTurnIdle = false }
if (!previousTurnIdle) throw new Error('Previous assistant turn did not settle')

const assistants = page.locator('[data-message-author-role="assistant"]')
const beforeAssistant = await assistants.count()

await composer.fill(${js(effectiveMessage)})
const sendButton = page.locator('[data-testid="send-button"]')
if ((await sendButton.count()) > 0) await sendButton.first().click()
else await composer.press('Enter')

let sent = false
const verifyTarget = ${js(verifyLine || (taskMarker ? `[SWARM_TASK_MARKER:${taskMarker}]` : null))}
if (verifyTarget) {
  try {
    sent = Boolean(await page.waitForFunction((line) => [...document.querySelectorAll('[data-message-author-role="user"]')].some((el) => String(el.innerText || el.textContent || '').includes(line)), verifyTarget, { timeout: 15000 }))
  } catch { sent = false }
} else {
  // If no explicit verifyLine, consider sent if composer cleared or send button toggled
  try {
    sent = Boolean(await page.waitForFunction(() => {
      const c = document.querySelector('#prompt-textarea')
      return !c || (c.value || c.textContent || '').trim() === ''
    }, undefined, { timeout: 5000 }))
  } catch { sent = true }
}

let rateLimited = false
try {
  rateLimited = Boolean(await page.waitForFunction(() => {
    const text = String(document.body && document.body.innerText || '').toLowerCase()
    return text.includes('too many requests') || text.includes('muitas solicita') || text.includes('excesso de solicita')
  }, undefined, { timeout: 2500 }))
} catch { rateLimited = false }

let assistantStarted = false
let stopButtonVisible = false
if (sent && !rateLimited && ${js(waitForAssistantStart)}) {
  try {
    assistantStarted = Boolean(await page.waitForFunction((before) => {
      const stop = document.querySelector('[data-testid="stop-button"]')
      const count = document.querySelectorAll('[data-message-author-role="assistant"]').length
      return Boolean(stop) || count > before
    }, beforeAssistant, { timeout: 45000 }))
    stopButtonVisible = Boolean(await page.evaluate(() => Boolean(document.querySelector('[data-testid="stop-button"]'))))
  } catch {
    assistantStarted = false
    stopButtonVisible = false
  }
}

const ok = sent && !rateLimited && (${js(!waitForAssistantStart)} || assistantStarted)

console.log('PERSISTD_RESULT:' + JSON.stringify({
  status: rateLimited ? 'RATE_LIMITED' : (ok ? 'MESSAGE_SENT' : (sent ? 'ASSISTANT_NOT_STARTED' : 'MESSAGE_NOT_SEEN')),
  ok,
  sent,
  rateLimited,
  assistantStarted,
  stopButtonVisible,
  beforeAssistant,
  chatId: ${js(chatId)},
  taskMarker: ${js(taskMarker || null)},
  observedAt: new Date().toISOString()
}))
`;
}

module.exports = {
  buildFindAssistantLineScript,
  buildSendMessageScript,
  buildChatGPTProbeScript,
  buildGenericChatGPTSendScript,
};
