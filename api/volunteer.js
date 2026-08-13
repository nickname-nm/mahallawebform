const TABLE_NAME = 'Volunteers';

const TEAM_OPTIONS = [
  'Event Production',
  'Artist Management & Hospitality',
  'Guest management',
  'Gastronomy',
  'Bar Team',
  // MaHalla year-round form label. Created in Airtable on first use (typecast).
  'Decoration, Maintenance & Build Crew',
  // Legacy Sanctum of Sound festival label - keep so the festival form keeps working.
  'Decoration & Build Crew',
  'Entrance & Ticketing',
  'Sustainability & Clean-Up',
  'Open to Anything',
];

// Festival-only. The year-round MaHalla form sends `availability` instead.
const FESTIVAL_DAY_OPTIONS = [
  'Friday',
  'Saturday',
  'Sunday',
  'Entire Festival',
  'Build-up days (June 28 - July 3rd)',
];

// Keep in sync with the MaHalla volunteer form. Unknown values are still
// accepted (see getAvailability) so a wording change never silently drops data.
const AVAILABILITY_OPTIONS = [
  'Once or twice per week',
  'On weekends',
  'Only during the events',
  "I'm very flexible with my time",
  'I have a lot of free time',
];

const LANGUAGE_OPTIONS = ['English', 'German', 'Other'];

