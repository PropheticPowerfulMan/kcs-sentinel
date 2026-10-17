import type { Student, StudentDirectoryItem } from "../../core/types.js";
import { pool } from "../../db/pool.js";
import { loadOrbitDirectory } from "../integration/directory.js";

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

const normalizeClassName = (raw: string | null | undefined) => {
  const value = String(raw || "").trim().replace(/\s+/g, " ");
  const kindergarten = value.match(/\bk\s*([3-5])\b/i);
  if (kindergarten) return `K${kindergarten[1]}`;
  const grade = value.match(/grade\s*(\d{1,2})/i);
  if (!grade) return value || "Unassigned";
  const section = value.match(/grade\s*\d{1,2}\s*(?:-|section)?\s*([A-Z])\s*$/i)?.[1];
  return `Grade ${Number(grade[1])}${section ? ` ${section.toUpperCase()}` : ""}`;
};

export const toDirectoryItem = (student: Student): StudentDirectoryItem => ({
  id: student.id,
  fullName: student.fullName,
  className: student.className,
  guardianPhone: student.guardianPhone,
  hasBiometric: Boolean(student.biometricTemplate)
});

const synchronizeOrbitStudents = async () => {
  // Force a fresh authoritative Orbit read so an entity edit propagates to
  // Sentinel immediately instead of waiting for the directory cache window.
  const people = await loadOrbitDirectory(true);
  const students = people
    .filter((person) => person.kind === "STUDENT")
    .map((person) => ({
      id: person.id,
      full_name: person.fullName,
      class_name: normalizeClassName(person.className),
      guardian_phone: person.phone || ""
    }));

  if (students.length > 0) {
    await pool.query(
      `
        INSERT INTO students (id, full_name, class_name, guardian_phone)
        SELECT item.id, item.full_name, item.class_name, item.guardian_phone
        FROM jsonb_to_recordset($1::jsonb)
          AS item(id TEXT, full_name TEXT, class_name TEXT, guardian_phone TEXT)
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          class_name = EXCLUDED.class_name,
          guardian_phone = EXCLUDED.guardian_phone
      `,
      [JSON.stringify(students)]
    );
  }
};
export const listStudents = async () => {
  await synchronizeOrbitStudents();
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
