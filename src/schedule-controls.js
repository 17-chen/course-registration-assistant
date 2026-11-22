// Self-contained DOM operation shared by Chromium and Safari's executeScript.
export function scheduleControl({ action = "read", expectedTerm = "", direction = "next" } = {}) {
  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const visible = (el) => el.getClientRects().length > 0;
  const enabled = (el) => !el.disabled && el.getAttribute("aria-disabled") !== "true" && !el.classList.contains("disabled");
  const busy = action === "register" && !expectedTerm ? false : [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible) || /Refreshing registration eligibility|Updating\s+schedule|Processing\s+complete[.]?\s+Refreshing/i.test(document.body?.innerText || "");
  let current = null;
  if (action !== "register" || expectedTerm) {
    const labels = [...document.querySelectorAll("span, div, p, label, h1, h2, h3, h4")]
      .filter((el) => visible(el) && /^(Spring|Summer|Fall|Winter)\s+\d{4}(?:\s+[\w .-]+)?$/i.test(clean(el.innerText)))
      .sort((a, b) => {
        const x = a.getBoundingClientRect();
        const y = b.getBoundingClientRect();
        return x.width * x.height - y.width * y.height;
      });
    const matches = [];
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      let parent = label.parentElement;
      for (let level = 0; parent && level < 5; level++, parent = parent.parentElement) {
        // The observed school layout has two arrow buttons immediately left
        // of the term label. Use their live geometry, never fixed coordinates.
        const arrows = [...parent.querySelectorAll('button, a[role="button"], [role="button"]')]
          .filter((el) => {
            if (!visible(el)) return false;
            const b = el.getBoundingClientRect();
            const text = clean(el.innerText);
            const name = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`;
            return b.width > 0 && b.width <= 100 && b.height <= 100 && b.right <= rect.left + 2
              && Math.abs((b.top + b.bottom - rect.top - rect.bottom) / 2) <= Math.max(b.height, rect.height)
              && (!text || /^[‹›<>←→❮❯]$/.test(text) || /^(?:next|previous|prev)(?:\s+(?:term|semester))?$/i.test(text) || /(?:next|previous|prev).*?(?:term|semester)/i.test(name));
          }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        if (arrows.length !== 2) continue;
        matches.push({ term: clean(label.innerText), previous: arrows[0], next: arrows[1] });
        break;
      }
    }
    if (new Set(matches.map((item) => item.term.toLowerCase())).size === 1) current = matches[0];
  }
  const term = current?.term || null;
  const sameTerm = !expectedTerm || term?.toLowerCase() === clean(expectedTerm).toLowerCase();
  if (action === "navigate") {
    const button = current?.[direction];
    if (!sameTerm || !button || !enabled(button)) return { term, clicked: false };
    button.click();
    return { term, clicked: true };
  }
  if (action === "register") {
    if (!sameTerm || busy) return { term, clicked: false };
    const candidates = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
    const target = candidates.find((el) => clean(el.innerText || el.value).toLowerCase() === "register now" && visible(el) && enabled(el));
    if (!target) return { term, clicked: false };
    target.click();
    return { term, clicked: true };
  }
  return { term, busy, nextEnabled: Boolean(current && enabled(current.next)), previousEnabled: Boolean(current && enabled(current.previous)) };
}
