import type { SchoolCalendarDay } from "../../core/types.js";
import { pool } from "../../db/pool.js";

type SchoolCalendarDayRow = {
  calendar_date: string;
  label: string;
  is_school_day: boolean;
};

const toSchoolCalendarDay = (row: SchoolCalendarDayRow): SchoolCalendarDay => ({
  date: row.calendar_date,
  label: row.label,
  isSchoolDay: row.is_school_day
});

const officialClosedDays: Array<[string, string]> = [
  ["2026-11-26", "Thanksgiving · École fermée"],
  ["2026-12-21", "Vacances de Noël"], ["2026-12-22", "Vacances de Noël"],
  ["2026-12-23", "Vacances de Noël"], ["2026-12-24", "Vacances de Noël"],
  ["2026-12-25", "Noël · Jour férié RDC"], ["2026-12-28", "Vacances de Noël"],
  ["2026-12-29", "Vacances de Noël"], ["2026-12-30", "Vacances de Noël"],
  ["2026-12-31", "Vacances de Noël"], ["2027-01-01", "Nouvel An · Jour férié RDC"],
  ["2027-01-04", "Journée des Martyrs de l'Indépendance · RDC"],
  ["2027-01-16", "Journée du héros national Laurent-Désiré Kabila · RDC"],
  ["2027-01-17", "Journée du héros national Patrice-Emery Lumumba · RDC"],
  ["2027-03-22", "Spring Break"], ["2027-03-23", "Spring Break"],
  ["2027-03-24", "Spring Break"], ["2027-03-25", "Spring Break"],
  ["2027-03-26", "Spring Break"], ["2027-03-29", "Spring Break"],
  ["2027-03-30", "Spring Break"], ["2027-03-31", "Spring Break"],
  ["2027-04-01", "Spring Break"], ["2027-04-02", "Spring Break"],
  ["2027-04-06", "Journée du combat de Simon Kimbangu · RDC"],
  ["2027-05-01", "Fête du Travail · RDC"],
  ["2027-05-17", "Journée de la Révolution et des Forces armées · RDC"],
  ["2027-06-30", "Fête de l'Indépendance · RDC"],
  ["2027-08-01", "Fête des Parents · RDC"]
];

const ensureOfficialCalendar = async () => {
  await pool.query(
    `INSERT INTO school_calendar_days (calendar_date, label, is_school_day)
     SELECT item.calendar_date::date, item.label, false
     FROM jsonb_to_recordset($1::jsonb) AS item(calendar_date text, label text)
     ON CONFLICT (calendar_date) DO NOTHING`,
    [JSON.stringify(officialClosedDays.map(([calendar_date, label]) => ({ calendar_date, label })))]
  );
};

export const listSchoolCalendarDays = async () => {
  await ensureOfficialCalendar();
  const result = await pool.query<SchoolCalendarDayRow>(
    `
      SELECT calendar_date::text, label, is_school_day
      FROM school_calendar_days
      ORDER BY calendar_date ASC
    `
  );

  return result.rows.map(toSchoolCalendarDay);
};

export const listSchoolCalendarDaysInRange = async (startDate: string, endDate: string) => {
  const result = await pool.query<SchoolCalendarDayRow>(
    `
      SELECT calendar_date::text, label, is_school_day
      FROM school_calendar_days
      WHERE calendar_date BETWEEN $1 AND $2
      ORDER BY calendar_date ASC
    `,
    [startDate, endDate]
  );

  return result.rows.map(toSchoolCalendarDay);
};

export const upsertSchoolCalendarDay = async (input: SchoolCalendarDay) => {
  const result = await pool.query<SchoolCalendarDayRow>(
    `
      INSERT INTO school_calendar_days (calendar_date, label, is_school_day)
      VALUES ($1, $2, $3)
      ON CONFLICT (calendar_date)
      DO UPDATE SET label = EXCLUDED.label, is_school_day = EXCLUDED.is_school_day
      RETURNING calendar_date::text, label, is_school_day
    `,
    [input.date, input.label, input.isSchoolDay]
  );

  return result.rows[0] ? toSchoolCalendarDay(result.rows[0]) : null;
};

export const deleteSchoolCalendarDay = async (date: string) => {
  const result = await pool.query<{ deleted: string }>(
    `
      DELETE FROM school_calendar_days
      WHERE calendar_date = $1
      RETURNING calendar_date::text AS deleted
    `,
    [date]
  );

  return Boolean(result.rows[0]?.deleted);
};
