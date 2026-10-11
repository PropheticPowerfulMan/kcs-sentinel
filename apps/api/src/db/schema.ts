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

  CREATE TABLE IF NOT EXISTS sentinel_visitors (
    id UUID PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT, organization TEXT,
    purpose TEXT NOT NULL, host_name TEXT NOT NULL, id_document TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sentinel_movements (
    id UUID PRIMARY KEY, person_id TEXT NOT NULL,
    person_type TEXT NOT NULL CHECK (person_type IN ('ORBIT','VISITOR')),
    direction TEXT NOT NULL CHECK (direction IN ('ENTRY','EXIT')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), gate TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('BIOMETRIC','QR','MANUAL')),
    recorded_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sentinel_movements_person_time_idx ON sentinel_movements(person_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS sentinel_movements_time_idx ON sentinel_movements(occurred_at DESC);
  CREATE TABLE IF NOT EXISTS sentinel_justifications (
    id UUID PRIMARY KEY, person_id TEXT NOT NULL,
    incident_type TEXT NOT NULL CHECK (incident_type IN ('ABSENCE','LATE')),
    incident_date DATE NOT NULL, reason TEXT NOT NULL,
    evidence_url TEXT, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    reviewer_id TEXT, review_note TEXT, reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS sentinel_justifications_person_date_idx ON sentinel_justifications(person_id, incident_date DESC);`;
