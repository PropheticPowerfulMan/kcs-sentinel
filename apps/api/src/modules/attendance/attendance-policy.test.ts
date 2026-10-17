import assert from "node:assert/strict";
import test from "node:test";
import { attendancePolicyFor, isLateArrivalFor } from "./attendance-policy.js";

const atKinshasaClock = (hour: number, minute: number) => new Date(Date.UTC(2026, 9, 19, hour - 1, minute));

test("students are late only after 08:00 Kinshasa time", () => {
  const student = { kind: "STUDENT" as const };
  assert.equal(isLateArrivalFor(student, atKinshasaClock(8, 0)), false);
  assert.equal(isLateArrivalFor(student, atKinshasaClock(8, 1)), true);
  assert.equal(attendancePolicyFor(student).officialEnd, "14:00");
});

test("employees are late only after 07:30 Kinshasa time", () => {
  for (const kind of ["TEACHER", "STAFF"] as const) {
    assert.equal(isLateArrivalFor({ kind }, atKinshasaClock(7, 30)), false);
    assert.equal(isLateArrivalFor({ kind }, atKinshasaClock(7, 31)), true);
    assert.equal(attendancePolicyFor({ kind }).officialEnd, "15:30");
  }
});

test("parents and visitors do not receive employee punctuality rules", () => {
  assert.equal(isLateArrivalFor({ kind: "PARENT" }, atKinshasaClock(10, 0)), false);
  assert.equal(attendancePolicyFor({ kind: "PARENT" }).lateAfterMinutes, null);
});
