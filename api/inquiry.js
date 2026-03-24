import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

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

  const isContact = !req.body?.fields?.["Project Title"]
  if (airtableRes.ok && isContact) {
    const f = req.body.fields
    await resend.emails.send({
      from: 'MaHalla Form <form@mahalla.berlin>',
      to: 'info@mahalla.berlin',
      subject: `New Contact: ${f["Contact Firstname"] || ""} ${f["contact mail"] || ""}`.trim(),
      text: `Name: ${f["Contact Firstname"] || ""}\nEmail: ${f["contact mail"] || ""}\n\n${f["Description"] || ""}`,
    })
  }

  return res.status(airtableRes.status).json(data);
}
