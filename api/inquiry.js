import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const airtableToken = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;

// Welche Tracking-Werte das Formular schicken darf und wie sie in Airtable
// heissen. Bewusst eine feste Liste: der Client kann damit keine beliebigen
// Airtable-Felder beschreiben.
const TRACKING_FIELDS = {
  utm_source: 'UTM Source',
  utm_medium: 'UTM Medium',
  utm_campaign: 'UTM Campaign',
  utm_content: 'UTM Content',
  utm_term: 'UTM Term',
  referrer: 'Referrer',
  landing_page: 'Landing Page',
};

// Nur diese beiden Werte bekommen eine eigene Spalte in Airtable. Alle anderen
// Tracking-Werte stehen weiterhin in der Mail, aber nicht in der Tabelle.
const AIRTABLE_TRACKING_COLUMNS = ['UTM Source', 'UTM Campaign'];

function log(level, event, data = {}) {
  console.log(JSON.stringify({ level, event, ...data, ts: new Date().toISOString() }));
}

// Baut die Tracking-Felder aus dem Request. Der Referrer kommt notfalls aus
// dem Header, falls die Komponente ihn nicht mitschickt.
function buildTracking(req) {
  const sent = req.body?.tracking || {};
  const out = {};

  for (const [key, airtableName] of Object.entries(TRACKING_FIELDS)) {
    const value = sent[key];
    if (typeof value === 'string' && value.trim()) {
      out[airtableName] = value.trim().slice(0, 500);
    }
  }

  if (!out['Referrer'] && req.headers?.referer) {
    out['Referrer'] = String(req.headers.referer).slice(0, 500);
  }

  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    log('warn', 'method_not_allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const fields = req.body?.fields || {};
  const tracking = buildTracking(req);
  const isInquiry = req.body?.formType === 'location';
  log('info', 'request_received', {
    type: isInquiry ? 'inquiry' : 'contact',
    fields: Object.keys(fields),
    tracking: Object.keys(tracking),
  });

  // --- Contact: email only, no Airtable ---
  if (!isInquiry) {
    const trackingBlock = Object.entries(tracking).map(([k, v]) => `${k}: ${v}`).join('\n');
    const emailBody = [
      `${fields['Contact Firstname'] || ''}\n${fields['contact mail'] || ''}\n\n${fields['Description'] || ''}`,
      trackingBlock && `\n---\n${trackingBlock}`,
    ].filter(Boolean).join('\n');
    const subject = `contact form: ${fields['Contact Firstname'] || ''}`.trim();
    log('info', 'email_attempt', { to: 'info@mahalla.berlin', subject, replyTo: fields['contact mail'] || null });
    try {
      const { data: emailData, error } = await resend.emails.send({
        from: 'MaHalla Form <forms@mahalla.berlin>',
        to: 'info@mahalla.berlin',
        replyTo: fields['contact mail'] || undefined,
        subject,
        text: emailBody,
      });
      if (error) {
        log('error', 'email_failed', { error: error.message, name: error.name });
      } else {
        log('info', 'email_sent', { id: emailData?.id });
      }
    } catch (err) {
      log('error', 'email_failed', { error: err.message });
    }
    return res.status(200).json({ ok: true });
  }

  // --- Inquiry: Airtable + email ---
  const missingConfig = [
    !process.env.AIRTABLE_BASE_ID && 'AIRTABLE_BASE_ID',
    !airtableToken && 'AIRTABLE_PAT or AIRTABLE_API_KEY',
  ].filter(Boolean);

  if (missingConfig.length) {
    log('error', 'airtable_config_missing', { missing: missingConfig });
    return res.status(500).json({ error: 'Airtable configuration is missing' });
  }

  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/inquiries`;

  // Ein Schreibversuch gegen Airtable. Wird zweimal aufgerufen: einmal mit
  // Tracking-Feldern, und falls die in Airtable noch nicht existieren, einmal
  // ohne. So kann der Endpoint deployed werden, bevor die Felder angelegt sind.
  async function writeToAirtable(payloadFields) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${airtableToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: payloadFields }),
    });
    const body = await response.json();
    return { response, body };
  }

  let airtableRes, data;
  try {
    const airtableTracking = {};
    for (const column of AIRTABLE_TRACKING_COLUMNS) {
      if (tracking[column]) airtableTracking[column] = tracking[column];
    }

    ({ response: airtableRes, body: data } = await writeToAirtable({ ...fields, ...airtableTracking }));

    // Airtable lehnt unbekannte Feldnamen komplett ab. Wenn die Tracking-Spalten
    // fehlen, lieber die Anfrage ohne Tracking speichern als sie zu verlieren.
    const unknownField = data?.error?.type === 'UNKNOWN_FIELD_NAME';
    if (!airtableRes.ok && unknownField && Object.keys(airtableTracking).length) {
      log('warn', 'airtable_tracking_fields_missing', {
        message: data?.error?.message,
        retryingWithout: Object.keys(airtableTracking),
      });
      ({ response: airtableRes, body: data } = await writeToAirtable(fields));
    }

    log(airtableRes.ok ? 'info' : 'error', 'airtable_response', {
      status: airtableRes.status,
      ok: airtableRes.ok,
      errorType: data?.error?.type,
      errorMessage: data?.error?.message,
    });
  } catch (err) {
    log('error', 'airtable_fetch_failed', { error: err.message });
    return res.status(500).json({ error: 'Airtable request failed' });
  }

  if (airtableRes.ok) {
    // Tracking steht auch in der Mail, damit die Herkunft sofort sichtbar ist -
    // unabhaengig davon, ob die Airtable-Spalten schon existieren.
    const emailBody = Object.entries({ ...fields, ...tracking })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const subject = `re: ${fields['Project Title']}`;
    log('info', 'email_attempt', { to: 'location@mahalla.berlin', subject, replyTo: fields['contact mail'] || null });
    try {
      const { data: emailData, error } = await resend.emails.send({
        from: 'MaHalla Form <forms@mahalla.berlin>',
        to: 'location@mahalla.berlin',
        replyTo: fields['contact mail'] || undefined,
        subject,
        text: emailBody,
      });
      if (error) {
        log('error', 'email_failed', { error: error.message, name: error.name });
      } else {
        log('info', 'email_sent', { id: emailData?.id });
      }
    } catch (err) {
      log('error', 'email_failed', { error: err.message });
    }
  }

  return res.status(airtableRes.status).json(data);
}
