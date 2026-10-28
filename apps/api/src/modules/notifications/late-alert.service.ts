import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { attendancePolicyFor, kinshasaClockParts, kinshasaDateKey, SCHOOL_TIMEZONE } from "../attendance/attendance-policy.js";
import type { OrbitPerson } from "../integration/directory.js";

type LateAlertRow = {
  id: string;
  event_key: string;
  person_id: string;
  title_fr: string;
  title_en: string;
  message_fr: string;
  message_en: string;
  incident_date: string;
  occurred_at: string;
  delivery_status: string;
  email_status: string;
  sms_status: string;
  created_at: string;
};

export async function createLateAlert(client: PoolClient, person: OrbitPerson, occurredAt: Date) {
  const policy = attendancePolicyFor(person);
  if (policy.lateAfterMinutes === null || !policy.arrivalDeadline) return null;
  const date = kinshasaDateKey(occurredAt);
  const parts = kinshasaClockParts(occurredAt);
  const calendar = await client.query<{ is_school_day: boolean }>(
    "SELECT is_school_day FROM school_calendar_days WHERE calendar_date=$1::date LIMIT 1",
    [date],
  );
  const defaultSchoolDay = !["Sat", "Sun"].includes(String(parts.weekday));
  if (!(calendar.rows[0]?.is_school_day ?? defaultSchoolDay)) return null;
  const clock = `${parts.hour}:${parts.minute}`;
  const eventKey = `LATE:${person.id}:${date}`;
  const titleFr = "Retard enregistré par KCS Sentinel";
  const titleEn = "Late arrival recorded by KCS Sentinel";
  const messageFr = `${person.fullName}, votre arrivée du ${date} à ${clock} a été enregistrée après l'heure limite de ${policy.arrivalDeadline}. Vous pouvez transmettre une justification depuis votre tableau de bord Sentinel.`;
  const messageEn = `${person.fullName}, your arrival on ${date} at ${clock} was recorded after the ${policy.arrivalDeadline} deadline. You can submit an explanation from your Sentinel dashboard.`;
  const result = await client.query<LateAlertRow>(
    `INSERT INTO sentinel_alerts(
       id,event_key,person_id,alert_type,title_fr,title_en,message_fr,message_en,incident_date,occurred_at
     ) VALUES($1,$2,$3,'LATE',$4,$5,$6,$7,$8,$9)
     ON CONFLICT(event_key) DO NOTHING
     RETURNING *`,
    [crypto.randomUUID(), eventKey, person.id, titleFr, titleEn, messageFr, messageEn, date, occurredAt],
  );
  return result.rows[0] ? { ...result.rows[0], person } : null;
}

export async function deliverLateAlert(alert: LateAlertRow & { person: OrbitPerson }) {
  try {
    const language = String(alert.person.preferredLanguage || alert.person.language || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
    const response = await fetch(new URL("/api/sentinel-notifications/deliver", env.nexusApiUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.orbitApiKey },
      body: JSON.stringify({
        eventId: alert.id,
        orbitPersonId: alert.person.id,
        email: alert.person.email || undefined,
        phone: alert.person.phone || undefined,
        title: language === "en" ? alert.title_en : alert.title_fr,
        text: language === "en" ? alert.message_en : alert.message_fr,
        language,
        channels: ["IN_APP", "EMAIL", "SMS"],
        source: "KCS_SENTINEL",
        timezone: SCHOOL_TIMEZONE,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(payload?.message || `Nexus notification bridge returned ${response.status}`);
    await pool.query(
      `UPDATE sentinel_alerts SET delivery_status='DELIVERED', email_status=$2, sms_status=$3,
       delivery_detail=$4, delivered_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [alert.id, payload?.data?.email || "SKIPPED", payload?.data?.sms || "SKIPPED", JSON.stringify(payload?.data || {})],
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error";
    await pool.query(
      `UPDATE sentinel_alerts SET delivery_status='RETRY_REQUIRED', delivery_detail=$2,
       delivery_attempts=delivery_attempts+1, updated_at=NOW() WHERE id=$1`,
      [alert.id, detail],
    );
    console.error("[sentinel] Late-arrival alert queued for retry", { alertId: alert.id, detail });
  }
}

export async function listAlerts(personId: string) {
  const result = await pool.query<LateAlertRow>(
    `SELECT id,event_key,person_id,title_fr,title_en,message_fr,message_en,incident_date,
      occurred_at,delivery_status,email_status,sms_status,created_at
     FROM sentinel_alerts WHERE person_id=$1 ORDER BY occurred_at DESC LIMIT 250`,
    [personId],
  );
  return result.rows;
}
