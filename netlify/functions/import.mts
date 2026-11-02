import { randomUUID } from 'node:crypto';
import { json, requireAuth, sameOrigin } from '../shared/auth.mts';
import imageMappings from '../../config/image-mapping.json';

type Activity = { date: string; start: string; end: string; title: string; description?: string };
type Existing = { uid?: string; deleted?: boolean; dtStart?: { date?: string; time?: string }; dtEnd?: { date?: string; time?: string }; summary?: string; rrule?: { freq?: string; interval?: number | null; byDay?: string[]; until?: string | null; count?: number | null }; exDate?: unknown[] };
type Classification = { activity: Activity; status: 'new' | 'existing' | 'conflict'; reason?: string };
const normTime = (s: string | undefined) => (s || '').slice(0, 5);
const normTitle = (s: string | undefined) => (s || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nb-NO');
const day = (s: string) => new Date(`${s}T12:00:00Z`);
const dayDiff = (a: string, b: string) => Math.round((day(a).getTime() - day(b).getTime()) / 86400000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
function validDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(day(s).valueOf()) && iso(day(s)) === s; }
function validTime(s: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function parse(input: unknown): Activity[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as any).activities)) throw Error('JSON må inneholde activities som en liste.');
  const raw = (input as any).activities;
  if (!raw.length || raw.length > 40) throw Error('Ukeplanen må inneholde 1–40 aktiviteter.');
  const seen = new Set<string>();
  return raw.map((a: any, i: number) => {
    if (!a || typeof a !== 'object' || !validDate(a.date) || !validTime(a.start) || !validTime(a.end) ||
      typeof a.title !== 'string' || !a.title.trim() || a.title.length > 160 ||
      (a.description !== undefined && (typeof a.description !== 'string' || a.description.length > 2000)))
      throw Error(`Ugyldig aktivitet nr. ${i + 1}. Sjekk dato, tid og tittel.`);
    if (a.end <= a.start) throw Error(`Sluttid må være etter starttid: ${a.title}.`);
    const key = `${a.date}|${a.start}|${a.end}|${normTitle(a.title)}`;
    if (seen.has(key)) throw Error(`Duplikat i JSON: ${a.title} (${a.date}).`);
    seen.add(key);
    return { date: a.date, start: a.start, end: a.end, title: a.title.trim(), description: (a.description || '').trim() };
  });
}
function config() {
  const entityRaw = process.env.MYABILIA_ENTITY_ID || '';
  const calendar = process.env.MYABILIA_CALENDAR_ID || '';
  const token = process.env.MYABILIA_AUTH_TOKEN || '';
  const cookieName = process.env.MYABILIA_COOKIE_NAME || 'X-Auth-Token';
  if (!/^\d+$/.test(entityRaw) || !/^[0-9a-f-]{36}$/i.test(calendar) || !token || !/^[A-Za-z0-9_-]+$/.test(cookieName))
    throw Error('myAbilia-miljøvariabler mangler eller er ugyldige.');
  return { entity: Number(entityRaw), base: `https://www.myabilia.com/api/v1/entities/${entityRaw}/calendars/${calendar}/events`, cookie: `${cookieName}=${token}` };
}
// Oslo local midnight converted to epoch milliseconds. Noon-offset sampling handles DST transitions.
function osloMidnight(date: string): number {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', timeZoneName: 'shortOffset' }).formatToParts(noon);
  const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+1';
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tz);
  if (!m) throw Error('Kunne ikke beregne norsk tidssone.');
  const offset = (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  return Date.parse(`${date}T00:00:00Z`) - offset * 60000;
}
async function fetchExisting(activities: Activity[], cfg: ReturnType<typeof config>): Promise<Existing[]> {
  const dates = activities.map(a => a.date).sort();
  const first = new Date(`${dates[0]}T12:00:00Z`); first.setUTCDate(first.getUTCDate() - 1);
  const last = new Date(`${dates[dates.length - 1]}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 2);
  // Bound range to prevent unintended large requests.
  if (dayDiff(iso(last), iso(first)) > 45) throw Error('Aktivitetene må ligge innenfor en periode på maks 42 dager.');
  const url = new URL(cfg.base);
  url.searchParams.set('fromDate', String(osloMidnight(iso(first))));
  url.searchParams.set('toDate', String(osloMidnight(iso(last))));
  const response = await fetch(url, { headers: { Accept: 'application/json', Cookie: cfg.cookie }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw Error(`Kunne ikke hente aktiviteter fra myAbilia (HTTP ${response.status}). Import er stoppet.`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw Error('Uventet svar fra myAbilia. Import er stoppet.');
  return data as Existing[];
}
const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
function occursOn(e: Existing, date: string): boolean {
  const start = e.dtStart?.date;
  if (!start || !validDate(start) || date < start) return false;
  if (!e.rrule) return date === start;
  const r = e.rrule;
  if (r.until && /^\d{4}-\d{2}-\d{2}/.test(r.until) && date > r.until.slice(0, 10)) return false;
  const diff = dayDiff(date, start);
  const interval = r.interval || 1;
  if (!Number.isInteger(interval) || interval < 1) return true; // conservative
  if (r.freq === 'DAILY') {
    if (r.count && Math.floor(diff / interval) >= r.count) return false;
    return diff % interval === 0;
  }
  if (r.freq === 'WEEKLY') {
    if (Math.floor(diff / 7) % interval !== 0) return false;
    const days = r.byDay?.length ? r.byDay : [weekdays[day(start).getUTCDay()]];
    if (!days.includes(weekdays[day(date).getUTCDay()])) return false;
    // count with multiple weekdays is tricky; favor a possible conflict over false 'new'.
    return true;
  }
  return true; // unknown recurrence: treat conservatively
}
function exceptionOn(e: Existing, date: string): boolean {
  return (e.exDate || []).some(x => {
    if (typeof x === 'string') return x.slice(0, 10) === date;
    if (x && typeof x === 'object') {
      const v = x as { date?: string; dtStart?: { date?: string } };
      return v.date === date || v.dtStart?.date === date;
    }
    return false;
  });
}
function classify(activities: Activity[], existing: Existing[]): Classification[] {
  return activities.map(activity => {
    const matches = existing.filter(e => !e.deleted && occursOn(e, activity.date) && !exceptionOn(e, activity.date));
    const same = matches.find(e => normTitle(e.summary) === normTitle(activity.title) && normTime(e.dtStart?.time) === activity.start && normTime(e.dtEnd?.time) === activity.end);
    if (same) return { activity, status: 'existing', reason: 'Samme tittel, dato og klokkeslett finnes allerede.' };
    // Half-open intervals: 17:00–18:00 and 18:00–18:30 do not overlap.
    // A repeated title at a different, non-overlapping time is a new activity.
    const possible = matches.find(e => {
      const start = normTime(e.dtStart?.time);
      const end = normTime(e.dtEnd?.time);
      // Missing or invalid times should not silently bypass conflict detection.
      if (!validTime(start) || !validTime(end) || end <= start) return true;
      return activity.start < end && start < activity.end;
    });
    if (possible) return { activity, status: 'conflict', reason: `Tidspunktet overlapper med «${possible.summary || 'aktivitet'}». Kontroller manuelt.` };
    return { activity, status: 'new' };
  });
}
// Map activity titles to image URIs already stored by myAbilia. Never send a Netlify image URL to the API.
function imageFor(title: string) {
  const mapping = (imageMappings as Record<string, { uri?: string }>)[normTitle(title)];
  const uri = mapping?.uri?.trim();
  if (!uri) return null;
  const url = new URL(uri);
  if (url.protocol !== 'https:' || !['myabilia.com', 'www.myabilia.com'].includes(url.hostname) ||
      !/^\/api\/v1\/data\/\d+\/storage\/file\/id\/[0-9a-f-]{36}$/i.test(url.pathname))
    throw Error(`Ugyldig myAbilia-bilde-URI for ${title}`);
  return { uri, fmtType: 'image/*', value: 'URI', altRep: null };
}
function alignmentFor(a: Activity, all: Activity[]) {