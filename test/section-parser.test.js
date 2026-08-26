import test from "node:test";
import assert from "node:assert/strict";
import { classifyRegistrationMessage, extractSectionCodes, normalizeSectionCode, parseAvailability } from "../src/section-parser.js";

test("normalizes section names", () => {
  assert.equal(normalizeSectionCode(" cps-2390-w03 "), "CPS*2390*W03");
});

test("extracts unique section names", () => {
  assert.deepEqual(extractSectionCodes("CPS*2390*W01 and cps*2390*w01, ACCT*2200*W03"), ["CPS*2390*W01", "ACCT*2200*W03"]);
});

test("parses available seat counters", () => {
  assert.deepEqual(parseAvailability("Seats Available: 2 / 24 / 0"), {
    available: 2, capacity: 24, waitlisted: 0, full: false, raw: "Seats Available: 2 / 24 / 0",
  });
});

test("recognizes full sections", () => {
  assert.equal(parseAvailability("This section is full Waitlisted: 0").full, true);
  assert.equal(parseAvailability("Seats Available: 0 / 40 / 0").full, true);
});

test("classifies registration outcomes", () => {
  assert.equal(classifyRegistrationMessage("Registered, but not started").kind, "success");
  assert.equal(classifyRegistrationMessage("This section is full").kind, "full");
  assert.equal(classifyRegistrationMessage("There is a time conflict").kind, "blocking");
});
