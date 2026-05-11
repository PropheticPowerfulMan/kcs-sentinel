export type UserRole = "super_admin" | "school_admin" | "security_operator" | "analyst";

export type AttendanceStatus = "present" | "late" | "absent";
export type AttendanceDirection = "entry" | "exit";

export interface Student {
  id: string;
  fullName: string;
  className: string;
  guardianPhone: string;
  biometricTemplate?: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  status: AttendanceStatus;
  timestamp: string;
  exitTimestamp?: string | null;
  entryPoint: string;
  source: "fingerprint" | "manual" | "sync";
}

export interface AttendanceLedgerItem {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  status: AttendanceStatus;
  attendanceDate: string;
  entryTimestamp: string;
  exitTimestamp?: string | null;
  entryPoint: string;
  source: "fingerprint" | "manual" | "sync";
}

export type AttendanceSummaryPeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface AttendanceFrequencySummary {
  period: AttendanceSummaryPeriod;
  label: string;
  startDate: string;
  endDate: string;
  expectedSchoolDays: number;
  attendanceCount: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  frequencyRate: number;
}

export interface StudentDisciplinaryRegister {
  student: StudentDirectoryItem;
  generatedAt: string;
  summaries: AttendanceFrequencySummary[];
  history: AttendanceLedgerItem[];
}

export interface SchoolCalendarDay {
  date: string;
  label: string;
  isSchoolDay: boolean;
}

export interface AttendanceMetrics {
  totalStudents: number;
  present: number;
  absent: number;
  late: number;
  biometricSuccessRate: number;
}

export interface BiometricMatchResult {
  matched: boolean;
  confidence: number;
  student?: Student;
  message?: string;
}

export interface NotificationPreview {
  channel: "sms" | "whatsapp" | "push";
  recipient: string;
  message: string;
}

export interface StudentDirectoryItem {
  id: string;
  fullName: string;
  className: string;
  guardianPhone: string;
  hasBiometric: boolean;
}
