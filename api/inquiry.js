import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/inquiries`;

  const airtableRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req.body),
  });

  const data = await airtableRes.json();

  if (airtableRes.ok) {
    const fields = req.body?.fields || {};
    const isInquiry = !!fields['Project Title'];

    try {
      if (isInquiry) {
        const body = Object.entries(fields)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        await resend.emails.send({
          from: 'MaHalla Form <form@mahalla.berlin>',
          to: 'location@mahalla.berlin',
          replyTo: fields['contact mail'] || undefined,
          subject: `re: ${fields['Project Title']}`,
          text: body,
        });
      } else {
        const body = Object.entries(fields)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        await resend.emails.send({
          from: 'MaHalla Form <form@mahalla.berlin>',
          to: 'info@mahalla.berlin',
          replyTo: fields['contact mail'] || undefined,
          subject: 'contact webform',
          text: body,
        });
      }
    } catch (err) {
      console.error('Email send failed:', err);
    }
  }

  return res.status(airtableRes.status).json(data);
}
