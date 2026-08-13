# Volunteer Form — Working Notes

Context handoff for anyone (human or AI) picking up the volunteer forms.
High level only: where things live, how the pieces connect, and the traps.
See `FORM_ARCHITECTURE.md` for the wider MaHallaWebform picture.

## The three moving parts

A volunteer submission crosses three systems that are edited in three
different places. Almost every bug so far came from one of them being a
version behind the others.

| Part | Lives in | Edited via |
| --- | --- | --- |
| Form UI (React/TS code component) | Framer page | pasted into Framer by hand |
| API route | `MaHallaWebform/api/volunteer.js` | Git → Vercel |
| Storage | Airtable base `MaHalla`, table `Volunteers` | Airtable UI |

Repos on the Mac live under `~/Desktop/ClaudeWorld/`:

- `MaHallaWebform` — public form endpoints (this one). Repo:
  `github.com/nickname-nm/mahallawebform`, branch `main`, auto-deploys to
  `mahallawebform.vercel.app`.
- `MaHallaOS` — internal tools. Not involved in public forms.

Live pages: `mahalla.berlin/volunteering_stage` (year-round MaHalla form).
The Sanctum of Sound festival form is a separate Framer page using the
**same** endpoint and the **same** Airtable table.

## Two forms, one endpoint, one table

This is the single most important thing to know.

- **Sanctum of Sound** (festival): asks for `festivalDays`, shifts, setup/teardown.
- **MaHalla** (year-round): asks for `availability` instead; no festival days.

Both POST to `/api/volunteer` and both land in `Volunteers`. So any change to
validation or to the option whitelists must keep the other form working.
The endpoint accepts either payload shape:

```js
{ firstName, lastName, email, phone, ageConfirmed, motivation,
  preferredTeam: [], availability, languages: [], skills: [], ... }   // preferred
{ fields: { Firstname, Lastname, "Age 18+", "Preferred Team": [], ... } } // legacy
```

`parsePayload()` unwraps `fields`, and every getter takes an Airtable-style
key with a camelCase fallback. Don't remove that — the deployed Framer
component may still be on the older shape.

## Traps that cost real debugging time

**1. Silent whitelist drops.** `cleanList()` filters submitted values against
a hardcoded allow-list and returns `[]` for anything unrecognised. Renaming an
option in the form without renaming it in `volunteer.js` meant every
submission failed with "Select at least one team" — which reads as "the user
picked nothing", not "the server threw the answer away". Validation now
distinguishes the two ("Unknown team option"). Keep that distinction.

**2. The option lists exist in three places** — the Framer component, the
whitelist in `volunteer.js`, and the Airtable select field's choices. All
three must agree. `typecast: true` on the Airtable write covers the third one
(Airtable creates a missing select option instead of rejecting the record),
but the first two are manual.

**3. The Framer component is not in Git.** It is pasted into Framer. The live
site can therefore be an older build than the `.tsx` you're reading, and it
will not be obvious. Verify before assuming — see below.

**4. `Other Answers` is composed server-side.** It is one multiline Airtable
field holding availability, shifts, skills, other skill, other language,
setup/teardown, anything else. If the client sends a pre-composed
`Other Answers` string, the server uses it verbatim and ignores the structured
keys. Availability is also parsed back *out* of that text as a fallback, so
older component builds keep validating.

## How to debug this stack quickly

**See the API's own schema** — post an empty body, it lists every required
field:

```bash
curl -s -X POST https://mahallawebform.vercel.app/api/volunteer \
  -H "Content-Type: application/json" -d '{}'
```

**See what the live form actually sends**, without writing a test record —
in the browser console on the form page, stub `fetch` before submitting:

```js
window.__sent = null
const rf = window.fetch.bind(window)
window.fetch = (u, o) => String(u).includes('/api/volunteer')
  ? (window.__sent = o.body,
     Promise.resolve(new Response('{"ok":true}', { status: 201 })))
  : rf(u, o)
// fill + submit the form, then:
JSON.parse(window.__sent)
```

This is how the "submit still broken" bug was finally pinned down: the API was
already fixed and deployed, but the live Framer component was one build behind
and wasn't sending `availability` at all.

**Prefer probing over test records.** A deliberately invalid payload returns
the validation result without writing to Airtable. If a real test record does
get created, delete it — one stray `ZZTEST` row is easy to leave behind.

## UI conventions in the component

- Chips (`<button>`), not checkboxes/radios. Selected = red fill.
- Chips never take focus (`onMouseDown` preventDefault) — a focused button can
  make the browser scroll.
- A scroll guard snapshots the window scroll plus every scrollable ancestor on
  chip click and restores it in `useLayoutEffect`. It exists because the
  **Framer page** moved the scroll position, not the component. If a scroll
  jump appears again, test the component on a blank Framer page first to
  separate page effects from component behaviour.
- Validation is client-side *and* server-side; the client messages are the
  friendly ones, the server is the source of truth. Failed submissions log the
  real status and response body to the console under `[volunteer form]`.

## Airtable shape (table `Volunteers`)

`Firstname`, `Lastname`, `Email`, `Phone`, `Birthday`, `Age 18+` (single
select), `Preferred Team` (multi), `Festival Days` (multi), `Languages`
(multi), `Motivation`, `Other Answers` (multiline), `Status` (single select —
new rows are written as `Application`).

There is no availability column; availability lives inside `Other Answers`.
Add a proper field if it ever needs filtering or grouping.
