// Injected into the page to show a toast notification after capture.
// The background worker passes the message via args.
(() => {
  // Remove any existing toast
  const existing = document.getElementById('waiverhub-toast');
  if (existing) existing.remove();

  // Get the message from the injected args (set by background.js)
  const args = window.__waiverhubToastArgs || { type: 'success', message: 'Captured successfully' };
  delete window.__waiverhubToastArgs;

  const toast = document.createElement('div');
  toast.id = 'waiverhub-toast';

  const isError = args.type === 'error';
  const bg = isError ? '#cf222e' : '#1a7f37';

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '2147483647',
    background: bg,
    color: '#fff',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: '500',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: '400px',
    lineHeight: '1.4',
    transition: 'opacity 0.3s, transform 0.3s',
    opacity: '0',
    transform: 'translateY(10px)',
  });

  const icon = isError ? '❌' : '✅';
  const textSpan = document.createElement('span');
  textSpan.textContent = `${icon} ${args.message}`;
  toast.appendChild(textSpan);

  const closeBtn = document.createElement('button');
  Object.assign(closeBtn.style, {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: '4px',
    marginLeft: '4px',
    flexShrink: '0',
  });
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => toast.remove();
  toast.appendChild(closeBtn);

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 8000);
})();
