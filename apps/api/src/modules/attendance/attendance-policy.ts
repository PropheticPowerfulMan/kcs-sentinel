import type { OrbitPerson } from "../integration/directory.js";

export const SCHOOL_TIMEZONE = "Africa/Kinshasa";

export type AttendancePolicy = {
  category: "STUDENT" | "EMPLOYEE" | "OTHER";
  arrivalWindowStart: string | null;
  arrivalDeadline: string | null;
  courseStart: string | null;
  officialEnd: string | null;
  lateAfterMinutes: number | null;
};

const STUDENT_POLICY: AttendancePolicy = {
  category: "STUDENT",
  arrivalWindowStart: "07:30",
  arrivalDeadline: "08:00",
  courseStart: "08:00",
  officialEnd: "14:00",
  lateAfterMinutes: 8 * 60,
};

const EMPLOYEE_POLICY: AttendancePolicy = {
  category: "EMPLOYEE",
  arrivalWindowStart: "07:00",
  arrivalDeadline: "07:30",
  courseStart: "08:00",
  officialEnd: "15:30",
  lateAfterMinutes: 7 * 60 + 30,
};

const OTHER_POLICY: AttendancePolicy = {
  category: "OTHER",
  arrivalWindowStart: null,
  arrivalDeadline: null,
  courseStart: null,
  officialEnd: null,
  lateAfterMinutes: null,
};

export function attendancePolicyFor(person: Pick<OrbitPerson, "kind"> | null | undefined): AttendancePolicy {
  if (person?.kind === "STUDENT") return STUDENT_POLICY;
  if (person?.kind === "TEACHER" || person?.kind === "STAFF") return EMPLOYEE_POLICY;
  return OTHER_POLICY;
}

export function kinshasaClockParts(date: Date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SCHOOL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function kinshasaDateKey(date: Date) {
  const parts = kinshasaClockParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function kinshasaClockMinutes(date: Date) {
  const parts = kinshasaClockParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function isLateArrivalFor(person: Pick<OrbitPerson, "kind"> | null | undefined, date: Date) {
  const deadline = attendancePolicyFor(person).lateAfterMinutes;
  return deadline !== null && kinshasaClockMinutes(date) > deadline;
}
