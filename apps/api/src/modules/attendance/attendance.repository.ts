import crypto from "node:crypto";

import type { AttendanceLedgerItem, AttendanceRecord, AttendanceStatus } from "../../core/types.js";
import { pool } from "../../db/pool.js";

type AttendanceRow = {
  id: string;
  student_id: string;
  status: AttendanceStatus;
  timestamp: string;
  exit_timestamp?: string | null;
  attendance_day: string;
  entry_point: string;
  source: "fingerprint" | "manual" | "sync";
  student_name?: string;
  class_name?: string;
};

type AttendanceAggregateRow = {
  present: string;
  late: string;
};

const toAttendanceRecord = (row: AttendanceRow): AttendanceRecord => ({
  id: row.id,
  studentId: row.student_id,
  status: row.status,
  timestamp: row.timestamp,
  exitTimestamp: row.exit_timestamp ?? null,
  entryPoint: row.entry_point,
  source: row.source
});

const toAttendanceLedgerItem = (row: AttendanceRow): AttendanceLedgerItem => ({
  id: row.id,
  studentId: row.student_id,
  studentName: row.student_name ?? "Unknown student",
  className: row.class_name ?? "Unknown class",
  status: row.status,
  attendanceDate: row.attendance_day,
  entryTimestamp: row.timestamp,
  exitTimestamp: row.exit_timestamp ?? null,
  entryPoint: row.entry_point,
  source: row.source
});

const getTodayKey = () => new Date().toISOString().slice(0, 10);

export const getAttendanceForToday = async (studentId: string) => {
  const result = await pool.query<AttendanceRow>(
    `
      SELECT id, student_id, status, timestamp, exit_timestamp, attendance_day::text, entry_point, source
      FROM attendance_records
      WHERE student_id = $1 AND attendance_day = $2
      LIMIT 1
    `,
    [studentId, getTodayKey()]
  );

  return result.rows[0] ? toAttendanceRecord(result.rows[0]) : null;
};

export const hasAttendanceForToday = async (studentId: string) => {
  return Boolean(await getAttendanceForToday(studentId));
};

export const createAttendanceRecord = async (input: {
  studentId: string;
  status: AttendanceStatus;
  entryPoint: string;
  source: "fingerprint" | "manual" | "sync";
}) => {
  const timestamp = new Date();
  const result = await pool.query<AttendanceRow>(
    `
      INSERT INTO attendance_records (id, student_id, status, timestamp, exit_timestamp, attendance_day, entry_point, source)
      VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)
      ON CONFLICT (student_id, attendance_day) DO NOTHING
      RETURNING id, student_id, status, timestamp, exit_timestamp, attendance_day::text, entry_point, source
    `,
    [crypto.randomUUID(), input.studentId, input.status, timestamp.toISOString(), getTodayKey(), input.entryPoint, input.source]
  );

  return result.rows[0] ? toAttendanceRecord(result.rows[0]) : null;
};

export const markAttendanceExit = async (studentId: string) => {
  const exitTimestamp = new Date().toISOString();
  const result = await pool.query<AttendanceRow>(
    `
      UPDATE attendance_records
      SET exit_timestamp = $3
      WHERE student_id = $1 AND attendance_day = $2 AND exit_timestamp IS NULL
      RETURNING id, student_id, status, timestamp, exit_timestamp, attendance_day::text, entry_point, source
    `,
    [studentId, getTodayKey(), exitTimestamp]
  );

  return result.rows[0] ? toAttendanceRecord(result.rows[0]) : null;
};

export const listRecentAttendance = async (limit = 8) => {
  const result = await pool.query<AttendanceRow>(
    `
      SELECT
        ar.id,
        ar.student_id,
        ar.status,
        ar.timestamp,
        ar.exit_timestamp,
        ar.attendance_day::text,
        ar.entry_point,
        ar.source,
        s.full_name AS student_name,
        s.class_name AS class_name
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id
      ORDER BY COALESCE(ar.exit_timestamp, ar.timestamp) DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    ...toAttendanceRecord(row),
    studentName: row.student_name ?? "Unknown student",
    className: row.class_name ?? "Unknown class"
  }));
};

export const listAttendanceLedger = async (limit = 24) => {
  const result = await pool.query<AttendanceRow>(
    `
      SELECT
        ar.id,
        ar.student_id,
        ar.status,
        ar.timestamp,
        ar.exit_timestamp,
        ar.attendance_day::text,
        ar.entry_point,
        ar.source,
        s.full_name AS student_name,
        s.class_name AS class_name
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id
      ORDER BY ar.attendance_day DESC, ar.timestamp DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map(toAttendanceLedgerItem);
};

export const listStudentAttendanceLedger = async (studentId: string, limit = 120) => {
  const result = await pool.query<AttendanceRow>(
    `
      SELECT
        ar.id,
        ar.student_id,
        ar.status,
        ar.timestamp,
        ar.exit_timestamp,
        ar.attendance_day::text,
        ar.entry_point,
        ar.source,
        s.full_name AS student_name,
        s.class_name AS class_name
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id
      WHERE ar.student_id = $1
      ORDER BY ar.attendance_day DESC, ar.timestamp DESC
      LIMIT $2
    `,
    [studentId, limit]
  );

  return result.rows.map(toAttendanceLedgerItem);
};

export const getStudentAttendanceCountsForPeriod = async (studentId: string, startDate: string, endDate: string) => {
  const result = await pool.query<AttendanceAggregateRow>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'present')::text AS present,
        COUNT(*) FILTER (WHERE status = 'late')::text AS late
      FROM attendance_records
      WHERE student_id = $1 AND attendance_day BETWEEN $2 AND $3
    `,
    [studentId, startDate, endDate]
  );

  const presentCount = Number(result.rows[0]?.present ?? 0);
  const lateCount = Number(result.rows[0]?.late ?? 0);

  return {
    presentCount,
    lateCount,
    attendanceCount: presentCount + lateCount
  };
};

export const getTodayAttendanceCounts = async () => {
  const result = await pool.query<{ present: string; late: string }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'present')::text AS present,
        COUNT(*) FILTER (WHERE status = 'late')::text AS late
      FROM attendance_records
      WHERE attendance_day = $1
    `,
    [getTodayKey()]
  );

  return {
    present: Number(result.rows[0]?.present ?? 0),
    late: Number(result.rows[0]?.late ?? 0)
  };
};
