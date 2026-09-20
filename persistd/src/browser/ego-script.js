function js(value) { return JSON.stringify(value); }
const { buildCommanderSetupScript } = require('./commander-script');
const { buildComposerResolveScript } = require('./composer-script');

function buildSuccessorScript({ runId, message, nextGeneration }) {
  const taskName = `persist:${runId}`;
  const marker = `CLAIM ${runId} G${nextGeneration}`;
  const requestLine = String(message).split(/\r?\n/).find((line) => line.startsWith('CLAIM_REQUEST ')) || marker;
  const commanderSetup = buildCommanderSetupScript();
  const composerResolver = buildComposerResolveScript({ timeoutMs: 30000 });
  return `
let task = null
let successorTargetId = null
let persistdResult
try {
  task = await taskSpaces.useOrCreate(${js(taskName)})
  const initialTabs = await browser.listTabs({ includeChrome: true })
  const isScratchUrl = (url) => { const value = String(url || ''); const lower = value.toLowerCase(); return lower.startsWith('about:') || lower.startsWith('chrome://') || lower.startsWith('chrome-untrusted://') || lower.startsWith('devtools://') || lower.startsWith('chrome-extension://') || value === 'https://chatgpt.com/' || value.startsWith('https://chatgpt.com/?') || value.startsWith('https://chatgpt.com/#') }
  let scratch = initialTabs.find((tab) => isScratchUrl(tab.url))
  if (!scratch) scratch = await browser.openOrReuseTab('about:blank', { wait: false })
  if (!scratch || !scratch.targetId) throw new Error('Successor scratch target missing')
  successorTargetId = scratch.targetId
  for (const tab of initialTabs) {
    if (tab.targetId === successorTargetId || !isScratchUrl(tab.url)) continue
    await browser.closeTab(tab.targetId)
  }
  await browser.switchTab(successorTargetId)
  await page.goto('https://chatgpt.com/', { timeout: 20000 })
const startInfo = await page.info()
const startUrl = 'url' in startInfo ? startInfo.url : await page.url()
const loginButton = page.getByRole('button', { name: /log in|sign in|entrar/i })
const loginLink = page.getByRole('link', { name: /log in|sign in|entrar/i })
let authRequired = /auth|login|signin/i.test(startUrl)
if (!authRequired && (await loginButton.count()) > 0) authRequired = await loginButton.first().isVisible()
if (!authRequired && (await loginLink.count()) > 0) authRequired = await loginLink.first().isVisible()
if (authRequired) {
  persistdResult = { status: 'AUTH_REQUIRED', taskSpaceId: task.id, url: startUrl }
} else {
  const newChatLink = page.getByRole('link', { name: /new chat|novo chat/i })
  const newChatButton = page.getByRole('button', { name: /new chat|novo chat/i })
  if ((await newChatLink.count()) > 0) await newChatLink.first().click()
  else if ((await newChatButton.count()) > 0) await newChatButton.first().click()

  ${composerResolver}
  if (!composerReady) throw new Error('ChatGPT composer not ready|' + JSON.stringify(composerDiagnostics))

  ${commanderSetup}

  await composer.fill(${js(message)})
  const sendButton = page.locator('[data-testid="send-button"]')
  if ((await sendButton.count()) > 0) await sendButton.first().click()
  else await composer.press('Enter')

  const batonMessage = page.locator('[data-message-author-role="user"]').filter({ hasText: 'PERSISTENT CONVERSATION CONTROLLER TAKEOVER' }).last()
  const batonVisible = await batonMessage.waitFor({ state: 'visible', timeout: 15000 })
  if (!batonVisible) throw new Error('Submitted baton not visible')
  const requestSeen = Boolean(await page.waitForFunction((expectedLine) => {
    const hasExactLine = (el) => String(el.innerText || el.textContent || '').split(/\\r?\\n/).map((item) => item.trim()).includes(expectedLine)
    const assistants = [...document.querySelectorAll('[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]')]
    if (assistants.some(hasExactLine)) return true
    return [...document.querySelectorAll('div')].some((el) => /^(ChatGPT said:|ChatGPT disse:|Assistant said:)/i.test(String(el.innerText || el.textContent || '').trim()) && hasExactLine(el))
  }, ${js(requestLine)}, { timeout: 120000 }))
  const finalUrl = await page.url()
  const match = /\\/c\\/([^/?#]+)/.exec(finalUrl)
  persistdResult = {
    status: 'SUBMITTED',
    taskSpaceId: task.id,
    targetId: successorTargetId,
    chatId: match ? match[1] : null,
    claimSeen: requestSeen,
    requestLine: requestSeen ? ${js(requestLine)} : null,
    url: finalUrl,
    evidence: requestSeen ? 'baton-visible+claim-request-visible' : 'baton-visible'
  }
}
} catch (error) {
  let errorUrl = null
  try { errorUrl = await page.url() } catch {}
  const errorMatch = /\\/c\\/([^/?#]+)/.exec(errorUrl || '')
  persistdResult = {
    status: 'BROWSER_ERROR',
    taskSpaceId: task && task.id ? task.id : null,
    targetId: successorTargetId,
    chatId: errorMatch ? errorMatch[1] : null,
    url: errorUrl,
    error: error && error.message ? String(error.message) : String(error)
  }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}

function buildTerminalScript({ runId, chatId, message }) {
  const taskName = `persist:${runId}`;
  const url = `https://chatgpt.com/c/${chatId}`;
  const instruction = `The durable /persist controller has verified DONE. Reply to the user with this completion notice and no further work:\n\n${message}`;
  const composerResolver = buildComposerResolveScript({ timeoutMs: 30000 });
  return `
const task = await taskSpaces.useOrCreate(${js(taskName)})
await browser.openOrReuseTab(${js(url)}, { wait: true, timeout: 20000 })
${composerResolver}
if (!composerReady) throw new Error('Terminal notification composer not ready|' + JSON.stringify(composerDiagnostics))
const assistants = page.locator('[data-message-author-role="assistant"]')
const before = await assistants.count()
await composer.fill(${js(instruction)})
const sendButton = page.locator('[data-testid="send-button"]')
if ((await sendButton.count()) > 0) await sendButton.first().click()
else await composer.press('Enter')
const appeared = await page.waitForFunction(
  (count) => document.querySelectorAll('[data-message-author-role="assistant"]').length > count,
  before,
  { timeout: 90000 }
)
const after = await assistants.count()
console.log('PERSISTD_RESULT:' + JSON.stringify({ status: appeared && after > before ? 'NOTIFIED' : 'NOTIFICATION_FAILED', sent: Boolean(appeared && after > before), taskSpaceId: task.id, chatId: ${js(chatId)} }))
`;
}

