import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { SchoolLogo } from "./components/SchoolLogo";
import type { AttendanceDirection, AttendanceFrequencySummary, AttendanceLedgerItem, DashboardOverview, GateScanResponse, LiveFeedItem, SchoolCalendarDay, StudentDirectoryItem, StudentDisciplinaryRegister } from "./types";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const API_URL = configuredApiUrl ? configuredApiUrl.replace(/\/$/, "") : "/api";
const sentinelFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const token = sessionStorage.getItem("sentinel-token");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};
const ENTRY_POINT = "School Entrance Kiosk A";
const UNLOCK_HOLD_MS = 1800;
const SENSOR_TOUCH_RADIUS_RATIO = 0.38;
const FINGER_OPTIONS = ["Pouce droit", "Index droit", "Pouce gauche", "Index gauche"] as const;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

type ViewMode = "dashboard" | "gate" | "liveFeed" | "disciplinary" | "attendance";
type GateState = "idle" | "scanning" | "success" | "error";
type GateWorkspace = "identity" | "biometric" | "operations";
type SensorMode = "verify" | "enroll" | "exit";
type StatCard = {
  key: "present" | "late" | "absent" | "biometricSuccessRate";
  label: string;
  tone: string;
  suffix?: string;
};
type OrbitDirectoryPerson = {
  id: string;
  displayId?: string;
  fullName: string;
  email?: string | null;
  className?: string | null;
  jobTitle?: string | null;
  kind: "STUDENT" | "TEACHER" | "STAFF" | "PARENT";
};
type VisitorDirectoryItem = {
  id: string;
  full_name: string;
  last_name?: string | null;
  middle_name?: string | null;
  first_name?: string | null;
  purpose?: string | null;
  host_name?: string | null;
  movement_count?: number;
  visit_count?: number;
  last_visit_at?: string | null;
};
type DeviceContext = { timezone: string; latitude?: number; longitude?: number };
type ClockReference = { serverUtc: string; deviceTimezone: string; authority: string };
const SCHOOL_TIME_ZONE = "Africa/Kinshasa";
type OperationsPeriod = "daily" | "weekly" | "monthly" | "yearly";
type OperationsReport = { from: string; to: string; timezone: string; generatedAt: string; summary: { movements: number; entries: number; exits: number; orbitMovements: number; visitorMovements: number; uniquePeople: number; presentEmployees: number }; employeePresence: Array<{ person_id: string; fullName: string; kind: string; displayId?: string | null; jobTitle?: string | null; firstEntry?: string | null; lastExit?: string | null; latestDirection: "ENTRY" | "EXIT" }>; movements: Array<{ id: string; fullName: string; kind: string; person_type: "ORBIT" | "VISITOR"; direction: "ENTRY" | "EXIT"; occurred_at: string; gate: string; source: string }> };

const statCards = [
  { key: "present", label: "Present Today", tone: "from-cyan/30 to-cyan/5" },
  { key: "late", label: "Late Arrivals", tone: "from-neon/30 to-neon/5" },
  { key: "absent", label: "Absent", tone: "from-rose-500/30 to-rose-500/5" },
  { key: "biometricSuccessRate", label: "Biometric Accuracy", tone: "from-emerald-400/30 to-emerald-400/5", suffix: "%" }
] satisfies StatCard[];

const navigationItems: Array<{ key: ViewMode; label: string; shortLabel: string; activeClass: string; eyebrow: string }> = [
  { key: "gate", label: "Poste d'entrée", shortLabel: "Entrée", activeClass: "bg-cyan text-slate-950", eyebrow: "Capteur" },
  { key: "dashboard", label: "Dashboard", shortLabel: "Accueil", activeClass: "bg-white text-slate-950", eyebrow: "Vue" },
  { key: "liveFeed", label: "Flux live", shortLabel: "Flux", activeClass: "bg-neon text-white", eyebrow: "Temps réel" },
  { key: "disciplinary", label: "Registre", shortLabel: "Registre", activeClass: "bg-amber-300 text-slate-950", eyebrow: "Élèves" },
  { key: "attendance", label: "Historique", shortLabel: "Journal", activeClass: "bg-signal text-slate-950", eyebrow: "Présences" }
];

const viewPaths: Record<ViewMode, string> = {
  gate: "/gate",
  dashboard: "/dashboard",
  liveFeed: "/live-feed",
  disciplinary: "/disciplinary",
  attendance: "/attendance"
};

const appBasePath = import.meta.env.BASE_URL === "/" ? "" : import.meta.env.BASE_URL.replace(/\/$/, "");

const normalizeRoutePath = (pathname: string) => {
  const withoutBase = appBasePath && pathname.startsWith(appBasePath) ? pathname.slice(appBasePath.length) || "/" : pathname;
  const withLeadingSlash = withoutBase.startsWith("/") ? withoutBase : `/${withoutBase}`;
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
};

const getDefaultView = () => (window.innerWidth < 1024 ? "gate" : "dashboard");

const getViewFromPath = (pathname: string): ViewMode => {
  const normalizedPath = normalizeRoutePath(pathname);
  const matchedView = Object.entries(viewPaths).find(([, path]) => path === normalizedPath)?.[0] as ViewMode | undefined;
  return matchedView ?? getDefaultView();
};

const getPathForView = (view: ViewMode) => `${appBasePath}${viewPaths[view]}`;
const logoAssetPath = `${import.meta.env.BASE_URL}icons/kcs-logo.jpg`;

const loadReportLogo = (opacity = 1) => new Promise<string>((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 512; canvas.height = image.naturalHeight || 512;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("Logo renderer unavailable"));
    context.globalAlpha = opacity; context.drawImage(image, 0, 0); resolve(canvas.toDataURL("image/png"));
  };
  image.onerror = () => reject(new Error("KCS logo unavailable"));
  image.src = logoAssetPath;
});

export const drawKitchenStyleReport = async (pdf: jsPDF, title: string, documentId: string) => {
  const [logo, watermark] = await Promise.all([loadReportLogo(), loadReportLogo(.055)]);
  const pageWidth = pdf.internal.pageSize.getWidth(); const pageHeight = pdf.internal.pageSize.getHeight(); const center = pageWidth / 2;
  pdf.setFillColor(248, 252, 254); pdf.rect(0, 0, pageWidth, pageHeight, "F");
  pdf.addImage(watermark, "PNG", center - 50, pageHeight / 2 - 50, 100, 100);
  pdf.addImage(logo, "PNG", 15, 9, 27, 27);
  pdf.setTextColor(6, 54, 95); pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.text("KINSHASA CHRISTIAN SCHOOL", center, 13, { align: "center" }); pdf.setFontSize(18); pdf.text(title, center, 23, { align: "center" }); pdf.setFontSize(7); pdf.setTextColor(138, 92, 0); pdf.text(documentId, center, 30, { align: "center" });
  pdf.setDrawColor(7, 95, 145); pdf.setLineWidth(1); pdf.line(15, 39, pageWidth - 15, 39);
  pdf.setFillColor(225, 243, 247); pdf.roundedRect(15, 44, pageWidth - 30, 9, 2, 2, "F"); pdf.setTextColor(7, 93, 118); pdf.setFontSize(7); pdf.text("DOCUMENT ISSU DU REGISTRE AUDITÉ KCS SENTINEL", center, 49.5, { align: "center" });
  return 61;
};

const workflow = [
  "Choisir l'élève ou basculer le capteur en mode présence",
  "Demander à l'élève de poser son doigt sur le capteur visible",
  "Comparer l'empreinte au coffre biométrique chiffré",
  "Valider l'identité et enregistrer la présence dans PostgreSQL",
  "Afficher immédiatement la confirmation visuelle"
];

const pillars = [
  {
    title: "Capteur visible",
    detail: "Le grand pad circulaire représente l'endroit exact où l'élève doit poser son doigt dans cette démonstration sans matériel biométrique connecté."
  },
  {
    title: "Enrôlement intégré",
    detail: "Le personnel peut sélectionner un élève, choisir un doigt de référence puis enregistrer ou réenregistrer l'empreinte depuis le même poste."
  },
  {
    title: "Persistance réelle",
    detail: "Les validations de présence sont stockées dans PostgreSQL et réapparaissent dans le flux live du tableau de bord."
  }
];

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isLateArrival = (timestamp: Date) => timestamp.getHours() > 8 || (timestamp.getHours() === 8 && timestamp.getMinutes() >= 1);

const getIdleScanMessage = (mode: SensorMode, finger: string) => {
  if (mode === "enroll") {
    return `Posez ${finger.toLowerCase()} sur le capteur pour enregistrer l'empreinte de l'élève.`;
  }

  if (mode === "exit") {
    return `Posez ${finger.toLowerCase()} sur le capteur pour enregistrer l'heure de sortie.`;
  }

  return `Posez ${finger.toLowerCase()} sur le capteur pour vérifier la présence.`;
};

const getSensorModeLabel = (mode: SensorMode) => {
  if (mode === "enroll") {
    return "Mode enrôlement";
  }

  if (mode === "exit") {
    return "Mode sortie";
  }

  return "Mode vérification";
};

const getSensorPrompt = (mode: SensorMode, gateState: GateState) => {
  if (gateState === "scanning") {
    if (mode === "enroll") {
      return "Capture en cours";
    }

    if (mode === "exit") {
      return "Sortie en cours";
    }

    return "Lecture en cours";
  }

  if (mode === "enroll") {
    return "Capture d'enrôlement";
  }

  if (mode === "exit") {
    return "Scan de sortie";
  }

  return "Scan de présence";
};

const formatDateValue = (value: string) =>
  new Date(value).toLocaleDateString("fr-FR", {
    timeZone: SCHOOL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

const formatDateKeyValue = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
};

const formatTimeValue = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit"
      ,timeZone: SCHOOL_TIME_ZONE
      })
    : "--:--";

