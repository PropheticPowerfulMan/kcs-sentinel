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

export const listSchoolCalendarDays = async () => {
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