export const databaseSchema = `
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    guardian_phone TEXT NOT NULL,
    biometric_template TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent')),
    timestamp TIMESTAMPTZ NOT NULL,
    exit_timestamp TIMESTAMPTZ,
    attendance_day DATE NOT NULL,
    entry_point TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('fingerprint', 'manual', 'sync')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, attendance_day)
  );

  ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS exit_timestamp TIMESTAMPTZ;

  CREATE TABLE IF NOT EXISTS school_calendar_days (
    calendar_date DATE PRIMARY KEY,
    label TEXT NOT NULL,
    is_school_day BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;
