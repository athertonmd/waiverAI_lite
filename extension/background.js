const API_URL =
  'https://1xwh2q6cxd.execute-api.eu-west-2.amazonaws.com/prod/v1/ingestion/browser-capture';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'regionResult') {
    // Region selection completed — submit the captured text directly
    handleRegionResult(message);
    return false;
  }
  if (message.action !== 'capture') return false;
  const mode = message.mode || 'full';
  if (mode === 'region') {
    // Just inject the region selector — the result will come back as a separate 'regionResult' message
    startRegionCapture();
    sendResponse({ success: true, pending: true });
    return false;
  }
  // Full page capture
  handleFullCapture().then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});

async function startRegionCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ['region-select.js'],
    });
  } catch {
    await showToast('error', 'Could not inject region selector');
  }
}

async function handleRegionResult(content) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  console.log('[WaiverHub] Region result received:', { mode: content.mode, textLength: content.text?.length, url });

  if (!content || content.mode === 'cancelled') {
    return;
  }
  if (!content.text || !content.text.trim()) {
    await showToast('error', 'No text found in the selected region. Try a larger rectangle.');
    return;
  }

  console.log('[WaiverHub] Submitting region capture, text preview:', content.text.substring(0, 200));

  try {
    await submitCapture(url, content.text, content.html, undefined, 'region');
  } catch (err) {
    // Toast already shown by submitCapture
  }
}

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

async function submitCapture(url, text, html, screenshot, mode) {
  const payload = { url, text, html };
  if (screenshot) payload.screenshot = screenshot;

  const token = await getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body, ok;
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers,
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

async function getAuthToken() {
  try {
    const result = await chrome.storage.local.get('waiverhub_id_token');
    return result.waiverhub_id_token || null;
  } catch {
    return null;
  }
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
