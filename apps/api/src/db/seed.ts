import { attendanceSeeds, studentSeeds } from "../data/store.js";
import { pool } from "./pool.js";

export const seedDatabase = async () => {
  const studentCountResult = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM students");
  const studentCount = Number(studentCountResult.rows[0]?.count ?? 0);

  if (studentCount === 0) {
    for (const student of studentSeeds) {
      await pool.query(
        `
          INSERT INTO students (id, full_name, class_name, guardian_phone, biometric_template)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [student.id, student.fullName, student.className, student.guardianPhone, student.biometricTemplate ?? null]
      );
    }
  }

  const attendanceCountResult = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM attendance_records");
  const attendanceCount = Number(attendanceCountResult.rows[0]?.count ?? 0);

  if (attendanceCount === 0) {
    for (const record of attendanceSeeds) {
      await pool.query(
        `
          INSERT INTO attendance_records (id, student_id, status, timestamp, attendance_day, entry_point, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (student_id, attendance_day) DO NOTHING
        `,
        [record.id, record.studentId, record.status, record.timestamp, record.timestamp.slice(0, 10), record.entryPoint, record.source]
      );
    }
  }
};
