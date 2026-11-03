/**
 * DSH Sidebar background service worker.
 * Keeps this file intentionally small: the side panel owns the bridge
 * connection and the browser tools, because it has full extension API access
 * while it is open and is the surface the user is looking at.
 */
const MENU_PAGE = 'dsh-sidebar-ask-page'
const MENU_SELECTION = 'dsh-sidebar-ask-selection'

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  } catch (error) {
    console.warn('[dsh] sidePanel behavior', error)
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: '用 DSH 总结这个页面', contexts: ['page'] })
    chrome.contextMenus.create({ id: MENU_SELECTION, title: '用 DSH 解释选中内容', contexts: ['selection'] })
  })
})

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    if (tab?.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId })
  } catch (error) {
    console.warn('[dsh] open side panel', error)
  }
})

async function askFromMenu(info, tab) {
  const pending = {
    text: info.menuItemId === MENU_SELECTION ? `请解释这段选中内容，并说明它在这页里的作用：\n\n${info.selectionText}` : '',
    selection: info.selectionText ?? '',
    url: tab?.url ?? '',
    at: Date.now(),
  }
  await chrome.storage.session.set({ pendingAsk: pending })
  try {
    if (tab?.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId })
  } catch (error) {
    console.warn('[dsh] context menu open', error)
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => { void askFromMenu(info, tab) })

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'dsh:pending-ask') {
    chrome.storage.session.get('pendingAsk').then(({ pendingAsk }) => {
      sendResponse({ ok: true, pendingAsk: pendingAsk ?? null })
    })
    return true
  }
  if (message?.type === 'dsh:clear-pending-ask') {
    chrome.storage.session.remove('pendingAsk').then(() => sendResponse({ ok: true }))
    return true
  }
  return undefined
})
