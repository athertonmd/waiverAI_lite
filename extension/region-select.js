// Region selection overlay — injected into the page when user clicks "Select Region"
// Draws a rectangle overlay and captures all text elements within the selected area.
(() => {
  // Remove any existing overlay
  const existing = document.getElementById('waiverhub-region-overlay');
  if (existing) existing.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'waiverhub-region-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      zIndex: '2147483647', cursor: 'crosshair', background: 'rgba(0,0,0,0.1)',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'fixed', border: '2px solid #0066cc', background: 'rgba(0,102,204,0.08)',
      pointerEvents: 'none', display: 'none',
    });
    overlay.appendChild(box);

    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
      background: '#0066cc', color: '#fff', padding: '8px 16px', borderRadius: '6px',
      fontSize: '14px', fontWeight: '600', fontFamily: 'system-ui, sans-serif',
      zIndex: '2147483647', pointerEvents: 'none',
    });
    label.textContent = 'Draw a rectangle around the waiver content. Press Esc to cancel.';
    overlay.appendChild(label);

    let startX = 0, startY = 0, drawing = false;

    overlay.addEventListener('mousedown', (e) => {
      startX = e.clientX; startY = e.clientY; drawing = true;
      box.style.display = 'block';
      box.style.left = startX + 'px'; box.style.top = startY + 'px';
      box.style.width = '0'; box.style.height = '0';
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
      box.style.left = x + 'px'; box.style.top = y + 'px';
      box.style.width = w + 'px'; box.style.height = h + 'px';
    });

    overlay.addEventListener('mouseup', (e) => {
      if (!drawing) return;
      drawing = false;

      const rect = {
        left: Math.min(e.clientX, startX),
        top: Math.min(e.clientY, startY),
        right: Math.max(e.clientX, startX),
        bottom: Math.max(e.clientY, startY),
      };

      // Remove overlay before capturing
      overlay.remove();

      // Too small — treat as a click, not a drag
      if (rect.right - rect.left < 20 || rect.bottom - rect.top < 20) {
        resolve({ text: '', html: '', mode: 'region', region: null });
        return;
      }

      // Find all text nodes/elements within the rectangle
      const textParts = [];
      const htmlParts = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node;

      while ((node = walker.nextNode())) {
        const el = node;
        const elRect = el.getBoundingClientRect();

        // Check if element overlaps with the selection rectangle
        if (elRect.right < rect.left || elRect.left > rect.right ||
            elRect.bottom < rect.top || elRect.top > rect.bottom) continue;
        if (elRect.width === 0 || elRect.height === 0) continue;

        const text = el.innerText?.trim();
        if (text && text.length > 0 && !el.querySelector('*[innerText]')) {
          // Leaf-ish element with text
          textParts.push(text);
          htmlParts.push(el.outerHTML);
        }
      }

      // Deduplicate (parent elements may include child text)
      const uniqueText = [...new Set(textParts)].join('\n');

      resolve({
        text: uniqueText,
        html: htmlParts.join('\n'),
        mode: 'region',
        region: rect,
      });
    });

    // Esc to cancel
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKeyDown);
        resolve({ text: '', html: '', mode: 'cancelled', region: null });
      }
    };
    document.addEventListener('keydown', onKeyDown);

    document.body.appendChild(overlay);
  });
})();
