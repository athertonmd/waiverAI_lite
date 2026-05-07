// Region selection overlay — draws a rectangle and captures text within it.
(() => {
  const existing = document.getElementById('waiverhub-region-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'waiverhub-region-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
    zIndex: '2147483647', cursor: 'crosshair', background: 'rgba(0,0,0,0.05)',
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', border: '2px dashed #0066cc', background: 'rgba(0,102,204,0.06)',
    pointerEvents: 'none', display: 'none', borderRadius: '4px',
  });
  overlay.appendChild(box);

  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
    background: '#0066cc', color: '#fff', padding: '8px 16px', borderRadius: '6px',
    fontSize: '14px', fontWeight: '600', fontFamily: 'system-ui, sans-serif',
    pointerEvents: 'none',
  });
  label.textContent = 'Draw a rectangle around the waiver. Press Esc to cancel.';
  overlay.appendChild(label);

  let startX = 0, startY = 0, drawing = false;

  overlay.addEventListener('mousedown', (e) => {
    startX = e.clientX; startY = e.clientY; drawing = true;
    box.style.display = 'block';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
    box.style.left = x + 'px'; box.style.top = y + 'px';
    box.style.width = Math.abs(e.clientX - startX) + 'px';
    box.style.height = Math.abs(e.clientY - startY) + 'px';
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false;
    overlay.remove();

    const rect = {
      left: Math.min(e.clientX, startX),
      top: Math.min(e.clientY, startY),
      right: Math.max(e.clientX, startX),
      bottom: Math.max(e.clientY, startY),
    };

    if (rect.right - rect.left < 20 || rect.bottom - rect.top < 20) {
      chrome.runtime.sendMessage({ action: 'regionResult', text: '', html: '', mode: 'region', region: null });
      return;
    }

    // Walk all text nodes and check if they fall within the selection rectangle
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const parts = [];

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const text = textNode.textContent.trim();
      if (!text) continue;

      // Get the bounding rect of this text node using a Range
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = range.getClientRects();

      for (const r of rects) {
        if (r.width === 0 || r.height === 0) continue;

        // Check if this text rect overlaps with the selection
        if (r.right < rect.left || r.left > rect.right) continue;
        if (r.bottom < rect.top || r.top > rect.bottom) continue;

        // At least partially inside the rectangle
        parts.push({ text, top: r.top });
        break; // Only add once per text node
      }
    }

    // Sort top to bottom, deduplicate
    parts.sort((a, b) => a.top - b.top);
    const seen = new Set();
    const unique = parts.filter(p => {
      if (seen.has(p.text)) return false;
      seen.add(p.text);
      return true;
    });

    const regionText = unique.map(p => p.text).join('\n');

    // Add page context to help extraction identify the correct waiver
    const pageTitle = document.title || '';
    const pageUrl = window.location.href;
    // Try to extract airline name from page title or meta tags
    const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
    // Find the closest heading above the selection region
    let nearestHeading = '';
    const headings = document.querySelectorAll('h1, h2, h3');
    for (const h of headings) {
      const hRect = h.getBoundingClientRect();
      if (hRect.bottom <= rect.top && h.textContent.trim()) {
        nearestHeading = h.textContent.trim();
      }
    }

    const contextLines = [
      `[Source: ${pageUrl}]`,
      `[Page Title: ${pageTitle}]`,
      nearestHeading ? `[Section: ${nearestHeading}]` : '',
      `[Note: Extract ONLY the waiver described in the text below. Do not infer data from other waivers on the same page.]`,
      '',
    ].filter(Boolean).join('\n');

    const text = contextLines + regionText;
    const html = '<div>' + unique.map(p => '<p>' + p.text + '</p>').join('') + '</div>';

    chrome.runtime.sendMessage({ action: 'regionResult', text, html, mode: 'region', region: rect });
  });

  const onKey = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      chrome.runtime.sendMessage({ action: 'regionResult', text: '', html: '', mode: 'cancelled', region: null });
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
})();
