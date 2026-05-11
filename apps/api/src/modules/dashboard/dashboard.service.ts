import { getAttendanceLedger, getLiveAttendanceFeed, getTodayMetrics } from "../attendance/attendance.service.js";

export const getDashboardOverview = async () => ({
  campus: "KCS Smart Campus - Main Gate",
  syncStatus: "PostgreSQL attendance ledger online",
  storageMode: "Persistent PostgreSQL",
  aiReadiness: {
    analytics: true,
    anomalyDetection: true,
    predictiveAbsenteeism: true,
    visitorManagement: false
  },
  metrics: await getTodayMetrics(),
  liveFeed: await getLiveAttendanceFeed(),
  attendanceLog: await getAttendanceLedger(),
  alerts: [
    {
      level: "info",
      title: "Biometric lane stable",
      detail: "Average fingerprint verification time is 0.9s over the last 30 minutes."
    },
    {
      level: "warning",
      title: "Late arrivals rising",
      detail: "Late attendance is 12% above the weekly average."
    }
  ],
  futureModules: [
    "Staff attendance",
    "Visitor access control",
    "Multi-campus federation",
    "AI anomaly scoring",
    "National education API integration"
  ]
});
