import type { AttendanceFrequencySummary, AttendanceLedgerItem, AttendanceMetrics, StudentDisciplinaryRegister, AttendanceSummaryPeriod } from "../../core/types.js";
import { getStudentAttendanceCountsForPeriod, getTodayAttendanceCounts, listAttendanceLedger, listRecentAttendance, listStudentAttendanceLedger } from "./attendance.repository.js";
import { listStudents } from "../students/student.repository.js";
import { findStudentById, toDirectoryItem } from "../students/student.repository.js";
import { listSchoolCalendarDaysInRange } from "../calendar/calendar.repository.js";

export const getTodayMetrics = async (): Promise<AttendanceMetrics> => {
  const [{ present, late }, students] = await Promise.all([getTodayAttendanceCounts(), listStudents()]);
  const totalStudents = students.length;

  return {
    totalStudents,
    present,
    late,
    absent: Math.max(totalStudents - present - late, 0),
    biometricSuccessRate: totalStudents === 0 ? 0 : Number((((present + late) / totalStudents) * 100).toFixed(1))
  };
};

export const getLiveAttendanceFeed = async () => listRecentAttendance(8);

export const getAttendanceLedger = async (): Promise<AttendanceLedgerItem[]> => listAttendanceLedger(32);

const toDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfWeek = (value: Date) => {
  const copy = new Date(value);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const startOfMonth = (value: Date) => {
  const copy = new Date(value);
  copy.setDate(1);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const startOfYear = (value: Date) => {
  const copy = new Date(value);
  copy.setMonth(0, 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const countSchoolDays = async (startDate: Date, endDate: Date) => {
  const overrides = await listSchoolCalendarDaysInRange(toDateKey(startDate), toDateKey(endDate));
  const overrideMap = new Map(overrides.map((item) => [item.date, item.isSchoolDay]));
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  let total = 0;
  while (cursor <= end) {
    const dateKey = toDateKey(cursor);
    const override = overrideMap.get(dateKey);
    const defaultSchoolDay = cursor.getDay() !== 0 && cursor.getDay() !== 6;
    const isSchoolDay = override ?? defaultSchoolDay;

    if (isSchoolDay) {
      total += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
};

const buildPeriodSummary = async (studentId: string, period: AttendanceSummaryPeriod, label: string, startDate: Date, endDate: Date): Promise<AttendanceFrequencySummary> => {
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  const { presentCount, lateCount, attendanceCount } = await getStudentAttendanceCountsForPeriod(studentId, startKey, endKey);
  const expectedSchoolDays = await countSchoolDays(startDate, endDate);
  const absentCount = Math.max(expectedSchoolDays - attendanceCount, 0);
  const frequencyRate = expectedSchoolDays === 0 ? 0 : Number(((attendanceCount / expectedSchoolDays) * 100).toFixed(1));

  return {
    period,
    label,
    startDate: startKey,
    endDate: endKey,
    expectedSchoolDays,
    attendanceCount,
    presentCount,
    lateCount,
    absentCount,
    frequencyRate
  };
};

export const getStudentDisciplinaryRegister = async (studentId: string): Promise<StudentDisciplinaryRegister | null> => {
  const student = await findStudentById(studentId);

  if (!student) {
    return null;
  }

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const [daily, weekly, monthly, yearly, history] = await Promise.all([
    buildPeriodSummary(studentId, "daily", "Bilan journalier", today, today),
    buildPeriodSummary(studentId, "weekly", "Bilan hebdomadaire", startOfWeek(now), today),
    buildPeriodSummary(studentId, "monthly", "Bilan mensuel", startOfMonth(now), today),
    buildPeriodSummary(studentId, "yearly", "Bilan annuel", startOfYear(now), today),
    listStudentAttendanceLedger(studentId, 120)
  ]);

  return {
    student: toDirectoryItem(student),
    generatedAt: new Date().toISOString(),
    summaries: [daily, weekly, monthly, yearly],
    history
  };
};
