import { env } from "../../config/env.js";

export type OrbitPerson = {
  id: string; displayId?: string; fullName: string; email?: string | null; phone?: string | null;
  status?: string | null; className?: string | null; accessCode?: string | null;
  employeeType?: string | null; department?: string | null; jobTitle?: string | null;
  preferredLanguage?: "fr" | "en" | string | null; language?: "fr" | "en" | string | null;
  kind: "STUDENT" | "TEACHER" | "STAFF" | "PARENT";
};
type Directory = { students?: any[]; teachers?: any[]; staff?: any[]; parents?: any[] };
let cache: { at: number; people: OrbitPerson[] } | null = null;
export async function loadOrbitDirectory(force = false) {
  if (!force && cache && Date.now() - cache.at < env.directoryCacheSeconds * 1000) return cache.people;
  const url = new URL("/api/integration/read/shared-directory", env.orbitApiUrl);
  url.searchParams.set("organizationId", env.orbitOrganizationId);
  try {
    const response = await fetch(url, { headers: { "x-api-key": env.orbitApiKey, "x-app-slug": "KCS_SENTINEL" }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Orbit directory returned ${response.status}`);
    const body = await response.json() as Directory;
    const people: OrbitPerson[] = [
      ...(body.students ?? []).map(person => ({ ...person, kind: "STUDENT" as const })),
      ...(body.teachers ?? []).map(person => ({ ...person, kind: "TEACHER" as const })),
      ...(body.staff ?? []).map(person => ({ ...person, kind: "STAFF" as const })),
      ...(body.parents ?? []).map(person => ({ ...person, kind: "PARENT" as const }))
    ].filter(person => !person.status || person.status === "ACTIVE");
    cache = { at: Date.now(), people };
    return people;
  } catch (error) {
    if (cache && Date.now() - cache.at < 60 * 60_000) return cache.people;
    throw error;
  }
}
export async function resolveOrbitPerson(identifier: string) {
  const key = identifier.trim().toLowerCase();
  return (await loadOrbitDirectory()).find(person => [person.id, person.displayId, person.email, person.accessCode].some(value => value?.toLowerCase() === key)) ?? null;
}

export async function resolveOrbitPersonFromCandidates(values: Array<unknown>) {
  const keys = new Set(values.map(value => String(value ?? "").trim().toLowerCase()).filter(Boolean));
  if (!keys.size) return null;
  return (await loadOrbitDirectory()).find(person =>
    [person.id, person.displayId, person.email, person.accessCode]
      .some(value => value && keys.has(value.trim().toLowerCase()))
  ) ?? null;
}
