// Content script injected into the active tab to extract page content.
// If the user has selected text, capture only the selection.
// Otherwise, capture the full page.
(() => {
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : '';

  if (selectedText.length > 0) {
    // Selection mode — capture only the selected content
    let selectedHtml = '';
    if (selection.rangeCount > 0) {
      const container = document.createElement('div');
      for (let i = 0; i < selection.rangeCount; i++) {
        container.appendChild(selection.getRangeAt(i).cloneContents());
      }
      selectedHtml = container.innerHTML;
    }

    return {
      text: selectedText,
      html: selectedHtml || `<p>${selectedText}</p>`,
      mode: 'selection',
    };
  }

  // Full page mode
  return {
    text: document.body.innerText,
    html: document.documentElement.outerHTML,
    mode: 'full-page',
  };
})();
