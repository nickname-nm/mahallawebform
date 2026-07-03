function log(level, event, data = {}) {
  console.log(JSON.stringify({ level, event, ...data, ts: new Date().toISOString() }));
}

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
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

  if (!process.env.BREVO_API_KEY) {
    log('error', 'brevo_config_missing');
    return res.status(500).json({ error: 'Newsletter configuration is missing' });
  }

  const email = getText(req.body?.email || req.body?.fields?.email || req.body?.fields?.Email).toLowerCase();
  const name = getText(req.body?.name || req.body?.fields?.name || req.body?.fields?.Name);

  if (!email) {
    log('warn', 'email_missing');
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    log('warn', 'email_invalid');
    return res.status(400).json({ error: 'Email is invalid' });
  }

  const listId = Number(process.env.BREVO_LIST_ID);
  const payload = {
    email,
    ...(name && { attributes: { FIRSTNAME: name } }),
    ...(Number.isInteger(listId) && listId > 0 && { listIds: [listId] }),
    updateEnabled: true,
  };

  let brevoRes;
  let data;
  try {
    brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    data = await readJsonResponse(brevoRes);
  } catch (err) {
    log('error', 'brevo_request_failed', { error: err.message });
    return res.status(502).json({ error: 'Newsletter service is unavailable' });
  }

  log(brevoRes.ok ? 'info' : 'error', 'brevo_response', {
    status: brevoRes.status,
    ok: brevoRes.ok,
    code: data?.code || null,
    message: data?.message || null,
  });

  if (!brevoRes.ok) {
    return res.status(brevoRes.status).json({
      error: data?.message || 'Newsletter signup failed',
      code: data?.code,
    });
  }

  return res.status(200).json({ ok: true });
}
