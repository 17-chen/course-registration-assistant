// Serialized for both Chromium and Safari; all dependencies are passed explicitly.
export function monitorControl(input, scheduleControl) {
  const { action = "read", code, expectedTerm, intent } = input;
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => el.getClientRects().length > 0;
  const enabled = (el) => !el.disabled && el.getAttribute("aria-disabled") !== "true" && !el.classList.contains("disabled");
  const codeOf = (s) => clean(s).toUpperCase().replaceAll("-", "*").match(/\b[A-Z]{2,}\*[A-Z0-9]+\*[A-Z0-9]+\b/)?.[0];
  const name = (el) => clean(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value);
  const term = scheduleControl({ action: "read" });
  if (!expectedTerm || term.term?.toLowerCase() !== expectedTerm.toLowerCase() || term.busy) return { safe: false, found: false, clicked: false };
  const links = [...document.querySelectorAll("a")].filter((el) => visible(el) && codeOf(name(el)) === code && /^Details for\b/i.test(name(el)));
  if (links.length !== 1) return { safe: true, found: false, clicked: false };
  const link = links[0];
  let card = link.parentElement;
  // Stop before a parent that contains another course card. Calendar references
  // and other-section previews are never used as the primary card.
  while (card?.parentElement && card.parentElement !== document.body) {
    const parent = card.parentElement;
    const titles = [...parent.querySelectorAll("a")].filter((el) => visible(el) && /^Details for\b/i.test(name(el)));
    if (titles.length !== 1) break;
    card = parent;
  }
  if (!card) return { safe: true, found: false, clicked: false };
  const text = clean(card.innerText);
  const buttons = [...card.querySelectorAll('button, a, input[type="button"], input[type="submit"]')].filter((el) => visible(el) && enabled(el));
  const accepts = (el, type) => {
    const n = name(el);
    const label = clean(el.innerText || el.value);
    if (/\b(drop|remove|cancel)\b/i.test(n + " " + label)) return false;
    const buttonCode = codeOf(n);
    if (buttonCode && buttonCode !== code) return false;
    const sameCode = buttonCode === code;
    return type === "waitlist"
      ? /^(?:waitlist|add to waitlist|join waitlist)$/i.test(label) || (sameCode && /^(?:waitlist|add to waitlist|join waitlist)\b/i.test(n))
      : /^(?:register|register now)$/i.test(label) || (sameCode && /^register(?:\s+(?:for|section))?\s/i.test(n));
  };
  const register = buttons.find((el) => accepts(el, "register"));
  const waitlist = buttons.find((el) => accepts(el, "waitlist"));
  const registered = /\bRegistered\b/i.test(text) && !/\bnot registered\b/i.test(text);
  const waitlisted = buttons.some((el) => /^Drop Waitlist\b/i.test(name(el))) || /\bWaitlisted\b(?!\s*:)/i.test(text);
  const snapshot = { safe: true, found: true, text, registered, waitlisted, canRegister: Boolean(register), canWaitlist: Boolean(waitlist), clicked: false };
  const dialogs = [...document.querySelectorAll('[role="dialog"], .modal')].filter(visible);
  // Some school dialogs lack role=dialog; locate only the named details close control.
  const close = [...document.querySelectorAll("button")].find((el) => visible(el) && /^(?:Close Section Details|Close)$/i.test(name(el)));
  let details = dialogs.find((el) => /Section Details/i.test(el.innerText));
  if (!details && close) {
    let parent = close.parentElement;
    while (parent && parent !== document.body) {
      if (/Section Details/i.test(parent.innerText) && /Seats? Available|Retrieving information/i.test(parent.innerText)) { details = parent; break; }
      parent = parent.parentElement;
    }
  }
  if (action === "open-details") {
    if (details || close) return { ...snapshot, blocked: true };
    link.click();
    return { ...snapshot, clicked: true };
  }
  if (action === "details") {
    const detailText = clean(details?.innerText);
    return { ...snapshot, ready: Boolean(details && codeOf(detailText) === code && detailText.includes(expectedTerm) && /Seats? Available/i.test(detailText)), detailText };
  }
  if (action === "close-details") {
    if (details && codeOf(details.innerText) === code && close) { close.click(); return { ...snapshot, clicked: true }; }
    return snapshot;
  }
  if (action === "submit") {
    if (registered || details || close || (intent === "waitlist" && waitlisted)) return snapshot;
    if (intent === "register" && waitlisted && !register) return snapshot;
    if (intent === "waitlist") {
      if (!waitlist) return snapshot;
      waitlist.click();
      return { ...snapshot, clicked: true, via: "section" };
    }
    if (intent !== "register") return snapshot;
    // Registration uses Register Now; joining a waitlist never uses this entry point.
    const result = scheduleControl({ action: "register", expectedTerm });
    return { ...snapshot, clicked: result.clicked, via: "global" };
  }
  return snapshot;
}