function buildRenameChatsScript({ runId, chats }) {
  const taskName = `persist:${runId}`;
  return `
const task = await taskSpaces.useOrCreate(${js(taskName)})
const chats = ${js(chats || [])}
let renamed = 0
for (const item of chats) {
  await browser.openOrReuseTab('https://chatgpt.com/c/' + encodeURIComponent(item.chatId), { wait: true, timeout: 20000 })
  const currentTitle = await page.title()
  if (currentTitle === item.title) { renamed++; continue }
  if (await page.getByTestId('close-sidebar-button').count() === 0) {
    const openSidebar = page.getByRole('button', { name: 'Abrir barra lateral' })
    if (await openSidebar.count()) { await openSidebar.click(); await page.waitForTimeout(250) }
  }
  let menuReady = false
  for (let attempt = 0; attempt < 3 && !menuReady; attempt++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(120)
    const conversationLink = page.getByRole('link', { name: currentTitle }).first()
    if (await conversationLink.count()) { await conversationLink.hover(); await page.waitForTimeout(150) }
    const options = page.getByRole('button', { name: 'Abrir opções de conversa para ' + currentTitle }).first()
    if (await options.count() === 0) {
      if (attempt === 2) throw new Error('Conversation options missing for: ' + currentTitle)
      continue
    }
    await options.click()
    try {
      menuReady = Boolean(await page.waitForFunction(
        () => [...document.querySelectorAll('[role="menuitem"]')].some((el) => (el.textContent || '').trim() === 'Renomear'),
        null,
        { timeout: 1800 }
      ))
    } catch { menuReady = false }
  }
  if (!menuReady) throw new Error('Rename menu did not open')
  await page.getByText('Renomear', { exact: true }).click()
  const input = page.locator('input[aria-label="Título do chat"]')
  const inputReady = await input.waitFor({ state: 'visible', timeout: 3000 })
  if (!inputReady) throw new Error('Título do chat input missing')
  await input.fill(item.title)
  await input.press('Enter')
  const committed = await page.waitForFunction((expected) => document.title === expected, item.title, { timeout: 10000 })
  if (!committed) throw new Error('Chat rename did not commit: ' + item.title)
  renamed++
}
console.log('PERSISTD_RESULT:' + JSON.stringify({ status: 'RENAMED', ok: renamed === chats.length, renamed, taskSpaceId: task.id }))
`;
}


