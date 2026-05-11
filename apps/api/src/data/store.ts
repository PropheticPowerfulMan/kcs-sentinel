import crypto from "node:crypto";

import type { AttendanceRecord, Student } from "../core/types.js";

const fingerprintKey = "fp:school-main:";

export const studentSeeds: Student[] = [
  {
    id: "STD-001",
    fullName: "Amina Diallo",
    className: "Grade 6 - A",
    guardianPhone: "+225070000001",
    biometricTemplate: `${fingerprintKey}amina`
  },
  {
    id: "STD-002",
    fullName: "Noah Mensah",
    className: "Grade 7 - C",
    guardianPhone: "+225070000002",
    biometricTemplate: `${fingerprintKey}noah`
  },
  {
    id: "STD-003",
    fullName: "Leila Kouassi",
    className: "Grade 5 - B",
    guardianPhone: "+225070000003",
    biometricTemplate: `${fingerprintKey}leila`
  },
  {
    id: "STD-004",
    fullName: "Jayden Okoro",
    className: "Grade 8 - A",
    guardianPhone: "+225070000004",
    biometricTemplate: undefined
  }
];

const today = new Date();

export const attendanceSeeds: AttendanceRecord[] = [
  {
    id: crypto.randomUUID(),
    studentId: "STD-001",
    status: "present",
    timestamp: new Date(today.setHours(7, 12, 0, 0)).toISOString(),
    entryPoint: "Main Gate A",
    source: "fingerprint"
  },
  {
    id: crypto.randomUUID(),
    studentId: "STD-002",
    status: "late",
    timestamp: new Date(today.setHours(8, 4, 0, 0)).toISOString(),
    entryPoint: "Main Gate A",
    source: "fingerprint"
  }
];
