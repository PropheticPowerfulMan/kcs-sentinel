export type AttendanceDirection = "entry" | "exit";
export type AttendanceSummaryPeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface AttendanceMetric {
  totalStudents: number;
  present: number;
  absent: number;
  late: number;
  biometricSuccessRate: number;
}

export interface LiveFeedItem {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  status: "present" | "late" | "absent";
  timestamp: string;
  entryPoint: string;
  source: "fingerprint" | "manual" | "sync";
}

export interface AttendanceLedgerItem {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  status: "present" | "late" | "absent";
  attendanceDate: string;
  entryTimestamp: string;
  exitTimestamp?: string | null;
  entryPoint: string;
  source: "fingerprint" | "manual" | "sync";
}

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

export interface DashboardOverview {
  campus: string;
  syncStatus: string;
  storageMode?: string;
  aiReadiness: Record<string, boolean>;
  metrics: AttendanceMetric;
  liveFeed: LiveFeedItem[];
  attendanceLog: AttendanceLedgerItem[];
  alerts: Array<{
    level: string;
    title: string;
    detail: string;
  }>;
  futureModules: string[];
}

export interface StudentDirectoryItem {
  id: string;
  fullName: string;
  className: string;
  guardianPhone: string;
  hasBiometric: boolean;
}

export interface NotificationPreview {
  channel: "sms" | "whatsapp" | "push";
  recipient: string;
  message: string;
}

export interface GateScanResponse {
  matched: boolean;
  confidence: number;
  duplicate: boolean;
  eventType?: AttendanceDirection;
  entryTimestamp?: string;
  exitTimestamp?: string | null;
  student?: StudentDirectoryItem;
  notificationPreview?: NotificationPreview[];
  message?: string;
}