function log(level, event, data = {}) {
  console.log(JSON.stringify({ level, event, ...data, ts: new Date().toISOString() }));
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanList(value, allowed) {
  if (!Array.isArray(value)) return [];
  return value.map(item => clean(item)).filter(item => allowed.includes(item));
}

function parsePayload(body) {
  return body?.fields ? body.fields : body || {};
}

function getText(payload, key, fallbackKey) {
  return clean(payload[key]) || clean(payload[fallbackKey]);
}

function getList(payload, key, fallbackKey, allowed) {
  return cleanList(payload[key], allowed).length
    ? cleanList(payload[key], allowed)
    : cleanList(payload[fallbackKey], allowed);
}

// Availability is free-form on purpose: it lands in the Other Answers text
// field, so an unrecognised value is worth keeping rather than discarding.
function getAvailability(payload) {
  const raw = payload.Availability ?? payload.availability;
  const values = (Array.isArray(raw) ? raw : [raw]).map(clean).filter(Boolean);

  if (values.length > 0) {
    const known = values.filter(value => AVAILABILITY_OPTIONS.includes(value));
    return (known.length ? known : values).join(', ');
  }

  // Older form builds fold availability into a pre-composed Other Answers
  // block instead of sending it as its own key. Read it back out so those
  // submissions still validate.
  const composed = clean(payload['Other Answers']);
  const match = composed.match(/^Availability:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function formatOtherAnswers(payload, availability) {
  const directOtherAnswers = clean(payload['Other Answers']);
  if (directOtherAnswers) return directOtherAnswers;

  const shifts = cleanList(payload.shifts || payload.shiftPreference, [
    'Morning (06:00-12:00)',
    'Afternoon (12:00-18:00)',
    'Evening (18:00-00:00)',
    'Night (00:00-06:00)',
  ]);
  const skills = cleanList(payload.skills || payload.specialSkills, [
    'Photography/Videography',
    'Sound Engineering',
    'Lighting',
    'Awareness/First Aid',
    'Construction Set Building / Decoration',
    'Set Building / Decoration',
    'Hospitality',
    'Bartending / Runner',
    'Cooking',
    'Other',
  ]);

  return [
    ['Availability', availability],
    ['Shift Preference', shifts.join(', ')],
    ['Special Skills', skills.join(', ')],
    ['Other Skill', clean(payload.otherSkill)],
    ['Other Language', clean(payload.otherLanguage)],
    ['Can help during setup', clean(payload.setup) || clean(payload.canHelpSetup)],
    ['Can help during teardown', clean(payload.teardown) || clean(payload.canHelpTeardown)],
    ['Anything else', clean(payload.anythingElse)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

function buildFields(body) {
  const payload = parsePayload(body);
  const preferredTeam = getList(payload, 'Preferred Team', 'preferredTeam', TEAM_OPTIONS);
  const festivalDays = getList(payload, 'Festival Days', 'festivalDays', FESTIVAL_DAY_OPTIONS);
  const languages = getList(payload, 'Languages', 'languages', LANGUAGE_OPTIONS);
  const availability = getAvailability(payload);

  const fields = {
    Firstname: getText(payload, 'Firstname', 'firstName'),
    Lastname: getText(payload, 'Lastname', 'lastName'),
    Email: getText(payload, 'Email', 'email').toLowerCase(),
    Phone: getText(payload, 'Phone', 'phone'),
    'Age 18+': getText(payload, 'Age 18+', 'ageConfirmed'),
    Status: clean(payload.Status) || 'Application',
    'Preferred Team': preferredTeam,
    'Festival Days': festivalDays,
    Languages: languages,
    Motivation: getText(payload, 'Motivation', 'motivation'),
    'Other Answers': formatOtherAnswers(payload, availability),
  };

  return { fields, payload, availability };
}

// `sent` counts what the client actually submitted, so a value that was
// dropped for being unknown reports as such instead of "nothing selected".
function sentCount(payload, key, fallbackKey) {
  const raw = payload[key] ?? payload[fallbackKey];
  return Array.isArray(raw) ? raw.map(clean).filter(Boolean).length : 0;
}

function validate(fields, payload, availability) {
  const errors = {};

  if (!fields.Firstname) errors.firstName = 'First name is required';
  if (!fields.Lastname) errors.lastName = 'Last name is required';
  if (!fields.Email) errors.email = 'Email is required';
  if (fields.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.Email)) errors.email = 'Email is invalid';
  if (!fields.Phone) errors.phone = 'Phone is required';
  if (fields['Age 18+'] !== 'Yes') errors.ageConfirmed = 'Volunteers must confirm they are 18+';
  if (!fields.Motivation) errors.motivation = 'Motivation is required';

  if (fields['Preferred Team'].length === 0) {
    errors.preferredTeam = sentCount(payload, 'Preferred Team', 'preferredTeam')
      ? 'Unknown team option'
      : 'Select at least one team';
  }
  if (fields['Preferred Team'].length > 3) errors.preferredTeam = 'Select up to 3 teams';

  // Either form of availability satisfies this: festival days (Sanctum of
  // Sound) or a recurring availability answer (year-round MaHalla form).
  if (fields['Festival Days'].length === 0 && !availability) {
    errors.festivalDays = sentCount(payload, 'Festival Days', 'festivalDays')
      ? 'Unknown festival day option'
      : 'Select at least one festival day or an availability';
  }

  if (fields.Languages.length === 0) errors.languages = 'Select at least one language';

  return errors;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    log('warn', 'method_not_allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    log('error', 'airtable_config_missing', { hasBaseId: Boolean(baseId), hasToken: Boolean(token) });
    return res.status(500).json({ error: 'Airtable configuration is missing' });
  }

  const { fields, payload, availability } = buildFields(req.body);
  const errors = validate(fields, payload, availability);

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  try {
    const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE_NAME)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // typecast lets Airtable create a select option that does not exist yet
      // (e.g. the renamed Decoration team). Values are whitelisted above, so
      // this cannot create arbitrary options from client input.
      body: JSON.stringify({ fields, typecast: true }),
    });
    const data = await response.json();

    log(response.ok ? 'info' : 'error', 'volunteer_airtable_response', {
      status: response.status,
      ok: response.ok,
      errorType: data?.error?.type,
      errorMessage: data?.error?.message,
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Airtable request failed',
        details: data?.error?.message,
      });
    }

    return res.status(201).json({ ok: true, id: data.id });
  } catch (error) {
    log('error', 'volunteer_airtable_fetch_failed', { error: error.message });
    return res.status(500).json({ error: 'Airtable request failed' });
  }
}
