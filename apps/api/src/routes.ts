import { Router } from "express";
import { z } from "zod";

import { issueDemoToken } from "./modules/auth/auth.service.js";
import { enrollFingerprint, getBiometricProviderStatus, scanFingerprint, simulateFingerprintScan, verifyFingerprint } from "./modules/biometrics/biometric.service.js";
import { getStudentDisciplinaryRegister } from "./modules/attendance/attendance.service.js";
import { getDashboardOverview } from "./modules/dashboard/dashboard.service.js";
import { deleteSchoolCalendarDay, listSchoolCalendarDays, upsertSchoolCalendarDay } from "./modules/calendar/calendar.repository.js";
import { buildArrivalNotification } from "./modules/notifications/notification.service.js";
import { listStudentDirectory, toDirectoryItem } from "./modules/students/student.repository.js";

const router = Router();
const handleAsync =
  <T>(handler: (req: Parameters<Router["get"]>[1] extends infer U ? never : never) => Promise<T>) =>
  handler;

type AsyncRouteHandler = Parameters<Router["get"]>[1];

const asyncRoute = (handler: (req: Parameters<Exclude<AsyncRouteHandler, undefined>>[0], res: Parameters<Exclude<AsyncRouteHandler, undefined>>[1]) => Promise<void>) =>
  (req: Parameters<Exclude<AsyncRouteHandler, undefined>>[0], res: Parameters<Exclude<AsyncRouteHandler, undefined>>[1], next: Parameters<Exclude<AsyncRouteHandler, undefined>>[2]) => {
    void handler(req, res).catch(next);
  };

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "KCS SENTINEL API" });
});

router.get(
  "/dashboard/overview",
  asyncRoute(async (_req, res) => {
    res.json(await getDashboardOverview());
  })
);

router.get(
  "/students",
  asyncRoute(async (_req, res) => {
    res.json(await listStudentDirectory());
  })
);

router.get(
  "/students/:studentId/disciplinary-register",
  asyncRoute(async (req, res) => {
    const schema = z.object({ studentId: z.string().min(1) });
    const { studentId } = schema.parse(req.params);
    const register = await getStudentDisciplinaryRegister(studentId);

    if (!register) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    res.json(register);
  })
);

router.get(
  "/calendar/days",
  asyncRoute(async (_req, res) => {
    res.json(await listSchoolCalendarDays());
  })
);

router.post(
  "/calendar/days",
  asyncRoute(async (req, res) => {
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      label: z.string().min(2),
      isSchoolDay: z.boolean().default(false)
    });

    const payload = schema.parse(req.body);
    res.json(await upsertSchoolCalendarDay(payload));
  })
);

router.delete(
  "/calendar/days/:date",
  asyncRoute(async (req, res) => {
    const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
    const { date } = schema.parse(req.params);
    const deleted = await deleteSchoolCalendarDay(date);
    res.json({ deleted });
  })
);

router.post("/auth/token", (req, res) => {
  const schema = z.object({ role: z.enum(["super_admin", "school_admin", "security_operator", "analyst"]) });
  const { role } = schema.parse(req.body);
  res.json({ accessToken: issueDemoToken(role) });
});

router.post(
  "/biometrics/enroll",
  asyncRoute(async (req, res) => {
    const schema = z.object({ studentId: z.string(), template: z.string().min(3).optional() });
    const payload = schema.parse(req.body);
    res.json(await enrollFingerprint(payload.studentId, payload.template));
  })
);

router.get("/biometrics/provider", (_req, res) => {
  res.json(getBiometricProviderStatus());
});

router.post(
  "/biometrics/verify",
  asyncRoute(async (req, res) => {
    const schema = z.object({ template: z.string().min(3), entryPoint: z.string().default("Main Gate A"), direction: z.enum(["entry", "exit"]).default("entry") });
    const payload = schema.parse(req.body);
    const result = await verifyFingerprint(payload.template, payload.entryPoint, payload.direction);

    if (!result.matched || !result.student) {
      res.status(404).json({ message: "Fingerprint not recognized", ...result });
      return;
    }

    res.json({
      ...result,
      student: toDirectoryItem(result.student),
      notificationPreview: result.eventType === "entry" ? buildArrivalNotification(result.student.fullName, result.student.guardianPhone) : undefined
    });
  })
);

router.post(
  "/gate/scan",
  asyncRoute(async (req, res) => {
    const schema = z.object({ studentId: z.string().optional(), entryPoint: z.string().default("Entrance Kiosk"), direction: z.enum(["entry", "exit"]).default("entry") });
    const payload = schema.parse(req.body);
    const result = await scanFingerprint(payload.entryPoint, payload.direction, payload.studentId);

    if (!result.matched || !result.student) {
      res.status(404).json({ message: "Fingerprint not recognized", ...result });
      return;
    }

    res.json({
      ...result,
      student: toDirectoryItem(result.student),
      notificationPreview: result.eventType === "entry" ? buildArrivalNotification(result.student.fullName, result.student.guardianPhone) : undefined
    });
  })
);

router.post(
  "/gate/simulate-scan",
  asyncRoute(async (req, res) => {
    const schema = z.object({ studentId: z.string().optional(), entryPoint: z.string().default("Entrance Kiosk"), direction: z.enum(["entry", "exit"]).default("entry") });
    const payload = schema.parse(req.body);
    const result = await simulateFingerprintScan(payload.studentId, payload.entryPoint, payload.direction);

    if (!result.matched || !result.student) {
      res.status(404).json({ message: "Fingerprint not recognized", ...result });
      return;
    }

    res.json({
      ...result,
      student: toDirectoryItem(result.student),
      notificationPreview: result.eventType === "entry" ? buildArrivalNotification(result.student.fullName, result.student.guardianPhone) : undefined
    });
  })
);

export default router;
