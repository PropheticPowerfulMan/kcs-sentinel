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
  alerts: [],
  futureModules: [
    "Staff attendance",
    "Visitor access control",
    "Multi-campus federation",
    "AI anomaly scoring",
    "National education API integration"
  ]
});