const formatDateTimeValue = (value: string) =>
  new Date(value).toLocaleString("fr-FR", {
    timeZone: SCHOOL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

const toDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const schoolDateKey = (value = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const shiftDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const operationsRange = (period: OperationsPeriod) => {
  const to = schoolDateKey();
  if (period === "daily") return { from: to, to };
  if (period === "weekly") return { from: shiftDateKey(to, -6), to };
  if (period === "monthly") return { from: `${to.slice(0, 8)}01`, to };
  return { from: `${to.slice(0, 4)}-01-01`, to };
};

const startOfWeek = (value: Date) => {
  const copy = new Date(value);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const startOfMonth = (value: Date) => {
  const copy = new Date(value);
  copy.setDate(1);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const startOfYear = (value: Date) => {
  const copy = new Date(value);
  copy.setMonth(0, 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const countSchoolDays = (startDate: Date, endDate: Date) => {
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  cursor.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  let total = 0;
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      total += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
};

const buildFrequencySummaryFromHistory = (
  history: AttendanceLedgerItem[],
  period: AttendanceFrequencySummary["period"],
  label: string,
  startDate: Date,
  endDate: Date
): AttendanceFrequencySummary => {
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  const filtered = history.filter((item) => item.attendanceDate >= startKey && item.attendanceDate <= endKey);
  const presentCount = filtered.filter((item) => item.status === "present").length;
  const lateCount = filtered.filter((item) => item.status === "late").length;
  const attendanceCount = presentCount + lateCount;
  const expectedSchoolDays = countSchoolDays(startDate, endDate);
  const absentCount = Math.max(expectedSchoolDays - attendanceCount, 0);
  const frequencyRate = expectedSchoolDays === 0 ? 0 : Number(((attendanceCount / expectedSchoolDays) * 100).toFixed(1));

  return {
    period,
    label,
    startDate: startKey,
    endDate: endKey,
    expectedSchoolDays,
    attendanceCount,
    presentCount,
    lateCount,
    absentCount,
    frequencyRate
  };
};

const getSuccessScanMessage = (direction: AttendanceDirection, duplicate: boolean) => {
  if (direction === "exit") {
    return duplicate ? "La sortie a déjà été enregistrée aujourd'hui." : "Sortie confirmée et enregistrée.";
  }

  return duplicate ? "Empreinte reconnue, mais la présence a déjà été enregistrée aujourd'hui." : "Présence confirmée et enregistrée.";
};

type AppProps = {
  language?: "fr" | "en";
  onLanguageChange?: (language: "fr" | "en") => void;
  onLogout?: () => void;
};

function App({ language = "fr", onLanguageChange, onLogout }: AppProps) {
  const [overview, setOverview] = useState<DashboardOverview>({
    campus: "KCS Smart Campus - Main Gate",
    syncStatus: "Secure synchronization in progress",
    storageMode: "Persistent PostgreSQL",
    aiReadiness: {},
    metrics: { totalStudents: 0, present: 0, absent: 0, late: 0, biometricSuccessRate: 0 },
    liveFeed: [],
    attendanceLog: [],
    alerts: [],
    futureModules: [],
  });
  const [students, setStudents] = useState<StudentDirectoryItem[]>([]);
  const [status, setStatus] = useState("Securely loading the live Orbit registry...");
  const [activeView, setActiveView] = useState<ViewMode>(() => getViewFromPath(window.location.pathname));
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState("Ready for entrance-tablet deployment");
  const [online, setOnline] = useState(window.navigator.onLine);
  const [kioskMode, setKioskMode] = useState(false);
  const [unlockHolding, setUnlockHolding] = useState(false);
  const [gateState, setGateState] = useState<GateState>("idle");
  const [gateWorkspace, setGateWorkspace] = useState<GateWorkspace>("identity");
  const [sensorMode, setSensorMode] = useState<SensorMode>("verify");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [selectedFinger, setSelectedFinger] = useState<(typeof FINGER_OPTIONS)[number]>(FINGER_OPTIONS[0]);
  const [scanMessage, setScanMessage] = useState(getIdleScanMessage("verify", FINGER_OPTIONS[0]));
  const [scanResult, setScanResult] = useState<GateScanResponse | null>(null);
  const [sensorPressed, setSensorPressed] = useState(false);
  const [disciplinaryRegister, setDisciplinaryRegister] = useState<StudentDisciplinaryRegister | null>(null);
  const [calendarDays, setCalendarDays] = useState<SchoolCalendarDay[]>([]);
  const [calendarDate, setCalendarDate] = useState(() => toDateKey(new Date()));
  const [calendarLabel, setCalendarLabel] = useState("Jour férié / jour non ouvré");
  const [calendarIsSchoolDay, setCalendarIsSchoolDay] = useState(false);
  const [orbitDirectory, setOrbitDirectory] = useState<OrbitDirectoryPerson[]>([]);
  const [orbitSearch, setOrbitSearch] = useState("");
  const [orbitDirectoryLoading, setOrbitDirectoryLoading] = useState(true);
  const [orbitDirectoryError, setOrbitDirectoryError] = useState("");
  const [visitors, setVisitors] = useState<VisitorDirectoryItem[]>([]);
  const [visitorSearch, setVisitorSearch] = useState("");
  const [visitorForm, setVisitorForm] = useState({ lastName: "", middleName: "", firstName: "", purpose: "", hostName: "" });
  const [movementBusy, setMovementBusy] = useState("");
  const [movementNotice, setMovementNotice] = useState("");
  const [managerReportFrom, setManagerReportFrom] = useState(() => { const date = new Date(); date.setDate(1); return toDateKey(date); });
  const [managerReportTo, setManagerReportTo] = useState(() => toDateKey(new Date()));
  const [reportBusyPersonId, setReportBusyPersonId] = useState("");
  const [operationsPeriod, setOperationsPeriod] = useState<OperationsPeriod>("daily");
  const [operationsReport, setOperationsReport] = useState<OperationsReport | null>(null);
  const [operationsReportBusy, setOperationsReportBusy] = useState(false);
  const [clockReference, setClockReference] = useState<ClockReference | null>(null);
  const [deviceContext, setDeviceContext] = useState<DeviceContext>(() => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }));
  const unlockTimerRef = useRef<number | null>(null);
  const sensorSurfaceRef = useRef<HTMLButtonElement | null>(null);
  const isNavigatingFromHistoryRef = useRef(false);

  const navigateToView = (view: ViewMode, options?: { replace?: boolean }) => {
    setActiveView(view);

    const nextPath = getPathForView(view);
    if (window.location.pathname === nextPath) {
      return;
    }

    if (options?.replace) {
      window.history.replaceState({ view }, "", nextPath);
      return;
    }

    window.history.pushState({ view }, "", nextPath);
  };

  const isStandalone = useMemo(
    () => window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    []
  );

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null,
    [selectedStudentId, students]
  );

  const attendanceLog = overview.attendanceLog ?? [];

  const buildFallbackDisciplinaryRegister = (student: StudentDirectoryItem): StudentDisciplinaryRegister => {
    const history = attendanceLog.filter((item) => item.studentId === student.id);
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    return {
      student,
      generatedAt: new Date().toISOString(),
      summaries: [
        buildFrequencySummaryFromHistory(history, "daily", "Bilan journalier", today, today),
        buildFrequencySummaryFromHistory(history, "weekly", "Bilan hebdomadaire", startOfWeek(now), today),
        buildFrequencySummaryFromHistory(history, "monthly", "Bilan mensuel", startOfMonth(now), today),
        buildFrequencySummaryFromHistory(history, "yearly", "Bilan annuel", startOfYear(now), today)
      ],
      history
    };
  };

  const refreshOverview = async () => {
    try {
      const [overviewResponse, studentsResponse] = await Promise.all([
        sentinelFetch(`${API_URL}/dashboard/overview`),
        sentinelFetch(`${API_URL}/students`)
      ]);

      if (!overviewResponse.ok || !studentsResponse.ok) {
        throw new Error("API unavailable");
      }

      const overviewPayload = (await overviewResponse.json()) as DashboardOverview;
      const studentPayload = (await studentsResponse.json()) as StudentDirectoryItem[];
      setOverview(overviewPayload);
      setStudents(studentPayload);
      setSelectedStudentId((current) => studentPayload.some(student => student.id === current) ? current : (studentPayload[0]?.id ?? ""));
      setStatus("Live API telemetry connected");
    } catch {
      setStatus("Live synchronization is temporarily unavailable. Displayed records remain the last verified server data.");
    }
  };

  useEffect(() => {
    void refreshOverview();
    const interval = window.setInterval(() => {
      void refreshOverview();
    }, 20000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setDeviceContext({ timezone });
    if (window.isSecureContext && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => setDeviceContext({ timezone, latitude: coords.latitude, longitude: coords.longitude }),
        () => setDeviceContext({ timezone }),
        { enableHighAccuracy: false, maximumAge: 15 * 60_000, timeout: 4_000 }
      );
    }

    const loadOperationsRegistry = async () => {
      try {
        const [directoryResponse, visitorsResponse, clockResponse] = await Promise.all([
          sentinelFetch(`${API_URL}/directory`),
          sentinelFetch(`${API_URL}/visitors`),
          sentinelFetch(`${API_URL}/time/reference?timezone=${encodeURIComponent(timezone)}`)
        ]);
        if (directoryResponse.ok) {
          setOrbitDirectory(((await directoryResponse.json()) as { people: OrbitDirectoryPerson[] }).people ?? []);
          setOrbitDirectoryError("");
        } else {
          setOrbitDirectoryError("Le registre Orbit n'a pas pu être chargé.");
        }
        if (visitorsResponse.ok) setVisitors(((await visitorsResponse.json()) as { visitors: VisitorDirectoryItem[] }).visitors ?? []);
        if (clockResponse.ok) setClockReference((await clockResponse.json()) as ClockReference);
      } catch {
        setMovementNotice("Le registre opérationnel se resynchronisera automatiquement dès que la liaison sera disponible.");
        setOrbitDirectoryError("Liaison Orbit momentanément indisponible.");
      } finally {
        setOrbitDirectoryLoading(false);
      }
    };
    void loadOperationsRegistry();
  }, []);

  useEffect(() => {
    const query = orbitSearch.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setOrbitDirectoryLoading(true);
      try {
        const response = await sentinelFetch(`${API_URL}/directory?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Orbit directory unavailable");
        const payload = (await response.json()) as { people: OrbitDirectoryPerson[] };
        setOrbitDirectory(payload.people ?? []);
        setOrbitDirectoryError("");
      } catch (error) {
        if (!controller.signal.aborted) setOrbitDirectoryError("La recherche Orbit sera relancée automatiquement. Vous pouvez aussi réessayer.");
      } finally {
        if (!controller.signal.aborted) setOrbitDirectoryLoading(false);
      }
    }, 240);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [orbitSearch]);

  const visibleOrbitPeople = useMemo(() => {
    const query = orbitSearch.trim().toLocaleLowerCase("fr");
    if (!query) return orbitDirectory.slice(0, 8);
    return orbitDirectory.filter((person) => [person.fullName, person.displayId, person.email, person.className, person.jobTitle].some((value) => value?.toLocaleLowerCase("fr").includes(query))).slice(0, 12);
  }, [orbitDirectory, orbitSearch]);

  const visibleVisitors = useMemo(() => {
    const query = visitorSearch.trim().toLocaleLowerCase("fr");
    if (!query) return visitors.slice(0, 8);
    return visitors.filter((visitor) => visitor.full_name.toLocaleLowerCase("fr").includes(query)).slice(0, 12);
  }, [visitorSearch, visitors]);

  useEffect(() => {
    let active = true;
    const range = operationsRange(operationsPeriod);
    const load = async () => {
      try {
        const response = await sentinelFetch(`${API_URL}/reports/operations?from=${range.from}&to=${range.to}`);
        if (!response.ok) throw new Error("Operational report unavailable");
        const payload = await response.json() as OperationsReport;
        if (active) setOperationsReport(payload);
      } catch {
        if (active) setMovementNotice("Le suivi opérationnel sera resynchronisé automatiquement.");
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [operationsPeriod]);

  const exportOperationsPdf = async () => {
    if (!operationsReport) return;
    setOperationsReportBusy(true);
    try {
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const documentId = `KCS-SEN-FLOW-${Date.now().toString(36).toUpperCase()}`;
      await drawKitchenStyleReport(pdf, "RAPPORT OFFICIEL DES FLUX SENTINEL", documentId);
      pdf.setTextColor(3, 41, 66); pdf.setFontSize(10); pdf.text(`Période : ${operationsReport.from} — ${operationsReport.to} · Fuseau officiel : ${operationsReport.timezone}`, 15, 65);
      autoTable(pdf, { startY: 72, head: [["Mouvements", "Entrées", "Sorties", "Identités", "Orbit", "Visiteurs"]], body: [[String(operationsReport.summary.movements), String(operationsReport.summary.entries), String(operationsReport.summary.exits), String(operationsReport.summary.uniquePeople), String(operationsReport.summary.orbitMovements), String(operationsReport.summary.visitorMovements)]], headStyles: { fillColor: [7, 90, 123] }, styles: { fontSize: 9 } });
      autoTable(pdf, { startY: ((pdf as any).lastAutoTable?.finalY || 88) + 7, head: [["Date / heure", "Identité", "Catégorie", "Mouvement", "Portail", "Source"]], body: operationsReport.movements.map((row) => [formatDateTimeValue(row.occurred_at), row.fullName, row.kind, row.direction === "ENTRY" ? "Entrée" : "Sortie", row.gate || "—", row.source || "—"]), headStyles: { fillColor: [7, 90, 123] }, alternateRowStyles: { fillColor: [239, 248, 252] }, styles: { fontSize: 7.5, cellPadding: 2.1 }, margin: { top: 18, bottom: 18 } });
      pdf.save(`KCS-Sentinel-flux-${operationsReport.from}-${operationsReport.to}.pdf`);
    } finally { setOperationsReportBusy(false); }
  };

  const registerMovement = async (personId: string, personType: "ORBIT" | "VISITOR", direction: "ENTRY" | "EXIT", label: string) => {
    const operationKey = `${personType}:${personId}:${direction}`;
    setMovementBusy(operationKey);
    setMovementNotice("");
    try {
      const response = await sentinelFetch(`${API_URL}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, personType, direction, gate: ENTRY_POINT, source: "MANUAL", deviceContext })
      });
      const payload = await response.json() as { occurredAt?: string; message?: string };
      if (!response.ok) throw new Error(payload.message || "Pointage refusé");
      const verifiedTime = payload.occurredAt ? formatDateTimeValue(payload.occurredAt) : "heure serveur validée";
      setMovementNotice(`${direction === "ENTRY" ? "Entrée" : "Sortie"} confirmée pour ${label} · ${verifiedTime} · horloge serveur.`);
      const range = operationsRange(operationsPeriod);
      const operationsResponse = await sentinelFetch(`${API_URL}/reports/operations?from=${range.from}&to=${range.to}`);
      if (operationsResponse.ok) setOperationsReport(await operationsResponse.json() as OperationsReport);
      if (personType === "VISITOR") {
        const visitorsResponse = await sentinelFetch(`${API_URL}/visitors`);
        if (visitorsResponse.ok) setVisitors(((await visitorsResponse.json()) as { visitors: VisitorDirectoryItem[] }).visitors ?? []);
      }
    } catch (error) {
      setMovementNotice(error instanceof Error ? error.message : "Le pointage n'a pas pu être enregistré.");
    } finally {
      setMovementBusy("");
    }
  };

  const exportOrbitAttendancePdf = async (person: OrbitDirectoryPerson) => {
    if (!managerReportFrom || !managerReportTo || managerReportFrom > managerReportTo) return;
    setReportBusyPersonId(person.id);
    setMovementNotice("");
    try {
      const response = await sentinelFetch(`${API_URL}/reports/${encodeURIComponent(person.id)}?from=${managerReportFrom}&to=${managerReportTo}`);
      const report = await response.json() as any;
      if (!response.ok) throw new Error(report.message || "Rapport indisponible");
      const summary = report.custom || {};
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const documentId = `KCS-SEN-${Date.now().toString(36).toUpperCase()}-${person.id.slice(-6).toUpperCase()}`;
      await drawKitchenStyleReport(pdf, "RAPPORT OFFICIEL DE FRÉQUENTATION", documentId);
      pdf.setTextColor(3, 41, 66); pdf.setFontSize(16); pdf.text(person.fullName, 15, 66); pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.text(`${person.kind} · ${person.displayId || person.id}${person.className ? ` · ${person.className}` : ""}`, 15, 74); pdf.text(`Période : ${managerReportFrom} — ${managerReportTo}`, 15, 80);
      autoTable(pdf, { startY: 88, head: [["Présences", "Ponctualité", "Arrivée moyenne", "Sortie moyenne", "Durée moyenne"]], body: [[String(summary.attendanceDays || 0), `${summary.punctualityRate || 0}%`, summary.averageArrival || "—", summary.averageDeparture || "—", `${Math.floor((summary.averagePresenceMinutes || 0) / 60)} h ${String((summary.averagePresenceMinutes || 0) % 60).padStart(2, "0")}`]], headStyles: { fillColor: [7, 90, 123] }, styles: { fontSize: 9 } });
      autoTable(pdf, { startY: ((pdf as any).lastAutoTable?.finalY || 92) + 8, head: [["Date", "Entrée", "Sortie", "Durée", "Statut", "Point"]], body: (summary.dayDetails || []).map((day: any) => [day.date, formatTimeValue(day.firstEntry), formatTimeValue(day.lastExit), day.durationMinutes == null ? "Incomplet" : `${Math.floor(day.durationMinutes / 60)}h${String(day.durationMinutes % 60).padStart(2, "0")}`, day.late ? "Retard" : "À l'heure", day.gate || "—"]), headStyles: { fillColor: [45, 212, 191], textColor: [3, 41, 66] }, styles: { fontSize: 8.5, cellPadding: 2.5 } });
      pdf.setDrawColor(226, 169, 47); pdf.setLineWidth(.7); pdf.line(15, 277, 195, 277); pdf.setFontSize(8); pdf.setTextColor(90, 110, 125); pdf.text("Kinshasa Christian School · Macampagne, Ngaliema · Kinshasa, RDC", 15, 283); pdf.text(`${documentId} · ${report.timezone || "Africa/Kinshasa"}`, 195, 283, { align: "right" });
      pdf.save(`sentinel-${person.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${managerReportFrom}-${managerReportTo}.pdf`);
    } catch (error) {
      setMovementNotice(error instanceof Error ? error.message : "Le rapport n'a pas pu être généré.");
    } finally {
      setReportBusyPersonId("");
    }
  };

  const exportVisitorReportPdf = async (visitor: VisitorDirectoryItem) => {
    setReportBusyPersonId(visitor.id); setMovementNotice("");
    try {
      const response = await sentinelFetch(`${API_URL}/visitors/${encodeURIComponent(visitor.id)}/history`);
      const report = await response.json() as any;
      if (!response.ok) throw new Error(report.message || "Historique visiteur indisponible");
      const movements = (report.movements || []).filter((movement: any) => { const day = String(movement.occurred_at || "").slice(0, 10); return day >= managerReportFrom && day <= managerReportTo; });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const documentId = `KCS-SEN-VIS-${Date.now().toString(36).toUpperCase()}-${visitor.id.slice(-6).toUpperCase()}`;
      await drawKitchenStyleReport(pdf, "REGISTRE OFFICIEL DES VISITES", documentId);
      pdf.setTextColor(3, 41, 66); pdf.setFontSize(16); pdf.text(visitor.full_name, 15, 66); pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.text(`${visitor.purpose || "Visiteur"}${visitor.host_name ? ` · Personne visitée : ${visitor.host_name}` : ""}`, 15, 74); pdf.text(`Période : ${managerReportFrom} — ${managerReportTo} · ${movements.filter((row: any) => row.direction === "ENTRY").length} visite(s)`, 15, 80);
      autoTable(pdf, { startY: 89, head: [["Date et heure", "Mouvement", "Portail", "Source", "Fuseau observé"]], body: movements.map((row: any) => [formatDateTimeValue(row.occurred_at), row.direction === "ENTRY" ? "Entrée" : "Sortie", row.gate || "—", row.source || "—", row.observed_timezone || "—"]), headStyles: { fillColor: [7, 90, 123] }, styles: { fontSize: 8.5, cellPadding: 2.7 } });
      pdf.setDrawColor(226, 169, 47); pdf.setLineWidth(.7); pdf.line(15, 277, 195, 277); pdf.setFontSize(8); pdf.setTextColor(83, 111, 129); pdf.text("Kinshasa Christian School · Macampagne, Ngaliema · Kinshasa, RDC", 15, 283); pdf.text(`KCS Orbit Ecosystem · KCS Sentinel · ${documentId}`, 195, 283, { align: "right" });
      pdf.save(`sentinel-visiteur-${visitor.full_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${managerReportFrom}-${managerReportTo}.pdf`);
    } catch (error) { setMovementNotice(error instanceof Error ? error.message : "Le rapport visiteur n'a pas pu être généré."); }
    finally { setReportBusyPersonId(""); }
  };

  const createVisitor = async () => {
    setMovementBusy("visitor:create");
    setMovementNotice("");
    try {
      const response = await sentinelFetch(`${API_URL}/visitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...visitorForm, gate: ENTRY_POINT, deviceContext })
      });
      const payload = await response.json() as { id?: string; fullName?: string; message?: string; enteredAt?: string };
      if (!response.ok || !payload.id) throw new Error(payload.message || "Enregistrement du visiteur refusé");
      const visitor: VisitorDirectoryItem = { id: payload.id, full_name: payload.fullName || [visitorForm.lastName, visitorForm.middleName, visitorForm.firstName].filter(Boolean).join(" "), purpose: visitorForm.purpose, host_name: visitorForm.hostName, movement_count: 1, visit_count: 1, last_visit_at: payload.enteredAt };
      setVisitors((current) => [visitor, ...current]);
      setVisitorForm({ lastName: "", middleName: "", firstName: "", purpose: "", hostName: "" });
      setMovementNotice(`${visitor.full_name} est enregistré · entrée officielle liée à ${payload.enteredAt ? formatDateTimeValue(payload.enteredAt) : "l'heure serveur"}. La sortie restera traçable sur la même fiche.`);
    } catch (error) {
      setMovementNotice(error instanceof Error ? error.message : "Le visiteur n'a pas pu être enregistré.");
    } finally {
      setMovementBusy("");
    }
  };

  useEffect(() => {
    const hasExplicitRoute = Object.values(viewPaths).includes(normalizeRoutePath(window.location.pathname));
    navigateToView(activeView, { replace: !hasExplicitRoute });

    const handlePopState = () => {
      isNavigatingFromHistoryRef.current = true;
      setActiveView(getViewFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (isNavigatingFromHistoryRef.current) {
      isNavigatingFromHistoryRef.current = false;
      return;
    }

    const nextPath = getPathForView(activeView);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ view: activeView }, "", nextPath);
    }
  }, [activeView]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setInstallState("Installation available on this device");
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setInstallState("Installed in standalone school app mode");
    };

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    document.title =
      activeView === "gate"
        ? "KCS School Gate"
        : activeView === "liveFeed"
          ? "KCS School | Flux live"
          : activeView === "disciplinary"
            ? "KCS School | Registre"
            : activeView === "attendance"
              ? "KCS School | Historique"
              : "KCS School | SENTINEL";
  }, [activeView]);

  useEffect(() => {
    if (gateState === "idle") {
      setScanMessage(getIdleScanMessage(sensorMode, selectedFinger));
    }
  }, [sensorMode, gateState, selectedFinger]);

  useEffect(() => {
    if (!selectedStudent) {
      setDisciplinaryRegister(null);
      return;
    }

    const loadRegister = async () => {
      try {
        const response = await sentinelFetch(`${API_URL}/students/${selectedStudent.id}/disciplinary-register`);
        if (!response.ok) {
          throw new Error("Register unavailable");
        }

        const payload = (await response.json()) as StudentDisciplinaryRegister;
        setDisciplinaryRegister(payload);
      } catch {
        setDisciplinaryRegister(buildFallbackDisciplinaryRegister(selectedStudent));
      }
    };

    void loadRegister();
  }, [selectedStudent, attendanceLog]);

  useEffect(() => {
    const loadCalendar = async () => {
      try {
        const response = await sentinelFetch(`${API_URL}/calendar/days`);
        if (!response.ok) {
          throw new Error("Calendar unavailable");
        }

        const payload = (await response.json()) as SchoolCalendarDay[];
        setCalendarDays(payload);
      } catch {
        setCalendarDays([]);
      }
    };

    void loadCalendar();
  }, [disciplinaryRegister?.generatedAt]);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      setInstallState(isStandalone ? "Already running as installed app" : "Use the browser menu to add the school app to the home screen");
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setInstallState(choice.outcome === "accepted" ? "Installation accepted" : "Installation dismissed");
    setDeferredPrompt(null);
  };

  const enterKioskMode = async () => {
    setKioskMode(true);
    navigateToView("gate");
    setStatus("Kiosk mode armed for the entrance station");

    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setStatus("Fullscreen request was blocked by the browser");
    }

    try {
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };
      await orientation.lock?.("landscape");
    } catch {
      setStatus("Kiosk mode active without orientation lock");
    }
  };

  const exitKioskMode = async () => {
    setKioskMode(false);
    setUnlockHolding(false);
    setStatus("Kiosk mode released");
    const orientation = window.screen.orientation as ScreenOrientation & { unlock?: () => void };
    orientation.unlock?.();

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        return;
      }
    }
  };

  const beginUnlockHold = () => {
    setUnlockHolding(true);
    unlockTimerRef.current = window.setTimeout(() => {
      void exitKioskMode();
    }, UNLOCK_HOLD_MS);
  };

  const cancelUnlockHold = () => {
    setUnlockHolding(false);
    if (unlockTimerRef.current) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  };

  const applyLocalAttendanceEvent = (student: StudentDirectoryItem, direction: AttendanceDirection, duplicate: boolean) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const todayKey = nowIso.slice(0, 10);

    setOverview((current) => {
      const existingIndex = current.attendanceLog.findIndex(
        (item) => item.studentId === student.id && item.attendanceDate === todayKey
      );

      if (direction === "entry") {
        if (duplicate || existingIndex >= 0) {
          return current;
        }

        const late = isLateArrival(now);
        const attendanceStatus: "present" | "late" = late ? "late" : "present";
        const presentIncrement = late ? 0 : 1;
        const lateIncrement = late ? 1 : 0;
        const currentPresent = current.metrics.present + presentIncrement;
        const currentLate = current.metrics.late + lateIncrement;
        const totalMarked = currentPresent + currentLate;
        const divisor = Math.max(current.metrics.totalStudents, 1);
        const ledgerItem: AttendanceLedgerItem = {
          id: `${student.id}-${todayKey}`,
          studentId: student.id,
          studentName: student.fullName,
          className: student.className,
          status: attendanceStatus,
          attendanceDate: todayKey,
          entryTimestamp: nowIso,
          exitTimestamp: null,
          entryPoint: ENTRY_POINT,
          source: "fingerprint"
        };

        const updatedAttendanceLog = [ledgerItem, ...current.attendanceLog]
          .sort((left, right) => right.entryTimestamp.localeCompare(left.entryTimestamp))
          .slice(0, 32);

        const newFeedItem: LiveFeedItem = {
          id: `${student.id}-${Date.now()}`,
          studentId: student.id,
          studentName: student.fullName,
          className: student.className,
          status: attendanceStatus,
          timestamp: nowIso,
          entryPoint: ENTRY_POINT,
          source: "fingerprint"
        };

        return {
          ...current,
          metrics: {
            ...current.metrics,
            present: currentPresent,
            late: currentLate,
            absent: Math.max(current.metrics.totalStudents - totalMarked, 0),
            biometricSuccessRate: Number(((totalMarked / divisor) * 100).toFixed(1))
          },
          attendanceLog: updatedAttendanceLog,
          liveFeed: [newFeedItem, ...current.liveFeed].slice(0, 8)
        };
      }

      if (existingIndex < 0 || current.attendanceLog[existingIndex]?.exitTimestamp) {
        return current;
      }

      const updatedAttendanceLog = current.attendanceLog.map((item, index) =>
        index === existingIndex ? { ...item, exitTimestamp: nowIso } : item
      );

      const newFeedItem: LiveFeedItem = {
        id: `${student.id}-${Date.now()}`,
        studentId: student.id,
        studentName: student.fullName,
        className: student.className,
        status: current.attendanceLog[existingIndex]?.status ?? "present",
        timestamp: nowIso,
        entryPoint: `${ENTRY_POINT} - Sortie`,
        source: "fingerprint"
      };

      return {
        ...current,
        attendanceLog: updatedAttendanceLog,
        liveFeed: [newFeedItem, ...current.liveFeed].slice(0, 8)
      };
    });
  };

  const applyLocalEnrollment = (studentId: string) => {
    setStudents((current) => current.map((student) => (student.id === studentId ? { ...student, hasBiometric: true } : student)));
  };

  const buildFallbackScan = (studentId: string | undefined, direction: AttendanceDirection): GateScanResponse => {
    if (!studentId) {
      return {
        matched: false,
        confidence: 0.12,
        duplicate: false,
        message: "Aucun élève n'est sélectionné pour la simulation.",
        eventType: direction
      };
    }

    const student = students.find((item) => item.id === studentId);
    if (!student) {
      return {
        matched: false,
        confidence: 0.12,
        duplicate: false,
        message: "Empreinte non reconnue.",
        eventType: direction
      };
    }

    if (!student.hasBiometric) {
      return {
        matched: false,
        confidence: 0.12,
        duplicate: false,
        message: "Aucune empreinte n'est encore enrôlée pour cet élève.",
        eventType: direction
      };
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const existingAttendance = attendanceLog.find((item) => item.studentId === student.id && item.attendanceDate === todayKey);

    if (direction === "exit") {
      if (!existingAttendance) {
        return {
          matched: false,
          confidence: 0.12,
          duplicate: false,
          message: "Aucune entrée n'a encore été enregistrée aujourd'hui pour cet élève.",
          eventType: "exit"
        };
      }

      return {
        matched: true,
        confidence: existingAttendance.exitTimestamp ? 0.98 : 0.99,
        duplicate: Boolean(existingAttendance.exitTimestamp),
        student,
        eventType: "exit",
        entryTimestamp: existingAttendance.entryTimestamp,
        exitTimestamp: existingAttendance.exitTimestamp ?? new Date().toISOString(),
        message: existingAttendance.exitTimestamp ? "La sortie a déjà été enregistrée aujourd'hui." : "Sortie confirmée en mode démo."
      };
    }

    const duplicate = Boolean(existingAttendance);

    return {
      matched: true,
      confidence: duplicate ? 0.98 : 0.99,
      duplicate,
      student,
      eventType: "entry",
      entryTimestamp: existingAttendance?.entryTimestamp,
      exitTimestamp: existingAttendance?.exitTimestamp ?? null,
      notificationPreview: [
        {
          channel: "sms",
          recipient: student.guardianPhone,
          message: `${student.fullName} has arrived at the KCS school entrance.`
        }
      ]
    };
  };

  const runScan = async (studentId: string | undefined, direction: AttendanceDirection) => {
    navigateToView("gate");
    setGateState("scanning");
    setScanResult(null);
    setScanMessage(
      studentId
        ? direction === "exit"
          ? "Lecture de l'empreinte et enregistrement de la sortie en cours..."
          : "Lecture de l'empreinte et comparaison en cours..."
        : "Empreinte inconnue détectée. Vérification en cours..."
    );

    await delay(1400);

    try {
      const response = await sentinelFetch(`${API_URL}/gate/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, entryPoint: ENTRY_POINT, direction })
      });
      const payload = (await response.json()) as GateScanResponse;

      if (!response.ok || !payload.matched) {
        setGateState("error");
        setScanResult(payload);
        setScanMessage(payload.message ?? "Empreinte non reconnue.");
        return;
      }

      setGateState("success");
      setScanResult(payload);
      setScanMessage(payload.message ?? getSuccessScanMessage(direction, payload.duplicate));
      await refreshOverview();
    } catch {
      const payload = buildFallbackScan(studentId, direction);
      if (!payload.matched || !payload.student) {
        setGateState("error");
        setScanResult(payload);
        setScanMessage(payload.message ?? "Empreinte non reconnue.");
        return;
      }

      setGateState("success");
      setScanResult(payload);
      setScanMessage(payload.message ?? getSuccessScanMessage(direction, payload.duplicate));
      applyLocalAttendanceEvent(payload.student, direction, payload.duplicate);
    }
  };

  const enrollFingerprint = async () => {
    if (!selectedStudent) {
      setGateState("error");
      setScanMessage("Sélectionnez d'abord un élève à enrôler.");
      return;
    }

    setGateState("scanning");
    setScanResult(null);
    setScanMessage(`Capture de l'empreinte ${selectedFinger.toLowerCase()} pour ${selectedStudent.fullName}...`);

    await delay(1200);

    try {
      const response = await sentinelFetch(`${API_URL}/biometrics/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudent.id, template: `fp:${selectedStudent.id}:${selectedFinger.toLowerCase().replace(/\s+/g, "-")}` })
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setGateState("error");
        setScanMessage(payload?.message ?? "Échec de capture ou d'enrôlement de l'empreinte.");
        return;
      }

      setGateState("success");
      setScanMessage(`Empreinte enregistrée avec succès pour ${selectedStudent.fullName}.`);
      setScanResult({
        matched: true,
        confidence: 1,
        duplicate: false,
        student: { ...selectedStudent, hasBiometric: true }
      });
      await refreshOverview();
    } catch {
      applyLocalEnrollment(selectedStudent.id);
      setGateState("success");
      setScanMessage(`Empreinte enregistrée localement pour ${selectedStudent.fullName}.`);
      setScanResult({
        matched: true,
        confidence: 1,
        duplicate: false,
        student: { ...selectedStudent, hasBiometric: true }
      });
    }
  };

  const handleSensorTouch = async () => {
    if (gateState === "scanning") {
      return;
    }

    setSensorPressed(true);
    try {
      if (sensorMode === "enroll") {
        await enrollFingerprint();
      } else {
        await runScan(selectedStudentId, sensorMode === "exit" ? "exit" : "entry");
      }
    } finally {
      window.setTimeout(() => setSensorPressed(false), 260);
    }
  };

  const isValidSensorPlacement = (clientX: number, clientY: number) => {
    const sensorSurface = sensorSurfaceRef.current;
    if (!sensorSurface) {
      return true;
    }

    const rect = sensorSurface.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    const acceptedRadius = Math.min(rect.width, rect.height) * SENSOR_TOUCH_RADIUS_RATIO;

    return distance <= acceptedRadius;
  };

  const rejectBadSensorPlacement = () => {
    setGateState("error");
    setScanResult(null);
    setSensorPressed(false);
    setScanMessage("Doigt mal positionné. Placez-le au centre du capteur puis recommencez.");
  };

  const handleSensorRelease = async (clientX: number, clientY: number) => {
    if (!isValidSensorPlacement(clientX, clientY)) {
      rejectBadSensorPlacement();
      return;
    }

    await handleSensorTouch();
  };

  const exportDisciplinaryRegisterPdf = () => {
    if (!disciplinaryRegister) {
      return;
    }

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.setFillColor(8, 17, 32);
    pdf.roundedRect(12, 10, 186, 24, 6, 6, "F");
    pdf.setTextColor(236, 248, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text("KCS SENTINEL", 18, 20);
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.text("Registre disciplinaire imprimable", 18, 27);

    pdf.setTextColor(8, 17, 32);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text(disciplinaryRegister.student.fullName, 14, 46);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.text(`Matricule: ${disciplinaryRegister.student.id}`, 14, 54);
    pdf.text(`Classe: ${disciplinaryRegister.student.className}`, 14, 60);
    pdf.text(`Contact parent: ${disciplinaryRegister.student.guardianPhone}`, 14, 66);
    pdf.text(`Genere le: ${formatDateTimeValue(disciplinaryRegister.generatedAt)}`, 14, 72);

    autoTable(pdf, {
      startY: 80,
      head: [["Periode", "Frequence", "Presences", "Retards", "Absences", "Jours scolaires"]],
      body: disciplinaryRegister.summaries.map((summary) => [
        summary.label,
        `${summary.frequencyRate}%`,
        String(summary.presentCount),
        String(summary.lateCount),
        String(summary.absentCount),
        String(summary.expectedSchoolDays)
      ]),
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [8, 17, 32] }
    });

    autoTable(pdf, {
      startY: (pdf as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ? ((pdf as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 80) + 10 : 128,
      head: [["Date", "Entree", "Sortie", "Statut", "Point d'acces"]],
      body: disciplinaryRegister.history.map((item) => [
        formatDateValue(item.entryTimestamp),
        formatTimeValue(item.entryTimestamp),
        formatTimeValue(item.exitTimestamp),
        item.status,
        item.entryPoint
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [48, 216, 255], textColor: [8, 17, 32] }
    });

    pdf.save(`registre-disciplinaire-${disciplinaryRegister.student.id}.pdf`);
  };

  const saveCalendarDay = async () => {
    const payload: SchoolCalendarDay = {
      date: calendarDate,
      label: calendarLabel,
      isSchoolDay: calendarIsSchoolDay
    };

    try {
      const response = await sentinelFetch(`${API_URL}/calendar/days`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Calendar save failed");
      }

      const saved = (await response.json()) as SchoolCalendarDay;
      setCalendarDays((current) => {
        const filtered = current.filter((item) => item.date !== saved.date);
        return [...filtered, saved].sort((left, right) => left.date.localeCompare(right.date));
      });

      await refreshOverview();
      if (selectedStudent) {
        setDisciplinaryRegister((current) => current ? { ...current, generatedAt: new Date().toISOString() } : current);
      }
    } catch {
      setCalendarDays((current) => {
        const filtered = current.filter((item) => item.date !== payload.date);
        return [...filtered, payload].sort((left, right) => left.date.localeCompare(right.date));
      });
    }
  };

  const removeCalendarDay = async (date: string) => {
    try {
      await sentinelFetch(`${API_URL}/calendar/days/${date}`, { method: "DELETE" });
    } finally {
      setCalendarDays((current) => current.filter((item) => item.date !== date));
      await refreshOverview();
    }
  };

  const renderAttendanceRegister = () => (
    <div className="mt-6 rounded-[28px] border border-white/10 bg-slate-950/45 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Registre des présences du jour</div>
          <div className="mt-2 text-sm text-slate-300">Cette zone affiche clairement chaque élève présent avec la date exacte, l'heure d'entrée et, dès qu'elle est enregistrée, l'heure de sortie.</div>
        </div>
        <div className="max-w-full rounded-full border border-white/10 bg-white/5 px-3 py-2 text-center text-[11px] uppercase tracking-[0.18em] text-slate-300 sm:text-xs sm:tracking-[0.24em]">
          {attendanceLog.length} élève(s) pointé(s)
        </div>
      </div>

      {attendanceLog.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-slate-300">
          Aucun élève n'a encore été enregistré aujourd'hui. Utilisez le capteur en mode vérification pour l'entrée, puis en mode sortie pour l'heure de départ.
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-3 md:hidden">
            {attendanceLog.map((item) => (
              <article key={item.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words text-lg font-medium text-white">{item.studentName}</div>
                    <div className="mt-1 break-words text-sm text-slate-300">{item.className}</div>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${item.exitTimestamp ? "bg-signal/15 text-signal" : "bg-amber-500/15 text-amber-200"}`}>
                    {item.exitTimestamp ? "Sortie faite" : "En attente sortie"}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Date</div>
                    <div className="mt-2 text-sm text-white">{formatDateValue(item.entryTimestamp)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Entrée</div>
                    <div className="mt-2 text-sm text-white">{formatTimeValue(item.entryTimestamp)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Sortie</div>
                    <div className="mt-2 text-sm text-white">{formatTimeValue(item.exitTimestamp)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Point d'accès</div>
                    <div className="mt-2 break-words text-sm text-white">{item.entryPoint}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="min-w-full border-separate border-spacing-y-3 text-left text-sm text-slate-200">
              <thead>
                <tr className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  <th className="px-4 py-2 font-medium">Élève</th>
                  <th className="px-4 py-2 font-medium">Classe</th>
                  <th className="px-4 py-2 font-medium">Date exacte</th>
                  <th className="px-4 py-2 font-medium">Entrée</th>
                  <th className="px-4 py-2 font-medium">Sortie</th>
                  <th className="px-4 py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {attendanceLog.map((item) => (
                  <tr key={item.id} className="rounded-3xl bg-white/[0.03]">
                    <td className="rounded-l-3xl px-4 py-4 font-medium text-white">{item.studentName}</td>
                    <td className="px-4 py-4">{item.className}</td>
                    <td className="px-4 py-4">{formatDateValue(item.entryTimestamp)}</td>
                    <td className="px-4 py-4">{formatTimeValue(item.entryTimestamp)}</td>
                    <td className="px-4 py-4">{formatTimeValue(item.exitTimestamp)}</td>
                    <td className="rounded-r-3xl px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.16em] ${item.exitTimestamp ? "bg-signal/15 text-signal" : "bg-amber-500/15 text-amber-200"}`}>
                        {item.exitTimestamp ? "Sortie faite" : "Présent"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );

  const renderDisciplinaryRegister = () => {
    if (!disciplinaryRegister || !selectedStudent) {
      return null;
    }

    return (
      <section className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Registre disciplinaire</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Bilan de fréquence élève</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Cette section calcule le bilan journalier, hebdomadaire, mensuel et annuel des présences, retards et absences de l'élève. L'historique détaillé reste traçable et peut etre exporte en PDF pour le registre disciplinaire.
            </p>
          </div>
          <button
            type="button"
            onClick={exportDisciplinaryRegisterPdf}
            className="rounded-2xl bg-cyan px-5 py-3 text-sm font-semibold text-slate-950"
          >
            Exporter le PDF
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-5">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Élève sélectionné</div>
            <div className="mt-3 break-words text-2xl font-semibold text-white">{disciplinaryRegister.student.fullName}</div>
            <div className="mt-2 break-words text-sm text-slate-300">{disciplinaryRegister.student.className} · {disciplinaryRegister.student.id}</div>
            <div className="mt-1 break-words text-sm text-slate-300">Contact parent : {disciplinaryRegister.student.guardianPhone}</div>
            <div className="mt-3 text-xs uppercase tracking-[0.2em] text-cyan">Dernière génération : {formatDateTimeValue(disciplinaryRegister.generatedAt)}</div>
          </div>
          <label className="rounded-3xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-400">Choisir un élève</div>
            <select
              value={selectedStudentId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none"
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName} - {student.className}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {disciplinaryRegister.summaries.map((summary) => (
            <article key={summary.period} className="rounded-3xl border border-white/10 bg-slate-950/45 p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{summary.label}</div>
              <div className="mt-4 text-4xl font-semibold text-white">{summary.frequencyRate}%</div>
              <div className="mt-2 text-sm text-slate-300">Fréquence de présence</div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Présences</div>
                  <div className="mt-1 text-lg font-medium text-white">{summary.presentCount}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Retards</div>
                  <div className="mt-1 text-lg font-medium text-amber-200">{summary.lateCount}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Absences</div>
                  <div className="mt-1 text-lg font-medium text-rose-200">{summary.absentCount}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Jours scolaires</div>
                  <div className="mt-1 text-lg font-medium text-white">{summary.expectedSchoolDays}</div>
                </div>
              </div>
              <div className="mt-4 text-xs uppercase tracking-[0.16em] text-slate-500">
                Période : {formatDateKeyValue(summary.startDate)} au {formatDateKeyValue(summary.endDate)}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/45 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Historique traçable</div>
              <div className="mt-2 text-sm text-slate-300">Chaque ligne peut être utilisée dans le registre disciplinaire de l'élève avec date, entrée, sortie et statut.</div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-slate-300">
              {disciplinaryRegister.history.length} trace(s)
            </div>
          </div>

          <div className="mt-5 space-y-3 lg:hidden">
            {disciplinaryRegister.history.map((item) => (
              <article key={item.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-white">{formatDateValue(item.entryTimestamp)}</div>
                  <div className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.16em] ${item.status === "late" ? "bg-amber-500/15 text-amber-200" : "bg-cyan/15 text-cyan"}`}>
                    {item.status}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Entrée</div>
                    <div className="mt-2 text-sm text-white">{formatTimeValue(item.entryTimestamp)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Sortie</div>
                    <div className="mt-2 text-sm text-white">{formatTimeValue(item.exitTimestamp)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3 sm:col-span-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Point d'accès</div>
                    <div className="mt-2 break-words text-sm text-white">{item.entryPoint}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto lg:block">
            <table className="min-w-full border-separate border-spacing-y-3 text-left text-sm text-slate-200">
              <thead>
                <tr className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Entrée</th>
                  <th className="px-4 py-2 font-medium">Sortie</th>
                  <th className="px-4 py-2 font-medium">Statut</th>
                  <th className="px-4 py-2 font-medium">Point d'accès</th>
                </tr>
              </thead>
              <tbody>
                {disciplinaryRegister.history.map((item) => (
                  <tr key={item.id} className="rounded-3xl bg-white/[0.03]">
                    <td className="rounded-l-3xl px-4 py-4">{formatDateValue(item.entryTimestamp)}</td>
                    <td className="px-4 py-4">{formatTimeValue(item.entryTimestamp)}</td>
                    <td className="px-4 py-4">{formatTimeValue(item.exitTimestamp)}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.16em] ${item.status === "late" ? "bg-amber-500/15 text-amber-200" : "bg-cyan/15 text-cyan"}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="rounded-r-3xl px-4 py-4 break-words">{item.entryPoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/45 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Calendrier scolaire configurable</div>
              <div className="mt-2 text-sm text-slate-300">Ajoutez ici les jours feries et jours non ouvres pour qu'ils ne soient pas comptes comme absences disciplinaires.</div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-slate-300">
              {calendarDays.length} exception(s)
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_220px_auto]">
            <label className="text-sm text-slate-200">
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Date</div>
              <input type="date" value={calendarDate} onChange={(event) => setCalendarDate(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none" />
            </label>
            <label className="text-sm text-slate-200">
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Libelle</div>
              <input type="text" value={calendarLabel} onChange={(event) => setCalendarLabel(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none" />
            </label>
            <label className="text-sm text-slate-200">
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Type de jour</div>
              <select value={calendarIsSchoolDay ? "school" : "off"} onChange={(event) => setCalendarIsSchoolDay(event.target.value === "school")} className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none">
                <option value="off">Jour non ouvre / ferie</option>
                <option value="school">Jour scolaire exceptionnel</option>
              </select>
            </label>
            <button type="button" onClick={() => { void saveCalendarDay(); }} className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 lg:self-end">
              Enregistrer
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {calendarDays.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                Aucun jour special configure pour le moment.
              </div>
            ) : (
              calendarDays.map((day) => (
                <div key={day.date} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{formatDateKeyValue(day.date)}</div>
                    <div className="mt-1 break-words text-sm text-slate-300">{day.label}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.16em] ${day.isSchoolDay ? "bg-cyan/15 text-cyan" : "bg-amber-500/15 text-amber-200"}`}>
                      {day.isSchoolDay ? "Jour scolaire" : "Non ouvre"}
                    </span>
                    <button type="button" onClick={() => { void removeCalendarDay(day.date); }} className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-100">
                      Supprimer
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderDashboardHome = () => (
    <>
      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => {
          const value = overview.metrics[card.key];
          return (
            <article
              key={card.key}
              className={`rounded-[26px] border border-white/10 bg-gradient-to-br ${card.tone} p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl`}
            >
              <div className="text-sm uppercase tracking-[0.18em] text-slate-300 sm:tracking-[0.24em]">{card.label}</div>
              <div className="mt-4 break-words text-3xl font-semibold text-white sm:text-4xl">
                {value}
                {card.suffix ?? ""}
              </div>
              <div className="mt-3 text-sm text-slate-300">{overview.storageMode ?? "Persistent ledger ready for integration."}</div>
            </article>
          );
        })}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live Attendance Feed</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Real-time biometric confirmations</h2>
            </div>
            <button
              type="button"
              onClick={() => navigateToView("liveFeed")}
              className="rounded-full border border-cyan/20 bg-cyan/10 px-4 py-2 text-sm text-cyan"
            >
              Ouvrir le flux complet
            </button>
          </div>
          <div className="mt-6 space-y-4">
            {overview.liveFeed.slice(0, 4).map((item) => (
              <div key={item.id} className="grid gap-4 rounded-3xl border border-white/5 bg-slate-950/45 p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="break-words text-lg font-medium text-white">{item.studentName}</h3>
                    <span className="max-w-full rounded-full border border-white/10 px-3 py-1 text-center text-xs uppercase tracking-[0.16em] text-slate-300 sm:tracking-[0.2em]">{item.className}</span>
                    <span className={`max-w-full rounded-full px-3 py-1 text-center text-xs uppercase tracking-[0.16em] sm:tracking-[0.2em] ${item.status === "late" ? "bg-amber-500/15 text-amber-200" : "bg-cyan/15 text-cyan"}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-sm text-slate-300">
                    Entry point: {item.entryPoint} · Source: {item.source} · Verified at {new Date(item.timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <div className="break-words text-left text-sm text-slate-400 md:text-right">{item.studentId}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Threat & Insight Layer</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">AI readiness matrix</h2>
            <div className="mt-5 space-y-3">
              {Object.entries(overview.aiReadiness).map(([key, value]) => (
                <div key={key} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-950/45 px-4 py-3">
                  <span className="min-w-0 break-words capitalize text-slate-200">{key.replace(/([A-Z])/g, " $1")}</span>
                  <span className={`max-w-full rounded-full px-3 py-1 text-center text-xs uppercase tracking-[0.16em] sm:tracking-[0.2em] ${value ? "bg-signal/15 text-signal" : "bg-white/10 text-slate-300"}`}>
                    {value ? "Ready" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Platform Pillars</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Parcours opérateur</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => navigateToView("disciplinary")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
                >
                  Registre
                </button>
                <button
                  type="button"
                  onClick={() => navigateToView("attendance")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
                >
                  Historique
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-4">
              {pillars.map((pillar) => (
                <article key={pillar.title} className="rounded-3xl border border-white/5 bg-slate-950/45 p-5">
                  <h3 className="text-lg font-medium text-white">{pillar.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{pillar.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );

  const renderLiveFeedPage = () => (
    <section className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live Attendance Feed</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Toutes les confirmations biométriques</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Cette page regroupe uniquement le flux temps réel pour éviter de faire défiler tout le dashboard lorsqu'on supervise les arrivées.
          </p>
        </div>
        <div className="max-w-full rounded-full border border-signal/30 bg-signal/10 px-4 py-2 text-center text-sm text-signal">{overview.metrics.present + overview.metrics.late} pointages du jour</div>
      </div>
      <div className="mt-6 space-y-4">
        {overview.liveFeed.map((item) => (
          <div key={item.id} className="grid gap-4 rounded-3xl border border-white/5 bg-slate-950/45 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="break-words text-lg font-medium text-white">{item.studentName}</h3>
                <span className="max-w-full rounded-full border border-white/10 px-3 py-1 text-center text-xs uppercase tracking-[0.16em] text-slate-300 sm:tracking-[0.2em]">{item.className}</span>
                <span className={`max-w-full rounded-full px-3 py-1 text-center text-xs uppercase tracking-[0.16em] sm:tracking-[0.2em] ${item.status === "late" ? "bg-amber-500/15 text-amber-200" : "bg-cyan/15 text-cyan"}`}>
                  {item.status}
                </span>
              </div>
              <p className="mt-2 break-words text-sm text-slate-300">
                Entry point: {item.entryPoint} · Source: {item.source} · Verified at {new Date(item.timestamp).toLocaleTimeString()}
              </p>
            </div>
            <div className="break-words text-left text-sm text-slate-400 md:text-right">{item.studentId}</div>
          </div>
        ))}
      </div>
    </section>
  );

  const renderActivePage = () => {
    switch (activeView) {
      case "dashboard":
        return renderDashboardHome();
      case "liveFeed":
        return renderLiveFeedPage();
      case "disciplinary":
        return renderDisciplinaryRegister();
      case "attendance":
        return renderAttendanceRegister();
      default:
        return null;
    }
  };

  const renderDesktopNavigation = () => {
    if (kioskMode) {
      return null;
    }

    return (
      <aside className="sentinel-side-nav hidden md:block">
        <div className="sticky top-[88px] min-h-[calc(100dvh-100px)] rounded-r-[18px] border border-l-0 border-white/10 bg-white/[0.05] p-2 shadow-glow backdrop-blur-xl">
          <div className="px-2 pb-2 pt-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan">Navigation Sentinel</div>
          </div>
          <div className="space-y-1.5">
            {navigationItems.map((item) => {
              const isActive = activeView === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigateToView(item.key)}
                  className={`sentinel-nav-item w-full rounded-xl border px-2.5 py-2 text-left transition ${isActive ? `${item.activeClass} border-transparent shadow-[0_12px_26px_rgba(15,23,42,0.22)]` : "border-white/10 bg-slate-950/35 text-white hover:border-white/20 hover:bg-white/[0.06]"}`}
                >
                  <div className={`text-[9px] uppercase tracking-[0.16em] ${isActive ? "text-slate-700/80" : "text-slate-400"}`}>{item.eyebrow}</div>
                  <div className="mt-1 text-[13px] font-semibold leading-tight">{item.label}</div>
                </button>
              );
            })}
          </div>
          {onLogout && <button type="button" onClick={onLogout} className="sentinel-nav-item mt-3 w-full rounded-xl border border-rose-300/20 bg-rose-400/10 px-2.5 py-2 text-left text-rose-100 transition hover:bg-rose-400/20"><div className="text-[9px] uppercase tracking-[0.16em] text-rose-200/75">Session</div><div className="mt-1 text-[13px] font-semibold leading-tight">{language === "fr" ? "Déconnexion" : "Sign out"}</div></button>}
        </div>
      </aside>
    );
  };

  const renderMobileNavigation = () => {
    if (kioskMode) {
      return null;
    }

    return (
      <nav aria-label="Navigation principale" className={`sentinel-mobile-nav fixed inset-x-2 bottom-2 z-50 grid ${onLogout ? "grid-cols-6" : "grid-cols-5"} gap-1 rounded-2xl border border-cyan/20 bg-[#032942]/95 p-1.5 shadow-[0_18px_55px_rgba(0,10,22,.7)] backdrop-blur-xl md:hidden`}>
        {navigationItems.map((item) => {
          const isActive = activeView === item.key;
          const icon = ({ gate: "⌁", dashboard: "⌂", liveFeed: "◉", disciplinary: "▤", attendance: "◷" } as const)[item.key];
          return <button key={item.key} type="button" aria-current={isActive ? "page" : undefined} onClick={() => navigateToView(item.key)} className={`flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-center transition active:scale-95 ${isActive ? item.activeClass : "text-slate-300 hover:bg-white/5"}`}><span aria-hidden="true" className="text-base leading-none">{icon}</span><span className="mt-1 max-w-full truncate text-[9px] font-bold leading-none">{item.shortLabel}</span></button>;
        })}
        {onLogout && <button type="button" onClick={onLogout} className="flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-center text-rose-200 transition active:scale-95"><span aria-hidden="true" className="text-base leading-none">↪</span><span className="mt-1 max-w-full truncate text-[9px] font-bold leading-none">{language === "fr" ? "Sortir" : "Exit"}</span></button>}
      </nav>
    );
  };

  return (
    <div className="sentinel-app-shell sentinel-kitchen-surface min-h-screen text-ink">
      <div className={`${kioskMode ? "min-h-screen p-3" : "min-h-screen w-full pb-24 md:pb-8"}`}>
        <header className="sentinel-command-header sticky top-0 z-30 w-full overflow-hidden border-b border-white/10 bg-white/5 px-3 py-3 shadow-glow backdrop-blur-xl sm:px-5 lg:px-6">
          <div className="absolute inset-0 bg-grid bg-[size:32px_32px] opacity-20" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex flex-col gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <SchoolLogo />
              </div>
              <div className="sentinel-compact-status inline-flex w-fit items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-xs text-cyan">
                <span className="h-2 w-2 rounded-full bg-signal shadow-[0_0_12px_rgba(28,231,176,0.9)]" />
                {online ? status : "Mode résilient hors connexion"}
              </div>
            </div>

            <div className="sentinel-header-actions hidden flex-wrap gap-3 md:flex">
              <div className="flex rounded-xl border border-cyan/30 bg-[#032942]/80 p-1" aria-label="Langue"><button type="button" onClick={() => onLanguageChange?.("fr")} className={`rounded-lg px-3 py-2 text-xs font-black transition ${language === "fr" ? "bg-cyan text-[#032942]" : "text-white hover:bg-white/10"}`}>FR</button><button type="button" onClick={() => onLanguageChange?.("en")} className={`rounded-lg px-3 py-2 text-xs font-black transition ${language === "en" ? "bg-cyan text-[#032942]" : "text-white hover:bg-white/10"}`}>EN</button></div>
              {!kioskMode && (
                <div className="hidden rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300 md:block">
                  Page active : <span className="font-semibold text-white">{navigationItems.find((item) => item.key === activeView)?.label ?? "Dashboard"}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  void handleInstall();
                }}
                className="rounded-2xl border border-neon/20 bg-neon/15 px-5 py-3 text-sm font-semibold text-white max-sm:w-full"
              >
                Installer l'app
              </button>
              {!kioskMode ? (
                <button
                  type="button"
                  onClick={() => {
                    void enterKioskMode();
                  }}
                  className="rounded-2xl bg-cyan px-5 py-3 text-sm font-semibold text-slate-950 max-sm:w-full"
                >
                  Mode kiosque
                </button>
              ) : (
                <button
                  type="button"
                  onPointerDown={beginUnlockHold}
                  onPointerUp={cancelUnlockHold}
                  onPointerLeave={cancelUnlockHold}
                  onPointerCancel={cancelUnlockHold}
                  className={`rounded-2xl px-5 py-3 text-sm font-semibold max-sm:w-full ${unlockHolding ? "bg-amber-400 text-slate-950" : "border border-white/10 bg-white/5 text-white"}`}
                >
                  {unlockHolding ? "Maintenez pour sortir" : "Déverrouiller"}
                </button>
              )}
              {onLogout && <button type="button" onClick={onLogout} className="rounded-2xl border border-rose-300/25 bg-rose-400/10 px-5 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-400/20">{language === "fr" ? "Déconnexion" : "Sign out"}</button>}
            </div>
          </div>
        </header>

        <div className={`sentinel-workspace ${kioskMode ? "mt-4" : "md:grid md:grid-cols-[176px_minmax(0,1fr)] lg:grid-cols-[188px_minmax(0,1fr)]"}`}>
          {renderDesktopNavigation()}

          <main className="min-w-0 overflow-hidden px-3 pt-4 sm:px-5 lg:px-6">
        {activeView === "gate" ? (
          <section className={`min-h-[calc(100vh-13rem)] gap-6 ${gateWorkspace === "operations" ? "grid xl:grid-cols-[1.05fr_0.95fr]" : "block"}`}>
            <div className="rounded-[32px] border border-white/10 bg-white/[0.05] p-5 shadow-glow backdrop-blur-xl sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.32em] text-slate-400">School Entrance Station</div>
                  <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Poste d'entrée biométrique</h1>
                </div>
                <div className="max-w-full rounded-full border border-cyan/20 bg-cyan/10 px-4 py-2 text-center text-xs uppercase tracking-[0.2em] text-cyan sm:tracking-[0.24em]">{ENTRY_POINT}</div>
              </div>

              <div className="mt-5 grid gap-2 rounded-2xl border border-white/10 bg-slate-950/55 p-2 sm:grid-cols-3" role="tablist" aria-label="Espaces du poste d'entrée">
                {([
                  ["identity", "Identités & visiteurs", "Recherche Orbit et pointage nominatif"],
                  ["biometric", "Biométrie", "Empreintes et enrôlement"],
                  ["operations", "Suivi opérationnel", "Registre, guide et flux live"]
                ] as const).map(([workspace, label, description]) => (
                  <button
                    key={workspace}
                    type="button"
                    role="tab"
                    aria-selected={gateWorkspace === workspace}
                    onClick={() => setGateWorkspace(workspace)}
                    className={`rounded-xl px-4 py-3 text-left transition ${gateWorkspace === workspace ? "bg-cyan text-slate-950 shadow-lg" : "text-slate-200 hover:bg-white/5"}`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className={`mt-1 block text-[11px] ${gateWorkspace === workspace ? "text-slate-800" : "text-slate-400"}`}>{description}</span>
                  </button>
                ))}
              </div>

              <div className={`${gateWorkspace === "identity" ? "block" : "hidden"} mt-6 rounded-[28px] border border-cyan/20 bg-slate-950/45 p-4 sm:p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.24em] text-cyan">Pointage universel et registre nominatif</div>
                    <h2 className="mt-2 text-xl font-semibold text-white">Identifier une entité KCS ou un visiteur</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">L'heure enregistrée vient du serveur Sentinel/PostgreSQL. Le fuseau de l'appareil est détecté automatiquement pour l'affichage local, sans pouvoir modifier l'heure officielle.</p>
                  </div>
                  <div className="max-w-full rounded-2xl border border-signal/25 bg-signal/10 px-4 py-3 text-xs leading-5 text-signal">
                    <strong className="block text-white">Heure officielle serveur</strong>
                    {clockReference ? formatDateTimeValue(clockReference.serverUtc) : "Synchronisation…"}<br />
                    <span className="text-slate-300">Fuseau détecté : {deviceContext.timezone}</span>
                  </div>
                </div>

                {movementNotice && <div className="mt-4 rounded-2xl border border-cyan/20 bg-cyan/10 px-4 py-3 text-sm leading-6 text-cyan">{movementNotice}</div>}

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Entités KCS · registre Orbit</div>
                    <div className="mt-3 grid gap-2 rounded-2xl border border-cyan/15 bg-cyan/5 p-3 sm:grid-cols-2"><label className="text-[11px] font-semibold text-slate-300">Rapport du<input type="date" value={managerReportFrom} onChange={(event) => setManagerReportFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label><label className="text-[11px] font-semibold text-slate-300">Au<input type="date" value={managerReportTo} onChange={(event) => setManagerReportTo(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label><p className="text-[11px] leading-5 text-slate-400 sm:col-span-2">Ces dates s’appliquent au bouton Rapport PDF de chaque identité Orbit.</p></div>
                    <label className="mt-3 block text-sm font-medium text-white" htmlFor="orbit-person-search">Nom, e-mail, code ou identifiant Orbit</label>
                    <input id="orbit-person-search" value={orbitSearch} onChange={(event) => setOrbitSearch(event.target.value)} placeholder="Rechercher une entité KCS…" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none" />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className={orbitDirectoryError ? "text-amber-200" : "text-slate-400"}>{orbitDirectoryLoading ? "Recherche sécurisée dans Orbit…" : orbitDirectoryError || `${orbitDirectory.length} identité(s) disponible(s)`}</span>
                      <button type="button" onClick={() => { setOrbitDirectoryLoading(true); sentinelFetch(`${API_URL}/directory?refresh=true${orbitSearch.trim() ? `&q=${encodeURIComponent(orbitSearch.trim())}` : ""}`).then(async response => { if (!response.ok) throw new Error(); const payload = await response.json() as { people: OrbitDirectoryPerson[] }; setOrbitDirectory(payload.people ?? []); setOrbitDirectoryError(""); }).catch(() => setOrbitDirectoryError("La resynchronisation Orbit a échoué." )).finally(() => setOrbitDirectoryLoading(false)); }} className="rounded-lg border border-white/10 px-3 py-1.5 font-semibold text-cyan hover:bg-white/5">Resynchroniser</button>
                    </div>
                    <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                      {visibleOrbitPeople.map((person) => (
                        <article key={person.id} className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="break-words font-semibold text-white">{person.fullName}</div>
                              <div className="mt-1 break-words text-xs text-slate-400">{person.kind} · {person.displayId || person.id}{person.className ? ` · ${person.className}` : ""}</div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <button type="button" disabled={Boolean(reportBusyPersonId) || managerReportFrom > managerReportTo} onClick={() => void exportOrbitAttendancePdf(person)} className="rounded-xl border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-xs font-semibold text-teal-100 disabled:opacity-50">{reportBusyPersonId === person.id ? "Génération…" : "Rapport PDF"}</button>
                              {(["ENTRY", "EXIT"] as const).map((direction) => {
                                const key = `ORBIT:${person.id}:${direction}`;
                                return <button key={direction} type="button" disabled={Boolean(movementBusy)} onClick={() => void registerMovement(person.id, "ORBIT", direction, person.fullName)} className={`rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50 ${direction === "ENTRY" ? "bg-cyan text-slate-950" : "border border-white/10 bg-white/5 text-white"}`}>{movementBusy === key ? "Traitement…" : direction === "ENTRY" ? "Entrée" : "Sortie"}</button>;
                              })}
                            </div>
                          </div>
                        </article>
                      ))}
                      {visibleOrbitPeople.length === 0 && <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">Aucune identité Orbit ne correspond à cette recherche.</p>}
                    </div>
                  </section>

                  <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Visiteurs · identité nominative</div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <input value={visitorForm.lastName} onChange={(event) => setVisitorForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Nom *" className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white" />
                      <input value={visitorForm.middleName} onChange={(event) => setVisitorForm((current) => ({ ...current, middleName: event.target.value }))} placeholder="Post-nom" className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white" />
                      <input value={visitorForm.firstName} onChange={(event) => setVisitorForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="Prénom *" className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white" />
                      <input value={visitorForm.purpose} onChange={(event) => setVisitorForm((current) => ({ ...current, purpose: event.target.value }))} placeholder="Motif de visite *" className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white sm:col-span-2" />
                      <input value={visitorForm.hostName} onChange={(event) => setVisitorForm((current) => ({ ...current, hostName: event.target.value }))} placeholder="Personne visitée *" className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white" />
                    </div>
                    <button type="button" disabled={Boolean(movementBusy) || !visitorForm.lastName.trim() || !visitorForm.firstName.trim() || !visitorForm.purpose.trim() || !visitorForm.hostName.trim()} onClick={() => void createVisitor()} className="mt-3 w-full rounded-xl bg-neon px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{movementBusy === "visitor:create" ? "Enregistrement…" : "Enregistrer le visiteur"}</button>
                    <label className="mt-4 block text-sm font-medium text-white" htmlFor="visitor-search">Retrouver un visiteur par son nom complet</label>
                    <input id="visitor-search" value={visitorSearch} onChange={(event) => setVisitorSearch(event.target.value)} placeholder="Nom, post-nom ou prénom…" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none" />
                    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                      {visibleVisitors.map((visitor) => (
                        <article key={visitor.id} className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0"><div className="break-words font-semibold text-white">{visitor.full_name}</div><div className="mt-1 break-words text-xs text-slate-400">{visitor.purpose || "Visiteur"}{visitor.host_name ? ` · visite ${visitor.host_name}` : ""}</div><div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold"><span className="rounded-full bg-cyan/10 px-2 py-1 text-cyan">{visitor.visit_count || 0} visite(s) liée(s)</span>{visitor.last_visit_at && <span className="rounded-full bg-white/5 px-2 py-1 text-slate-300">Dernière : {formatDateTimeValue(visitor.last_visit_at)}</span>}</div></div>
                            <div className="flex shrink-0 gap-2">
                              <button type="button" disabled={Boolean(reportBusyPersonId) || managerReportFrom > managerReportTo} onClick={() => void exportVisitorReportPdf(visitor)} className="rounded-xl border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-xs font-semibold text-teal-100 disabled:opacity-50">{reportBusyPersonId === visitor.id ? "Génération…" : "Rapport"}</button>
                              {(["ENTRY", "EXIT"] as const).map((direction) => {
                                const key = `VISITOR:${visitor.id}:${direction}`;
                                return <button key={direction} type="button" disabled={Boolean(movementBusy)} onClick={() => void registerMovement(visitor.id, "VISITOR", direction, visitor.full_name)} className={`rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50 ${direction === "ENTRY" ? "bg-cyan text-slate-950" : "border border-white/10 bg-white/5 text-white"}`}>{movementBusy === key ? "Traitement…" : direction === "ENTRY" ? "Entrée" : "Sortie"}</button>;
                              })}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              </div>

              <div className={`${gateWorkspace === "biometric" ? "grid" : "hidden"} mt-6 gap-5 2xl:grid-cols-[0.95fr_1.05fr]`}>
                <div className="rounded-[28px] border border-white/10 bg-slate-950/55 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Capteur d'empreinte</div>
                    <div className="max-w-full rounded-full border border-white/10 bg-white/5 px-3 py-1 text-center text-[11px] uppercase tracking-[0.18em] text-slate-300 sm:tracking-[0.24em]">
                      {getSensorModeLabel(sensorMode)}
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-300">
                    C'est ici que l'élève doit poser son doigt. Si un scanner réel est configuré sur le poste, la lecture matérielle est utilisée; sinon l'application repasse sur la démo locale.
                  </p>
                  <button
                    ref={sensorSurfaceRef}
                    type="button"
                    onPointerDown={() => setSensorPressed(true)}
                    onPointerUp={(event) => {
                      void handleSensorRelease(event.clientX, event.clientY);
                    }}
                    onPointerLeave={() => setSensorPressed(false)}
                    onPointerCancel={() => setSensorPressed(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handleSensorTouch();
                      }
                    }}
                    className="mt-6 flex w-full touch-none justify-center"
                  >
                    <div className={`relative flex h-64 w-64 items-center justify-center rounded-full border transition sm:h-72 sm:w-72 lg:h-80 lg:w-80 ${sensorPressed || gateState === "scanning" ? "scale-[0.98] border-cyan bg-cyan/15" : gateState === "success" ? "border-signal/60 bg-signal/10" : gateState === "error" ? "border-rose-400/60 bg-rose-500/10" : "border-cyan/30 bg-cyan/10"}`}>
                      <div className={`absolute inset-4 rounded-full border sm:inset-6 ${gateState === "scanning" ? "animate-ping border-cyan/40" : "border-white/10"}`} />
                      <div className={`absolute inset-8 rounded-full border sm:inset-12 ${gateState === "scanning" ? "animate-pulse border-neon/40" : "border-white/10"}`} />
                      <div className="absolute inset-[4.1rem] rounded-full border border-dashed border-white/10 sm:inset-[5.4rem]" />
                      <div className="text-center">
                        <img src={logoAssetPath} alt="School scanner mark" className="mx-auto h-20 w-20 rounded-full bg-white object-cover sm:h-24 sm:w-24" />
                        <div className="mt-4 px-4 text-sm font-semibold text-white sm:text-base">Posez le doigt ici</div>
                        <div className="mt-2 px-4 text-[10px] uppercase tracking-[0.2em] text-slate-300 sm:text-xs sm:tracking-[0.28em]">{getSensorPrompt(sensorMode, gateState)}</div>
                        <div className="mt-3 px-4 text-[11px] font-medium text-cyan sm:text-xs">Doigt actif : {selectedFinger}</div>
                      </div>
                    </div>
                  </button>
                  <p className="mt-6 text-center text-base leading-7 text-slate-200">{scanMessage}</p>
                </div>

                <div className={`min-w-0 overflow-hidden rounded-[28px] border p-4 sm:p-5 ${gateState === "success" ? "border-signal/30 bg-signal/10" : gateState === "error" ? "border-rose-400/30 bg-rose-500/10" : "border-white/10 bg-white/[0.04]"}`}>
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400 sm:text-xs sm:tracking-[0.3em]">Confirmation visuelle</div>
                      <h2 className="mt-2 break-words text-base font-semibold leading-tight text-white sm:text-lg lg:text-xl xl:text-2xl">{scanResult?.student?.fullName ?? selectedStudent?.fullName ?? "Aucun élève sélectionné"}</h2>
                    </div>
                    <div className={`max-w-full justify-self-start rounded-full px-4 py-2 text-center text-[11px] uppercase tracking-[0.16em] sm:text-xs sm:tracking-[0.24em] xl:justify-self-end ${gateState === "success" ? "bg-signal/20 text-signal" : gateState === "error" ? "bg-rose-500/20 text-rose-100" : "bg-white/10 text-slate-200"}`}>
                      {sensorMode === "enroll"
                        ? gateState === "success"
                          ? "Empreinte enregistrée"
                          : gateState === "scanning"
                            ? "Capture"
                            : "Prêt à enrôler"
                        : sensorMode === "exit"
                          ? gateState === "success"
                            ? scanResult?.duplicate
                              ? "Sortie déjà faite"
                              : "Sortie enregistrée"
                            : gateState === "scanning"
                              ? "Sortie"
                              : "Prêt sortie"
                          : gateState === "success"
                            ? scanResult?.duplicate
                              ? "Doublon"
                              : "Accès autorisé"
                            : gateState === "error"
                              ? "Accès refusé"
                              : "Prêt"}
                    </div>
                  </div>

                    <div className="mt-6 grid gap-4 xl:grid-cols-2">
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Classe</div>
                      <div className="mt-2 break-words text-base font-medium text-white sm:text-lg">{scanResult?.student?.className ?? selectedStudent?.className ?? "Sélectionnez un élève"}</div>
                    </div>
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Confiance</div>
                      <div className="mt-2 break-words text-base font-medium text-white sm:text-lg">{scanResult ? `${Math.round(scanResult.confidence * 100)}%` : "--"}</div>
                    </div>
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Empreinte enregistrée</div>
                      <div className="mt-2 break-words text-base font-medium text-white sm:text-lg">{selectedStudent?.hasBiometric ? "Oui" : "Non"}</div>
                    </div>
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Doigt de référence</div>
                      <div className="mt-2 break-words text-base font-medium text-white sm:text-lg">{selectedFinger}</div>
                    </div>
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Date exacte</div>
                      <div className="mt-2 break-words text-base font-medium text-white sm:text-lg">{scanResult?.entryTimestamp ? formatDateValue(scanResult.entryTimestamp) : "--/--/----"}</div>
                    </div>
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Heure d'entrée</div>
                      <div className="mt-2 break-words text-base font-medium text-white sm:text-lg">{formatTimeValue(scanResult?.entryTimestamp)}</div>
                    </div>
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Heure de sortie</div>
                      <div className="mt-2 break-words text-base font-medium text-white sm:text-lg">{formatTimeValue(scanResult?.exitTimestamp)}</div>
                    </div>
                      <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-4 xl:col-span-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 sm:text-xs sm:tracking-[0.24em]">Notification / Retour système</div>
                      <div className="mt-2 break-words text-sm leading-6 text-slate-200">{scanResult?.notificationPreview?.[0]?.message ?? scanMessage}</div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3 max-sm:flex-col">
                    <button
                      type="button"
                      onClick={() => setSensorMode("verify")}
                      className={`rounded-2xl px-5 py-3 text-sm font-semibold max-sm:w-full ${sensorMode === "verify" ? "bg-cyan text-slate-950" : "border border-white/10 bg-white/5 text-white"}`}
                    >
                      Vérification de présence
                    </button>
                    <button
                      type="button"
                      onClick={() => setSensorMode("exit")}
                      className={`rounded-2xl px-5 py-3 text-sm font-semibold max-sm:w-full ${sensorMode === "exit" ? "bg-amber-300 text-slate-950" : "border border-white/10 bg-white/5 text-white"}`}
                    >
                      Enregistrer la sortie
                    </button>
                    <button
                      type="button"
                      onClick={() => setSensorMode("enroll")}
                      className={`rounded-2xl px-5 py-3 text-sm font-semibold max-sm:w-full ${sensorMode === "enroll" ? "bg-white text-slate-950" : "border border-white/10 bg-white/5 text-white"}`}
                    >
                      Enrôler / Réenrôler
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGateState("idle");
                        setScanResult(null);
                        setScanMessage(getIdleScanMessage(sensorMode, selectedFinger));
                      }}
                      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white max-sm:w-full"
                    >
                      Réinitialiser
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void runScan(undefined, sensorMode === "exit" ? "exit" : "entry");
                      }}
                      className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-100 max-sm:w-full"
                    >
                      Tester une empreinte inconnue
                    </button>
                  </div>
                </div>
              </div>

              <div className={`${gateWorkspace === "biometric" ? "block" : "hidden"} mt-6 rounded-[28px] border border-white/10 bg-slate-950/45 p-4 sm:p-5`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Liste des élèves</div>
                    <div className="mt-2 text-sm text-slate-300">Choisissez un élève de test, puis utilisez le capteur visible. Si l'élève n'a pas encore d'empreinte, passez d'abord en mode enrôlement.</div>
                  </div>
                  <div className="max-w-full rounded-full border border-white/10 bg-white/5 px-3 py-2 text-center text-[11px] uppercase tracking-[0.18em] text-slate-300 sm:text-xs sm:tracking-[0.24em]">Rotation locked in kiosk when supported</div>
                </div>
                <div className="mt-4 rounded-2xl border border-cyan/20 bg-cyan/10 px-4 py-3 text-sm text-cyan">
                  Doigt actuellement sélectionné : <span className="font-semibold text-white">{selectedFinger}</span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {FINGER_OPTIONS.map((finger) => (
                    <button
                      key={finger}
                      type="button"
                      onClick={() => setSelectedFinger(finger)}
                      aria-pressed={selectedFinger === finger}
                      className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${selectedFinger === finger ? "bg-neon text-white shadow-[0_0_18px_rgba(143,123,255,0.45)]" : "border border-white/10 bg-white/5 text-slate-200"}`}
                    >
                      {selectedFinger === finger ? `Actif • ${finger}` : finger}
                    </button>
                  ))}
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {students.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => setSelectedStudentId(student.id)}
                      className={`rounded-3xl border p-5 text-left transition ${selectedStudentId === student.id ? "border-cyan bg-cyan/10 text-white" : "border-white/10 bg-white/[0.03] text-slate-200"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{student.id}</div>
                        <span className={`max-w-full rounded-full px-3 py-1 text-center text-[11px] uppercase tracking-[0.18em] sm:tracking-[0.24em] ${student.hasBiometric ? "bg-signal/15 text-signal" : "bg-amber-500/15 text-amber-200"}`}>
                          {student.hasBiometric ? "Empreinte OK" : "À enrôler"}
                        </span>
                      </div>
                      <div className="mt-3 break-words text-lg font-semibold sm:text-xl">{student.fullName}</div>
                      <div className="mt-2 break-words text-sm text-slate-300">{student.className}</div>
                      <div className="mt-4 text-xs uppercase tracking-[0.18em] text-slate-400 sm:tracking-[0.24em]">
                        {sensorMode === "enroll"
                          ? `Touchez le capteur pour enregistrer ${selectedFinger.toLowerCase()}`
                          : sensorMode === "exit"
                            ? `Touchez le capteur pour marquer la sortie avec ${selectedFinger.toLowerCase()}`
                            : `Touchez le capteur pour vérifier ${selectedFinger.toLowerCase()}`}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {gateWorkspace === "operations" ? <>
                <section className="mt-6 rounded-[28px] border border-cyan/20 bg-slate-950/45 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs uppercase tracking-[0.25em] text-cyan">Présence du personnel et rapports officiels</div><h2 className="mt-2 text-2xl font-semibold text-white">Employés présents · entrées et sorties</h2><p className="mt-2 text-sm text-slate-300">Le tableau se met à jour automatiquement depuis l’horloge serveur de Kinshasa.</p></div><div className="flex flex-wrap gap-2">{([['daily','Journalier'],['weekly','Hebdomadaire'],['monthly','Mensuel'],['yearly','Annuel']] as const).map(([period,label])=><button key={period} type="button" onClick={()=>setOperationsPeriod(period)} className={`rounded-xl px-3 py-2 text-xs font-bold ${operationsPeriod===period?'bg-cyan text-slate-950':'border border-white/10 bg-white/5 text-white'}`}>{label}</button>)}<button type="button" disabled={!operationsReport||operationsReportBusy} onClick={()=>void exportOperationsPdf()} className="sentinel-primary-action rounded-xl bg-gradient-to-r from-teal-300 to-cyan-300 px-4 py-2 text-xs font-black text-[#032942] disabled:opacity-50"><span className={operationsReportBusy?'sentinel-button-label is-busy':'sentinel-button-label'}>{operationsReportBusy?'Génération…':'Rapport PDF officiel'}</span></button></div></div>
                  {operationsReport && <><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl bg-white/5 p-3"><small className="text-slate-400">Présents maintenant</small><strong className="mt-1 block text-xl text-signal">{operationsReport.summary.presentEmployees}</strong></div><div className="rounded-xl bg-white/5 p-3"><small className="text-slate-400">Entrées</small><strong className="mt-1 block text-xl text-white">{operationsReport.summary.entries}</strong></div><div className="rounded-xl bg-white/5 p-3"><small className="text-slate-400">Sorties</small><strong className="mt-1 block text-xl text-white">{operationsReport.summary.exits}</strong></div><div className="rounded-xl bg-white/5 p-3"><small className="text-slate-400">Visiteurs</small><strong className="mt-1 block text-xl text-white">{operationsReport.summary.visitorMovements}</strong></div></div><div className="mt-4 overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-[#063c65] text-xs uppercase text-cyan-100"><tr><th className="p-3">Employé</th><th className="p-3">Fonction</th><th className="p-3">Entrée</th><th className="p-3">Sortie</th><th className="p-3">État</th></tr></thead><tbody>{operationsReport.employeePresence.map((row)=><tr key={row.person_id} className="border-t border-white/10"><td className="p-3 font-bold text-white">{row.fullName}<small className="block text-slate-400">{row.displayId||''}</small></td><td className="p-3 text-slate-300">{row.jobTitle||row.kind}</td><td className="p-3">{row.firstEntry?formatTimeValue(row.firstEntry):'—'}</td><td className="p-3">{row.lastExit?formatTimeValue(row.lastExit):'—'}</td><td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.latestDirection==='ENTRY'?'bg-signal/15 text-signal':'bg-white/10 text-slate-300'}`}>{row.latestDirection==='ENTRY'?'Présent':'Sorti'}</span></td></tr>)}{!operationsReport.employeePresence.length&&<tr><td colSpan={5} className="p-6 text-center text-slate-400">Aucun mouvement du personnel enregistré aujourd’hui.</td></tr>}</tbody></table></div></>}
                </section>
                {renderAttendanceRegister()}
              </> : null}
            </div>

            <div className={`${gateWorkspace === "operations" ? "grid" : "hidden"} gap-6`}>
              <div className="rounded-[32px] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl sm:p-6">
                <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Guide opérateur</div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-5">
                    <div className="text-sm font-medium text-white">État d'installation</div>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-300">{installState}</p>
                  </div>
                  <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/45 p-5">
                    <div className="text-sm font-medium text-white">Politique appareil</div>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-300">Utilisez le mode kiosque sur la tablette d'entrée pour empêcher les sorties accidentelles du poste biométrique.</p>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {workflow.map((step, index) => (
                    <div key={step} className="flex items-start gap-4 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-sm font-semibold text-cyan">{index + 1}</div>
                      <div className="min-w-0 break-words text-sm leading-6 text-slate-200">{step}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[32px] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Arrivées récentes</div>
                    <h2 className="mt-2 text-2xl font-semibold text-white">Flux live</h2>
                  </div>
                  <div className="max-w-full rounded-full border border-signal/30 bg-signal/10 px-4 py-2 text-center text-sm text-signal">{overview.metrics.present + overview.metrics.late} pointages du jour</div>
                </div>
                <div className="mt-5 space-y-3">
                  {overview.liveFeed.map((item) => (
                    <div key={item.id} className="rounded-3xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-lg font-medium text-white">{item.studentName}</div>
                          <div className="mt-1 break-words text-sm text-slate-300">{item.className} · {item.entryPoint}</div>
                        </div>
                        <div className={`max-w-full rounded-full px-3 py-1 text-center text-xs uppercase tracking-[0.18em] sm:tracking-[0.24em] ${item.status === "late" ? "bg-amber-500/15 text-amber-200" : "bg-cyan/15 text-cyan"}`}>
                          {item.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : renderActivePage()}
          </main>
        </div>

        {renderMobileNavigation()}
      </div>
    </div>
  );
}

export default App;
