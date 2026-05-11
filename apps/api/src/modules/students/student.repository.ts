import type { Student, StudentDirectoryItem } from "../../core/types.js";
import { pool } from "../../db/pool.js";

type StudentRow = {
  id: string;
  full_name: string;
  class_name: string;
  guardian_phone: string;
  biometric_template: string | null;
};

const mapStudent = (row: StudentRow): Student => ({
  id: row.id,
  fullName: row.full_name,
  className: row.class_name,
  guardianPhone: row.guardian_phone,
  biometricTemplate: row.biometric_template ?? undefined
});

export const toDirectoryItem = (student: Student): StudentDirectoryItem => ({
  id: student.id,
  fullName: student.fullName,
  className: student.className,
  guardianPhone: student.guardianPhone,
  hasBiometric: Boolean(student.biometricTemplate)
});

export const listStudents = async () => {
  const result = await pool.query<StudentRow>(
    "SELECT id, full_name, class_name, guardian_phone, biometric_template FROM students ORDER BY class_name, full_name"
  );

  return result.rows.map(mapStudent);
};

export const listStudentDirectory = async () => {
  const students = await listStudents();
  return students.map(toDirectoryItem);
};

export const findStudentById = async (studentId: string) => {
  const result = await pool.query<StudentRow>(
    "SELECT id, full_name, class_name, guardian_phone, biometric_template FROM students WHERE id = $1 LIMIT 1",
    [studentId]
  );

  return result.rows[0] ? mapStudent(result.rows[0]) : null;
};

export const listStudentsWithBiometrics = async () => {
  const result = await pool.query<StudentRow>(
    `
      SELECT id, full_name, class_name, guardian_phone, biometric_template
      FROM students
      WHERE biometric_template IS NOT NULL
      ORDER BY full_name
    `
  );

  return result.rows.map(mapStudent);
};

export const updateStudentBiometricTemplate = async (studentId: string, biometricTemplate: string) => {
  const result = await pool.query<StudentRow>(
    `
      UPDATE students
      SET biometric_template = $2
      WHERE id = $1
      RETURNING id, full_name, class_name, guardian_phone, biometric_template
    `,
    [studentId, biometricTemplate]
  );

  return result.rows[0] ? mapStudent(result.rows[0]) : null;
};
