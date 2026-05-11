import type { DashboardOverview } from "./types";

const now = new Date();
const sixMinutesAgo = new Date(Date.now() - 1000 * 60 * 6);
const elevenMinutesAgo = new Date(Date.now() - 1000 * 60 * 11);
const fifteenForty = new Date();
fifteenForty.setHours(15, 40, 0, 0);

export const mockOverview: DashboardOverview = {
  campus: "KCS Smart Campus - Main Gate",
  syncStatus: "Demo mode active - orbit sync standby",
  storageMode: "Scenario memory cache",
  aiReadiness: {
    analytics: true,
    anomalyDetection: true,
    predictiveAbsenteeism: true,
    visitorManagement: false
  },
  metrics: {
    totalStudents: 840,
    present: 712,
    absent: 101,
    late: 27,
    biometricSuccessRate: 98.7
  },
  liveFeed: [
    {
      id: "1",
      studentId: "STD-001",
      studentName: "Amina Diallo",
      className: "Grade 6 - A",
      status: "present",
      timestamp: now.toISOString(),
      entryPoint: "Main Gate A",
      source: "fingerprint"
    },
    {
      id: "2",
      studentId: "STD-014",
      studentName: "Daniel Nartey",
      className: "Grade 9 - B",
      status: "late",
      timestamp: sixMinutesAgo.toISOString(),
      entryPoint: "Main Gate A",
      source: "fingerprint"
    },
    {
      id: "3",
      studentId: "STD-076",
      studentName: "Maya Koffi",
      className: "Grade 4 - C",
      status: "present",
      timestamp: elevenMinutesAgo.toISOString(),
      entryPoint: "South Gate",
      source: "fingerprint"
    }
  ],
  attendanceLog: [
    {
      id: "1",
      studentId: "STD-001",
      studentName: "Amina Diallo",
      className: "Grade 6 - A",
      status: "present",
      attendanceDate: now.toISOString().slice(0, 10),
      entryTimestamp: now.toISOString(),
      exitTimestamp: fifteenForty.toISOString(),
      entryPoint: "Main Gate A",
      source: "fingerprint"
    },
    {
      id: "2",
      studentId: "STD-014",
      studentName: "Daniel Nartey",
      className: "Grade 9 - B",
      status: "late",
      attendanceDate: sixMinutesAgo.toISOString().slice(0, 10),
      entryTimestamp: sixMinutesAgo.toISOString(),
      exitTimestamp: null,
      entryPoint: "Main Gate A",
      source: "fingerprint"
    },
    {
      id: "3",
      studentId: "STD-076",
      studentName: "Maya Koffi",
      className: "Grade 4 - C",
      status: "present",
      attendanceDate: elevenMinutesAgo.toISOString().slice(0, 10),
      entryTimestamp: elevenMinutesAgo.toISOString(),
      exitTimestamp: null,
      entryPoint: "South Gate",
      source: "fingerprint"
    }
  ],
  alerts: [
    {
      level: "info",
      title: "Lane integrity nominal",
      detail: "All biometric scanners responding below 1 second latency."
    },
    {
      level: "warning",
      title: "Pattern drift detected",
      detail: "Late arrivals in grade clusters are above weekly baseline."
    }
  ],
  futureModules: [
    "Staff attendance",
    "Visitor management",
    "Multi-campus federation",
    "AI attendance insights",
    "Orbit ecosystem integration"
  ]
};
