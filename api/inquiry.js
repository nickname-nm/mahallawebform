import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const airtableToken = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;

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
  const isInquiry = req.body?.formType === 'location';
  log('info', 'request_received', { type: isInquiry ? 'inquiry' : 'contact', fields: Object.keys(fields) });

  // --- Contact: email only, no Airtable ---
  if (!isInquiry) {
    const emailBody = `${fields['Contact Firstname'] || ''}\n${fields['contact mail'] || ''}\n\n${fields['Description'] || ''}`;
    const subject = `contact form: ${fields['Contact Firstname'] || ''}`.trim();
    log('info', 'email_attempt', { to: 'info@mahalla.berlin', subject, replyTo: fields['contact mail'] || null });
    try {
      const { data: emailData, error } = await resend.emails.send({
        from: 'MaHalla Form <form@mahalla.nickmichi.de>',
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
  let airtableRes, data;
  try {
    airtableRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${airtableToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    data = await airtableRes.json();
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
    const emailBody = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
    const subject = `re: ${fields['Project Title']}`;
    log('info', 'email_attempt', { to: 'location@mahalla.berlin', subject, replyTo: fields['contact mail'] || null });
    try {
      const { data: emailData, error } = await resend.emails.send({
        from: 'MaHalla Form <form@mahalla.nickmichi.de>',
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