function buildArchiveRunChatScript({ runId, chatId }) {
  const taskName = `persist:${runId}`;
  return `
await taskSpaces.useOrCreate(${js(taskName)})
await browser.openOrReuseTab('https://chatgpt.com/c/' + encodeURIComponent(${js(chatId)}), { wait: true, timeout: 20000 })
const currentTitle = await page.title()
if (await page.getByTestId('close-sidebar-button').count() === 0) {
  const openSidebar = page.getByRole('button', { name: 'Abrir barra lateral' })
  if (await openSidebar.count()) { await openSidebar.click(); await page.waitForTimeout(250) }
}
let options = page.getByRole('button', { name: 'Abrir opções de conversa para ' + currentTitle }).first()
if (await options.count() === 0) options = page.getByRole('button', { name: 'Open conversation options for ' + currentTitle }).first()
if (await options.count() === 0) throw new Error('Conversation options missing for archive: ' + currentTitle)
await options.click()
let archiveItem = page.getByText('Arquivar', { exact: true }).first()
if (await archiveItem.count() === 0) archiveItem = page.getByText('Archive', { exact: true }).first()
if (await archiveItem.count() === 0) throw new Error('Archive menu item missing')
await archiveItem.click()
await page.waitForTimeout(500)
console.log('PERSISTD_RESULT:' + JSON.stringify({ status: 'ARCHIVED', ok: true, chatId: ${js(chatId)} }))
`;
}

