const API_URL =
  'https://1xwh2q6cxd.execute-api.eu-west-2.amazonaws.com/prod/v1/ingestion/browser-capture';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'capture') return false;
  const mode = message.mode || 'full';
  const handler = mode === 'region' ? handleRegionCapture() : handleFullCapture();
  handler.then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleFullCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('No active tab found');

  const contentResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, files: ['content.js'],
  });
  const content = contentResults?.[0]?.result;
  if (!content?.text) throw new Error('Content extraction failed');

  let screenshot;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    screenshot = dataUrl.replace(/^data:image\/png;base64,/, '');
  } catch { /* optional */ }

  return await submitCapture(tab.url, content.text, content.html, screenshot, 'full-page');
}

async function handleRegionCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('No active tab found');

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ['region-select.js'],
    });
  } catch {
    await showToast('error', 'Could not inject region selector');
    return { success: false, error: 'Injection failed' };
  }

  const content = results?.[0]?.result;
  if (!content || content.mode === 'cancelled') {
    return { success: false, error: 'Cancelled' };
  }
  if (!content.text || !content.text.trim()) {
    await showToast('error', 'No text found in the selected region. Try a larger rectangle.');
    return { success: false, error: 'No text in region' };
  }

  let screenshot;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    screenshot = dataUrl.replace(/^data:image\/png;base64,/, '');
  } catch { /* optional */ }

  return await submitCapture(tab.url, content.text, content.html, screenshot, 'region');
}

async function submitCapture(url, text, html, screenshot, mode) {
  const payload = { url, text, html };
  if (screenshot) payload.screenshot = screenshot;

  let body, ok;
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    ok = response.ok;
    body = await response.json();
  } catch {
    await showToast('error', 'Could not reach the Waiver Hub API');
    throw new Error('Network error');
  }

  if (!ok) {
    const msg = body?.error?.message || 'Upload failed';
    await showToast('error', msg);
    throw new Error(msg);
  }

  await showToast('success', 'Waiver captured and submitted to Waiver Hub');
  return { success: true, data: body, mode };
}

async function showToast(type, message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (args) => { window.__waiverhubToastArgs = args; },
      args: [{ type, message }],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ['toast.js'],
    });
  } catch { /* page may have navigated */ }
}
