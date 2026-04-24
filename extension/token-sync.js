// Runs on waiverhub.info pages — syncs auth token to chrome.storage.local
// so the extension can use it when capturing from other sites.
(function syncToken() {
  try {
    const raw = sessionStorage.getItem('auth_tokens');
    if (!raw) return;
    const tokens = JSON.parse(raw);
    if (tokens.id_token) {
      chrome.storage.local.set({ waiverhub_id_token: tokens.id_token });
    }
  } catch { /* ignore */ }
})();

// Re-sync periodically in case the token refreshes
setInterval(() => {
  try {
    const raw = sessionStorage.getItem('auth_tokens');
    if (!raw) return;
    const tokens = JSON.parse(raw);
    if (tokens.id_token) {
      chrome.storage.local.set({ waiverhub_id_token: tokens.id_token });
    }
  } catch { /* ignore */ }
}, 30000);
