import crypto from 'node:crypto';
import { Resend } from 'resend';

// Siehe RSVP_CONTRACT.md im Repo-Root. Wer hier etwas an Token, JSON-Form oder
// Statuswerten ändert, muss das Apps Script im Sheet und die Framer-Seite
// mitziehen.

const TABLE_NAME = 'ArtWeek Guests';
const ANSWERS = ['Ja', 'Nein', 'Vielleicht'];

// Kein '*': hier kommen personenbezogene Zusagen rein. Framer-Vorschauen unter
// framer.app stehen bewusst NICHT drin — zum Testen die /rsvp-Seite auf
// mahalla.berlin veroeffentlichen. Ohne Token ist sie ohnehin wertlos.
const ALLOWED_ORIGINS = [
  'https://mahalla.berlin',
  'https://www.mahalla.berlin',
];

const resend = new Resend(process.env.RESEND_API_KEY);
const airtableToken = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;
const airtableBase = process.env.AIRTABLE_BASE_ID;
// Vertrag Kapitel 3.2: nur ein ausdrueckliches 'true' erlaubt die Begleitung.
// Fehlt die Variable oder ist sie vertippt, wird gedeckelt statt geoeffnet.
const allowPlusOne = process.env.RSVP_ALLOW_PLUS_ONE === 'true';

function log(level, event, data = {}) {
  console.log(JSON.stringify({ level, event, ...data, ts: new Date().toISOString() }));
}

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// --- Token ------------------------------------------------------------------

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 8);
}

// Gibt { gastId, vorname } zurück oder null. Die Signatur deckt den kompletten
// Payload ab, also lässt sich weder die ID noch der Name manipulieren.
function readToken(token, secret) {
  const raw = getText(token);
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = signPayload(payload, secret);

  // Längen vorher prüfen: timingSafeEqual wirft bei ungleichen Puffergrößen.
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const [gastId, ...rest] = decoded.split('|');

  // Die ID landet in einer Airtable-Formel, deshalb hart eingegrenzt.
  if (!/^[A-Za-z0-9]+-\d+$/.test(gastId)) return null;

  return { gastId, vorname: rest.join('|') };
}

// --- Airtable ---------------------------------------------------------------

function airtableUrl(query = '') {
  return `https://api.airtable.com/v0/${airtableBase}/${encodeURIComponent(TABLE_NAME)}${query}`;
}

const airtableHeaders = () => ({
  Authorization: `Bearer ${airtableToken}`,
  'Content-Type': 'application/json',
});

async function findRecord(gastId) {
  const formula = encodeURIComponent(`{Gast-ID} = "${gastId}"`);
  const response = await fetch(airtableUrl(`?filterByFormula=${formula}&maxRecords=1`), {
    headers: airtableHeaders(),
  });
  const data = await response.json();

  if (!response.ok) throw new Error(data?.error?.message || `Airtable ${response.status}`);
  return data.records?.[0] || null;
}

