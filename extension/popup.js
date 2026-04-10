const WAIVER_HUB_UI = 'http://localhost:5173/waivers';

const urlEl = document.getElementById('url');
const captureFullBtn = document.getElementById('captureFullBtn');
const captureRegionBtn = document.getElementById('captureRegionBtn');
const statusEl = document.getElementById('status');

function isCapturableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Initialise popup
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const tabUrl = tab?.url || '';
  urlEl.textContent = tabUrl || 'Unknown page';

  if (!isCapturableUrl(tabUrl)) {
    captureFullBtn.disabled = true;
    captureRegionBtn.disabled = true;
    statusEl.className = 'error';
    statusEl.textContent = 'This page cannot be captured (only HTTP/HTTPS pages are supported)';
  }
});

captureFullBtn.addEventListener('click', () => {
  disableButtons();
  statusEl.className = 'loading';
  statusEl.textContent = 'Capturing full page…';

  chrome.runtime.sendMessage({ action: 'capture', mode: 'full' }, handleResponse);
});

captureRegionBtn.addEventListener('click', () => {
  disableButtons();
  statusEl.className = 'loading';
  statusEl.textContent = 'Draw a rectangle on the page…';

  // Close the popup so the user can interact with the page
  chrome.runtime.sendMessage({ action: 'capture', mode: 'region' });
  window.close();
});

function handleResponse(response) {
  if (chrome.runtime.lastError) {
    showError(chrome.runtime.lastError.message);
    return;
  }
  if (response?.success) {
    const modeLabel = response.mode === 'region' ? 'Region' : response.mode === 'selection' ? 'Selection' : 'Full page';
    statusEl.className = 'success';
    statusEl.innerHTML = `${modeLabel} captured successfully. <a href="${WAIVER_HUB_UI}" target="_blank">View in Waiver Hub</a>`;
  } else {
    showError(response?.error || 'Unknown error');
  }
}

function disableButtons() {
  captureFullBtn.disabled = true;
  captureRegionBtn.disabled = true;
}

function showError(message) {
  captureFullBtn.disabled = false;
  captureRegionBtn.disabled = false;
  statusEl.className = 'error';
  statusEl.textContent = message;
}
