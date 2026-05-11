import crypto from "node:crypto";

import { env } from "../../config/env.js";
import type { AttendanceDirection, BiometricMatchResult, Student } from "../../core/types.js";
import { createAttendanceRecord, getAttendanceForToday, markAttendanceExit } from "../attendance/attendance.repository.js";
import {
  findStudentById,
  listStudentsWithBiometrics,
  toDirectoryItem,
  updateStudentBiometricTemplate
} from "../students/student.repository.js";

const encryptTemplate = (template: string) =>
  crypto.createHmac("sha256", env.biometricSecret).update(template).digest("hex");

const compareTemplates = (candidate: string, storedTemplate: string) => {
  if (candidate === storedTemplate) {
    return 0.99;
  }

  const encryptedCandidate = encryptTemplate(candidate);
  const encryptedStored = encryptTemplate(storedTemplate);

  return encryptedCandidate === encryptedStored ? 0.97 : 0.18;
};

const isLateArrival = (timestamp: Date) => timestamp.getHours() > 8 || (timestamp.getHours() === 8 && timestamp.getMinutes() >= 1);

export const enrollFingerprint = async (studentId: string, rawTemplate: string) => {
  const student = await updateStudentBiometricTemplate(studentId, rawTemplate);

  if (!student) {
    throw new Error("Student not found");
  }

  return toDirectoryItem(student);
};

export const verifyFingerprint = async (
  probeTemplate: string,
  entryPoint: string,
  direction: AttendanceDirection = "entry"
): Promise<BiometricMatchResult & { duplicate: boolean; eventType: AttendanceDirection; entryTimestamp?: string; exitTimestamp?: string | null }> => {
  const students = await listStudentsWithBiometrics();
  const student = students
    .map((entry: Student) => ({ entry, confidence: compareTemplates(probeTemplate, entry.biometricTemplate ?? "") }))
    .sort((left: { entry: Student; confidence: number }, right: { entry: Student; confidence: number }) => right.confidence - left.confidence)[0];

  if (!student || student.confidence < 0.9 || !student.entry.biometricTemplate) {
    return { matched: false, confidence: student?.confidence ?? 0, duplicate: false, message: "Fingerprint not recognized", eventType: direction };
  }

  const todayAttendance = await getAttendanceForToday(student.entry.id);

  if (direction === "exit") {
    if (!todayAttendance) {
      return {
        matched: false,
        confidence: student.confidence,
        duplicate: false,
        message: "No entry attendance has been recorded yet for this student",
        eventType: "exit"
      };
    }

    if (todayAttendance.exitTimestamp) {
      return {
        matched: true,
        confidence: student.confidence,
        student: await findStudentById(student.entry.id) ?? student.entry,
        duplicate: true,
        message: "Exit has already been recorded for this student today",
        eventType: "exit",
        entryTimestamp: todayAttendance.timestamp,
        exitTimestamp: todayAttendance.exitTimestamp
      };
    }

    const updatedAttendance = await markAttendanceExit(student.entry.id);

    return {
      matched: true,
      confidence: student.confidence,
      student: await findStudentById(student.entry.id) ?? student.entry,
      duplicate: false,
      message: "Exit time recorded successfully",
      eventType: "exit",
      entryTimestamp: updatedAttendance?.timestamp ?? todayAttendance.timestamp,
      exitTimestamp: updatedAttendance?.exitTimestamp ?? null
    };
  }

  if (!todayAttendance) {
    const now = new Date();
    const createdAttendance = await createAttendanceRecord({
      studentId: student.entry.id,
      status: isLateArrival(now) ? "late" : "present",
      entryPoint,
      source: "fingerprint"
    });

    return {
      matched: true,
      confidence: student.confidence,
      student: await findStudentById(student.entry.id) ?? student.entry,
      duplicate: false,
      eventType: "entry",
      entryTimestamp: createdAttendance?.timestamp,
      exitTimestamp: createdAttendance?.exitTimestamp ?? null
    };
  }

  return {
    matched: true,
    confidence: student.confidence,
    student: await findStudentById(student.entry.id) ?? student.entry,
    duplicate: Boolean(todayAttendance),
    eventType: "entry",
    entryTimestamp: todayAttendance?.timestamp,
    exitTimestamp: todayAttendance?.exitTimestamp ?? null
  };
};

export const simulateFingerprintScan = async (studentId: string | undefined, entryPoint: string, direction: AttendanceDirection = "entry") => {
  if (!studentId) {
    return { matched: false, confidence: 0.11, duplicate: false, message: "No student selected for the simulated fingerprint", eventType: direction };
  }

  const student = await findStudentById(studentId);

  if (!student?.biometricTemplate) {
    return { matched: false, confidence: 0.11, duplicate: false, message: "No fingerprint is enrolled yet for this student", eventType: direction };
  }

  return verifyFingerprint(student.biometricTemplate, entryPoint, direction);
};
