import { randomUUID } from 'node:crypto';
import { json, requireAuth, sameOrigin } from '../shared/auth.mts';

type Activity = { date: string; start: string; end: string; title: string; description?: string };
function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}
function validTime(s: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function parse(input: unknown): Activity[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as any).activities)) throw Error('JSON må inneholde activities som en liste.');
  const raw = (input as any).activities;
  if (raw.length === 0 || raw.length > 40) throw Error('Ukeplanen må inneholde 1–40 aktiviteter.');
  const seen = new Set<string>();
  return raw.map((a: any, i: number) => {
    if (!a || typeof a !== 'object' || !validDate(a.date) || !validTime(a.start) || !validTime(a.end) ||
        typeof a.title !== 'string' || !a.title.trim() || a.title.length > 160 ||
        (a.description !== undefined && (typeof a.description !== 'string' || a.description.length > 2000)))
      throw Error(`Ugyldig aktivitet på linje ${i + 1}. Sjekk dato, tid og tittel.`);
    if (a.end <= a.start) throw Error(`Sluttid må være etter starttid: ${a.title}.`);
    const key = `${a.date}|${a.start}|${a.end}|${a.title.trim().toLowerCase()}`;
    if (seen.has(key)) throw Error(`Duplikat i innlimt JSON: ${a.title} (${a.date}).`);
    seen.add(key);
    return { date: a.date, start: a.start, end: a.end, title: a.title.trim(), description: (a.description || '').trim() };
  });
}
const alarms = [
  { action: 'DISPLAY', trigger: 'PT0M' }, { action: 'AUDIO', trigger: 'PT0M' },
  { action: 'X-VIBRATE', trigger: 'PT0M' }, { action: 'DISPLAY', trigger: 'RELATED=END:PT0M' },
  { action: 'AUDIO', trigger: 'RELATED=END:PT0M' }, { action: 'X-VIBRATE', trigger: 'RELATED=END:PT0M' }
];
function payload(a: Activity, entity: number, uid: string) {
  return {
    alarms, alignment: 'RIGHT', attachments: [], attendees: [], categories: [], classType: 'PUBLIC',
    deleted: false, description: a.description || '',
    dtEnd: { date: a.date, time: `${a.end}:00`, timeZone: 'Europe/Oslo' },
    dtStamp: new Date().toISOString(),
    dtStart: { date: a.date, time: `${a.start}:00`, timeZone: 'Europe/Oslo' },
    exDate: [], owner: entity, removeAfter: false, revision: 0, secretExemptions: [],
    seriesId: uid, showInDayPlan: true, summary: a.title, textToSpeech: false, uid
  };
}
export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Kun POST er støttet.' }, 405);
  const unauthorized = requireAuth(req); if (unauthorized) return unauthorized;
  if (!sameOrigin(req)) return json({ error: 'Ugyldig origin.' }, 403);
  const size = Number(req.headers.get('content-length') || 0);
  if (size > 100_000) return json({ error: 'JSON er for stor.' }, 413);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Ugyldig JSON.' }, 400); }
  let activities: Activity[];
  try { activities = parse(body); } catch (err) { return json({ error: (err as Error).message }, 400); }
  if (body.confirm !== true) return json({ dryRun: true, activities });
  const entityRaw = process.env.MYABILIA_ENTITY_ID || '';
  const calendar = process.env.MYABILIA_CALENDAR_ID || '';
  const token = process.env.MYABILIA_AUTH_TOKEN || '';
  const cookieName = process.env.MYABILIA_COOKIE_NAME || 'X-Auth-Token';
  if (!/^\d+$/.test(entityRaw) || !/^[0-9a-f-]{36}$/i.test(calendar) || !token || !/^[A-Za-z0-9_-]+$/.test(cookieName))
    return json({ error: 'myAbilia-miljøvariabler mangler eller er ugyldige.' }, 503);
  const entity = Number(entityRaw);
  const results: Array<{ title: string; date: string; status: string; detail?: string }> = [];
  for (const a of activities) {
    const uid = randomUUID();
    const url = `https://www.myabilia.com/api/v1/entities/${entity}/calendars/${calendar}/events/${uid}`;
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Cookie': `${cookieName}=${token}` },
        body: JSON.stringify(payload(a, entity, uid)),
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) {
        results.push({ title: a.title, date: a.date, status: 'error', detail: `HTTP ${response.status}` });
        // Stop on auth errors or unexpected API failures to avoid further changes.
        break;
      }
      results.push({ title: a.title, date: a.date, status: 'created' });
    } catch {
      results.push({ title: a.title, date: a.date, status: 'unknown', detail: 'Nettverksfeil eller timeout. Kontroller kalenderen før ny import.' });
      break;
    }
  }
  return json({ results, attempted: results.length, total: activities.length, warning: 'Ingen kontroll mot allerede eksisterende kalenderaktiviteter. Ikke importer samme ukeplan på nytt uten å sjekke kalenderen.' });
};
