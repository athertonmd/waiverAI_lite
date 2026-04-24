// Region selection overlay — draws a rectangle and captures text within it.
(() => {
  const existing = document.getElementById('waiverhub-region-overlay');
  if (existing) existing.remove();

  return new Promise((resolve) => {
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
        resolve({ text: '', html: '', mode: 'region', region: null });
        return;
      }

      // Simple approach: get all elements, check overlap, collect text
      const allEls = document.body.querySelectorAll('*');
      const parts = [];

      for (const el of allEls) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Must overlap with selection
        if (r.right < rect.left || r.left > rect.right) continue;
        if (r.bottom < rect.top || r.top > rect.bottom) continue;

        // Collect direct text nodes only (avoids duplication from parent elements)
        let directText = '';
        for (const child of el.childNodes) {
          if (child.nodeType === 3) directText += child.textContent;
        }
        directText = directText.trim();
        if (directText.length > 0) {
          parts.push({ text: directText, top: r.top });
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

      const text = unique.map(p => p.text).join('\n');
      const html = '<div>' + unique.map(p => '<p>' + p.text + '</p>').join('') + '</div>';

      resolve({ text, html, mode: 'region', region: rect });
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve({ text: '', html: '', mode: 'cancelled', region: null });
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  });
})();
