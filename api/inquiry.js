import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function log(level, event, data = {}) {
  console.log(JSON.stringify({ level, event, ...data, ts: new Date().toISOString() }));
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
  const isInquiry = !!fields['Project Title'];
  log('info', 'request_received', { type: isInquiry ? 'inquiry' : 'contact', fields: Object.keys(fields) });

  // --- Airtable ---
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/inquiries`;
  let airtableRes, data;
  try {
    airtableRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    data = await airtableRes.json();
    log(airtableRes.ok ? 'info' : 'error', 'airtable_response', { status: airtableRes.status, ok: airtableRes.ok });
  } catch (err) {
    log('error', 'airtable_fetch_failed', { error: err.message });
    return res.status(500).json({ error: 'Airtable request failed' });
  }

  // --- Email ---
  if (airtableRes.ok) {
    const emailBody = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
    const emailConfig = isInquiry
      ? { to: 'location@mahalla.berlin', subject: `re: ${fields['Project Title']}` }
      : { to: 'info@mahalla.berlin', subject: 'contact webform' };

    log('info', 'email_attempt', { to: emailConfig.to, subject: emailConfig.subject, replyTo: fields['contact mail'] || null });

    try {
      const { data, error } = await resend.emails.send({
        from: 'MaHalla Form <form@mahalla.nickmichi.de>',
        to: emailConfig.to,
        replyTo: fields['contact mail'] || undefined,
        subject: emailConfig.subject,
        text: emailBody,
      });
      if (error) {
        log('error', 'email_failed', { error: error.message, name: error.name });
      } else {
        log('info', 'email_sent', { id: data?.id });
      }
    } catch (err) {
      log('error', 'email_failed', { error: err.message, code: err.statusCode });
    }
  }

  return res.status(airtableRes.status).json(data);
}