// Airtable paginiert bei 100 Datensätzen. Die Gästeliste ist kleiner, aber der
// Abholknopf soll auch dann noch alles holen, wenn sie wächst.
async function listRecords() {
  const records = [];
  let offset;

  do {
    const query = offset ? `?pageSize=100&offset=${encodeURIComponent(offset)}` : '?pageSize=100';
    const response = await fetch(airtableUrl(query), { headers: airtableHeaders() });
    const data = await response.json();

    if (!response.ok) throw new Error(data?.error?.message || `Airtable ${response.status}`);

    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

async function saveAnswer(existingId, fields) {
  const response = await fetch(existingId ? airtableUrl(`/${existingId}`) : airtableUrl(), {
    method: existingId ? 'PATCH' : 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  });
  const data = await response.json();

  if (!response.ok) throw new Error(data?.error?.message || `Airtable ${response.status}`);
  return data.id;
}

// --- Handler ----------------------------------------------------------------

export default async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const secret = process.env.RSVP_SECRET;
  if (!secret || !airtableToken || !airtableBase) {
    log('error', 'rsvp_config_missing', {
      hasSecret: Boolean(secret),
      hasAirtableToken: Boolean(airtableToken),
      hasBaseId: Boolean(airtableBase),
    });
    return res.status(500).json({ error: 'RSVP configuration is missing' });
  }

  if (req.method === 'GET') {
    if (req.query.all) return handleExport(req, res);
    return handleLookup(req, res, secret);
  }

  if (req.method === 'POST') return handleAnswer(req, res, secret);

  return res.status(405).json({ error: 'Method not allowed' });
}

// GET ?g=<token> — Name auflösen und eine bereits gegebene Antwort vorausfüllen.
async function handleLookup(req, res, secret) {
  const guest = readToken(req.query.g, secret);

  if (!guest) {
    log('warn', 'rsvp_invalid_token');
    return res.status(403).json({ error: 'invalid_token' });
  }

  let record = null;
  try {
    record = await findRecord(guest.gastId);
  } catch (error) {
    log('error', 'rsvp_lookup_failed', { error: error.message });
    return res.status(502).json({ error: 'Lookup failed' });
  }

  return res.status(200).json({
    ok: true,
    gastId: guest.gastId,
    vorname: guest.vorname,
    bereitsGeantwortet: Boolean(record),
    antwort: record?.fields?.Antwort || null,
    personen: record?.fields?.Personen || 1,
    begleitung: record?.fields?.Begleitung || '',
    allowPlusOne,
  });
}

// POST — Antwort speichern. Upsert über die Gast-ID, damit zweimaliges Absenden
// dieselbe Zeile aktualisiert.
async function handleAnswer(req, res, secret) {
  const body = req.body || {};
  const guest = readToken(body.g, secret);

  if (!guest) {
    log('warn', 'rsvp_invalid_token');
    return res.status(403).json({ error: 'invalid_token' });
  }

  const kommt = getText(body.kommt);
  if (!ANSWERS.includes(kommt)) {
    return res.status(400).json({ error: 'Validation failed', fields: { kommt: 'required' } });
  }

  // Plus 1 wird serverseitig entschieden. Ein ausgeblendetes Formularfeld hält
  // niemanden davon ab, trotzdem personen: 2 zu schicken.
  const wantsTwo = Number(body.personen) === 2;
  const personen = kommt === 'Ja' && allowPlusOne && wantsTwo ? 2 : 1;
  const begleitung = personen === 2 ? getText(body.begleitung) : '';
  const email = getText(body.email).toLowerCase();

  const fields = {
    'Gast-ID': guest.gastId,
    Name: guest.vorname,
    Antwort: kommt,
    Personen: personen,
    Begleitung: begleitung,
    Anmerkung: getText(body.anmerkung),
    'Antwort am': new Date().toISOString(),
    ...(isEmail(email) && { Email: email }),
  };

  try {
    const existing = await findRecord(guest.gastId);
    await saveAnswer(existing?.id, fields);
  } catch (error) {
    log('error', 'rsvp_save_failed', { gastId: guest.gastId, error: error.message });
    return res.status(502).json({ error: 'Could not save answer' });
  }

  log('info', 'rsvp_saved', { gastId: guest.gastId, kommt, personen });

  // Bestätigungsmail ist Beiwerk: schlägt sie fehl, ist die Zusage trotzdem
  // gespeichert und der Gast bekommt seinen Danke-Zustand.
  if (isEmail(email)) {
    await sendConfirmation(email, guest.vorname, kommt, personen);
  }

  return res.status(200).json({ ok: true });
}

async function sendConfirmation(email, vorname, kommt, personen) {
  const eventLabel = process.env.RSVP_EVENT_LABEL || 'unserer Art-Week-Veranstaltung';
  const anrede = vorname ? `Hallo ${vorname},` : 'Hallo,';

  const text = kommt === 'Ja'
    ? `${anrede}\n\nschön, dass du dabei bist — wir haben dich mit ${personen} ${personen === 1 ? 'Person' : 'Personen'} auf der Gästeliste bei ${eventLabel}.\n\nBis bald in der MaHalla\n`
    : kommt === 'Nein'
      ? `${anrede}\n\nschade, dass es nicht klappt. Wir melden uns beim nächsten Mal.\n\nMaHalla\n`
      : `${anrede}\n\nwir haben dich als „vielleicht" notiert. Du kannst deine Antwort über denselben Link jederzeit ändern.\n\nMaHalla\n`;

  try {
    const { error } = await resend.emails.send({
      from: 'MaHalla <form@mahalla.nickmichi.de>',
      to: email,
      subject: 'Deine Antwort ist da',
      text,
    });
    if (error) log('error', 'rsvp_mail_failed', { error: error.message });
  } catch (error) {
    log('error', 'rsvp_mail_failed', { error: error.message });
  }
}

// GET ?all=1&token=<admin> — alle Antworten für den Abholknopf im Sheet.
async function handleExport(req, res) {
  const adminToken = process.env.RSVP_ADMIN_TOKEN;
  const given = getText(req.query.token);

  if (!adminToken || given.length !== adminToken.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(adminToken))) {
    log('warn', 'rsvp_export_denied');
    return res.status(403).json({ error: 'invalid_token' });
  }

  let records;
  try {
    records = await listRecords();
  } catch (error) {
    log('error', 'rsvp_export_failed', { error: error.message });
    return res.status(502).json({ error: 'Export failed' });
  }

  const antworten = records.map(record => ({
    gastId: record.fields['Gast-ID'] || '',
    name: record.fields.Name || '',
    antwort: record.fields.Antwort || '',
    personen: record.fields.Personen || 1,
    begleitung: record.fields.Begleitung || '',
    email: record.fields.Email || '',
    anmerkung: record.fields.Anmerkung || '',
    antwortAm: record.fields['Antwort am'] || '',
  })).filter(row => row.gastId);

  log('info', 'rsvp_export', { count: antworten.length });
  return res.status(200).json({ ok: true, antworten });
}
