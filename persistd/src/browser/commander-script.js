function buildCommanderSetupScript() {
  return `
// PERSISTD_COMMANDER_BOOTSTRAP_V1
const commanderAttached = async () => Boolean(await composer.evaluate((el) => {
  const pills = [...el.querySelectorAll('[data-inline-selection-pill][data-id^="plugin:"]')]
  return pills.some((pill) => {
    const keyword = String(pill.getAttribute('data-keyword') || pill.innerText || '').trim()
    return keyword === 'Remote Desktop Commander' || keyword.includes('Desktop Commander')
  })
}))
if (!(await commanderAttached())) {
  let attachButton = page.getByTestId('composer-plus-btn')
  if ((await attachButton.count()) === 0) attachButton = page.getByRole('button', { name: /adicionar arquivos e mais|attach files|add files|tools/i })
  if ((await attachButton.count()) === 0) throw new Error('ChatGPT tools button not found')
  if ((await attachButton.first().getAttribute('aria-expanded')) !== 'true') await attachButton.first().evaluate((el) => el.click())
  await page.waitForTimeout(250)
  const pluginSearch = page.locator('input[placeholder*="plugins"], input[placeholder*="Plugins"]')
  if ((await pluginSearch.count()) > 0 && await pluginSearch.first().isVisible()) await pluginSearch.first().fill('Remote Desktop Commander')
  else await page.keyboard.type('Remote Desktop Commander')
  const commander = page.getByText('Remote Desktop Commander', { exact: true })
  let commanderClicked = false
  for (let i = 0; i < await commander.count(); i++) {
    if (!(await commander.nth(i).isVisible())) continue
    await commander.nth(i).evaluate((el) => el.click())
    commanderClicked = true
    break
  }
  if (!commanderClicked) throw new Error('Remote Desktop Commander option not found')
  const verified = await page.waitForFunction(() => {
    const el = document.querySelector('#prompt-textarea') || document.querySelector('[role="textbox"][contenteditable="true"]')
    if (!el) return false
    return [...el.querySelectorAll('[data-inline-selection-pill][data-id^="plugin:"]')].some((pill) => {
      const keyword = String(pill.getAttribute('data-keyword') || pill.innerText || '').trim()
      return keyword === 'Remote Desktop Commander' || keyword.includes('Desktop Commander')
    })
  }, undefined, { timeout: 5000 })
  if (!verified) throw new Error('Remote Desktop Commander attachment not verified')
}
`;
}

module.exports = { buildCommanderSetupScript };


