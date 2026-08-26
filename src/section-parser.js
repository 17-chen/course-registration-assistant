export const SECTION_CODE_PATTERN = /\b[A-Z]{2,}(?:\*|-)[A-Z0-9]+(?:\*|-)[A-Z0-9]+\b/gi;

export function normalizeSectionCode(value = "") {
  return String(value).trim().toUpperCase().replaceAll("-", "*");
}

export function extractSectionCodes(text = "") {
  const matches = String(text).toUpperCase().match(SECTION_CODE_PATTERN) ?? [];
  return [...new Set(matches.map(normalizeSectionCode))];
}

export function parseAvailability(text = "") {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  const seats = normalized.match(/Seats?\s+Available\s*:?\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/i);
  const full = /This\s+section\s+is\s+full|\bClosed\b/i.test(normalized);
  if (!seats) {
    return { available: null, capacity: null, waitlisted: null, full, raw: normalized };
  }
  return {
    available: Number(seats[1]),
    capacity: Number(seats[2]),
    waitlisted: Number(seats[3]),
    full: full || Number(seats[1]) <= 0,
    raw: normalized,
  };
}

export function classifyRegistrationMessage(text = "") {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (/Registered,?\s+but\s+not\s+started|Registration\s+(?:was\s+)?successful|Successfully\s+registered/i.test(normalized)) {
    return { kind: "success", message: normalized };
  }
  if (/section\s+is\s+full|no\s+seats|closed|capacity/i.test(normalized)) {
    return { kind: "full", message: normalized };
  }
  if (/conflict|prerequisite|requisite|credit\s+limit|consent|permission|not\s+eligible/i.test(normalized)) {
    return { kind: "blocking", message: normalized };
  }
  return { kind: "unknown", message: normalized };
}