function buildDiscoverRunChatsScript({ runId }) {
  const taskName = `persist:${runId}`;
  return `
const spaces = await taskSpaces.list()
const target = spaces.find((item) => item.name === ${js(taskName)})
let persistdResult = { status: 'DISCOVERED', taskSpaceId: null, chats: [] }
if (target) {
  const task = await taskSpaces.useOrCreate(${js(taskName)})
  const tabs = await browser.listTabs()
  const chats = tabs.map((tab) => {
    const match = /\\/c\\/([^/?#]+)/.exec(tab.url || '')
    return match ? { chatId: match[1], title: tab.title || '', url: tab.url, active: Boolean(tab.active), tabIndex: tab.index } : null
  }).filter(Boolean)
  persistdResult = { status: 'DISCOVERED', taskSpaceId: task.id, chats }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}

function buildCloseRunChatScript({ runId, chatId }) {
  const taskName = `persist:${runId}`;
  return `
const spaces = await taskSpaces.list()
const target = spaces.find((item) => item.name === ${js(taskName)})
let persistdResult = { status: 'ALREADY_CLOSED', ok: true, closed: 0, chatId: ${js(chatId)} }
if (target) {
  await taskSpaces.useOrCreate(${js(taskName)})
  const tabs = await browser.listTabs({ includeChrome: false })
  const matches = tabs.filter((tab) => {
    const match = /\\/c\\/([^/?#]+)/.exec(tab.url || '')
    return match && match[1] === ${js(chatId)}
  })
  let closed = 0
  for (const tab of matches) { await browser.closeTab(tab.targetId); closed++ }
  const remaining = await browser.listTabs({ includeChrome: false })
  const stillOpen = remaining.some((tab) => {
    const match = /\\/c\\/([^/?#]+)/.exec(tab.url || '')
    return match && match[1] === ${js(chatId)}
  })
  persistdResult = { status: stillOpen ? 'CLOSE_INCOMPLETE' : 'CLOSED', ok: !stillOpen, closed, chatId: ${js(chatId)} }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}

function buildCloseRunTargetScript({ runId, targetId }) {
  const taskName = `persist:${runId}`;
  return `
const spaces = await taskSpaces.list()
const target = spaces.find((item) => item.name === ${js(taskName)})
let persistdResult = { status: 'ALREADY_CLOSED', ok: true, closed: 0, targetId: ${js(targetId)} }
if (target) {
  await taskSpaces.useOrCreate(${js(taskName)})
  const tabs = await browser.listTabs({ includeChrome: true })
  const exact = tabs.find((tab) => tab.targetId === ${js(targetId)})
  if (exact) await browser.closeTab(exact.targetId)
  const remaining = await browser.listTabs({ includeChrome: true })
  const stillOpen = remaining.some((tab) => tab.targetId === ${js(targetId)})
  persistdResult = { status: stillOpen ? 'CLOSE_TARGET_INCOMPLETE' : 'CLOSED_TARGET', ok: !stillOpen, closed: exact ? 1 : 0, targetId: ${js(targetId)} }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}


function buildCleanupRunScratchTabsScript({ runId }) {
  const taskName = `persist:${runId}`;
  return `
const spaces = await taskSpaces.list()
const target = spaces.find((item) => item.name === ${js(taskName)})
let persistdResult = { status: 'TASKSPACE_MISSING', ok: true, closed: 0, remainingScratch: 0 }
if (target) {
  if (target.ownership && target.ownership !== 'agent') {
    persistdResult = { status: 'USER_CONTROL', ok: false, closed: 0, remainingScratch: null }
  } else {
    await taskSpaces.useOrCreate(${js(taskName)})
    const isScratchUrl = (url) => { const value = String(url || ''); const lower = value.toLowerCase(); return lower.startsWith('about:') || lower.startsWith('chrome://') || lower.startsWith('chrome-untrusted://') || lower.startsWith('devtools://') || lower.startsWith('chrome-extension://') || value === 'https://chatgpt.com/' || value.startsWith('https://chatgpt.com/?') || value.startsWith('https://chatgpt.com/#') }
    const tabs = await browser.listTabs({ includeChrome: true })
    const scratch = tabs.filter((tab) => isScratchUrl(tab.url))
    let closed = 0
    for (const tab of scratch) { await browser.closeTab(tab.targetId); closed++ }
    const remaining = await browser.listTabs({ includeChrome: true })
    const remainingScratch = remaining.filter((tab) => isScratchUrl(tab.url)).length
    persistdResult = { status: remainingScratch === 0 ? 'SCRATCH_CLEAN' : 'SCRATCH_REMAINS', ok: remainingScratch === 0, closed, remainingScratch }
  }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}

function buildPruneRunTabsScript({ runId, keepChatId }) {
  const taskName = `persist:${runId}`;
  return `
const spaces = await taskSpaces.list()
const target = spaces.find((item) => item.name === ${js(taskName)})
let persistdResult = { status: 'ALREADY_CLOSED', ok: true, closed: 0, remaining: 0, keepChatId: ${js(keepChatId)} }
if (target) {
  await taskSpaces.useOrCreate(${js(taskName)})
  const tabs = await browser.listTabs({ includeChrome: true })
  if (tabs.length === 0) {
    persistdResult = { status: 'ALREADY_EMPTY', ok: true, closed: 0, remaining: 0, keepChatId: ${js(keepChatId)} }
  } else {
  const keep = tabs.find((tab) => {
    const match = /\\/c\\/([^/?#]+)/.exec(tab.url || '')
    return match && match[1] === ${js(keepChatId)}
  })
  if (!keep) {
    persistdResult = { status: 'KEEP_TAB_MISSING', ok: false, closed: 0, remaining: tabs.length, keepChatId: ${js(keepChatId)} }
  } else {
    await browser.switchTab(keep.targetId)
    let closed = 0
    for (const tab of tabs) {
      if (tab.targetId === keep.targetId) continue
      await browser.closeTab(tab.targetId)
      closed++
    }
    const remainingTabs = await browser.listTabs({ includeChrome: true })
    const exactKeep = remainingTabs.filter((tab) => tab.targetId === keep.targetId)
    const ok = remainingTabs.length === 1 && exactKeep.length === 1
    persistdResult = { status: ok ? 'PRUNED' : 'PRUNE_INCOMPLETE', ok, closed, remaining: remainingTabs.length, keepChatId: ${js(keepChatId)} }
  }
  }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}

function buildRunChatActivityScript({ runId, chatId }) {
  const taskName = `persist:${runId}`;
  return `
const spaces = await taskSpaces.list()
const target = spaces.find((item) => item.name === ${js(taskName)})
let persistdResult = { status: 'TASKSPACE_MISSING', ok: true, known: false, busy: false, chatId: ${js(chatId)} }
if (target) {
  await taskSpaces.useOrCreate(${js(taskName)})
  const tabs = await browser.listTabs({ includeChrome: false })
  const exact = tabs.find((tab) => {
    const match = /\\/c\\/([^/?#]+)/.exec(tab.url || '')
    return match && match[1] === ${js(chatId)}
  })
  if (exact) {
    await browser.switchTab(exact.targetId)
    const busy = Boolean(await page.evaluate(() => Boolean(document.querySelector('[data-testid="stop-button"]'))))
    persistdResult = { status: 'ACTIVITY', ok: true, known: true, busy, chatId: ${js(chatId)}, targetId: exact.targetId }
  } else {
    persistdResult = { status: 'CHAT_MISSING', ok: true, known: false, busy: false, chatId: ${js(chatId)} }
  }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}

function buildCleanupScript({ runId }) {
  const taskName = `persist:${runId}`;
  return `
const spaces = await taskSpaces.list()
const target = spaces.find((item) => item.name === ${js(taskName)})
let result = { done: true, alreadyClosed: true }
if (target) result = await taskSpaces.complete(target.id, { keep: false })
console.log('PERSISTD_RESULT:' + JSON.stringify({ status: 'CLEANED', closed: Boolean(result && result.done), alreadyClosed: Boolean(result && result.alreadyClosed) }))
`;
}

function buildHealthScript({ runId = 'health' } = {}) {
  const taskName = `persist:${runId}`;
  return `
let persistdResult
try {
  const task = await taskSpaces.useOrCreate(${js(taskName)})
  const tabs = await browser.listTabs({ includeChrome: true })
  persistdResult = { status: 'HEALTHY', ok: true, taskSpaceId: task.id, tabCount: tabs.length }
} catch (error) {
  persistdResult = { status: 'UNHEALTHY', ok: false, error: error && error.message ? String(error.message) : String(error) }
}
console.log('PERSISTD_RESULT:' + JSON.stringify(persistdResult))
`;
}
function parseEgoResult(output) {
  const line = output.split(/\r?\n/).find((item) => item.startsWith('PERSISTD_RESULT:'));
  if (!line) throw new Error('EGO_RESULT_MISSING');
  return JSON.parse(line.slice('PERSISTD_RESULT:'.length));
}

module.exports = {
  buildSuccessorScript, buildTerminalScript, buildRenameChatsScript, buildArchiveRunChatScript, buildDiscoverRunChatsScript, buildCloseRunChatScript, buildCloseRunTargetScript, buildCleanupRunScratchTabsScript, buildPruneRunTabsScript, buildRunChatActivityScript, buildCleanupScript, buildHealthScript, parseEgoResult,
};
