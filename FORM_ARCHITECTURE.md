# MaHalla Webform Architecture

## Purpose

`MaHallaWebform` is the small public form backend for MaHalla website and campaign forms.

It should stay separate from `MaHallaOS`.

Use this project for public-facing forms such as:

- website contact messages
- location inquiries
- newsletter signups
- festival or volunteering applications

This keeps public form changes deployable without redeploying the internal MaHalla OS app.

## Current Public Endpoints

### `/api/inquiry`

Main endpoint for website contact and location forms.

Current behavior:

- `formType: "location"`
  - writes the submitted fields to Airtable table `inquiries`
  - sends a Resend email to `location@mahalla.berlin`

- any other `formType`
  - sends a Resend email to `info@mahalla.berlin`
  - does not write to Airtable

The existing Framer custom component posts to:

```text
https://mahallawebform.vercel.app/api/inquiry
```

### `/api/newsletter`

Newsletter signup endpoint.

Current behavior:

- sends email/name to Brevo
- uses `BREVO_API_KEY`
- optionally uses `BREVO_LIST_ID`

## Environment Variables

This project expects secrets to live in Vercel environment variables.

Current variables used by the API routes:

```env
RESEND_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_PAT=
BREVO_API_KEY=
BREVO_LIST_ID=
```

Do not hardcode these in the frontend or commit them to Git.

## Recommended Pattern For New Public Forms

For a new public form, prefer adding a focused endpoint here instead of changing MaHallaOS.

Example:

```text
Framer / Public Campaign Page
        ↓
https://mahallawebform.vercel.app/api/volunteer
        ↓
Resend + optional Airtable/Brevo/etc.
```

For the Sanctum of Sound volunteering form, a good next step would be:

- add `api/volunteer.js`
- add a rewrite in `vercel.json`
- validate required fields server-side
- send a Resend email to the responsible team address
- optionally write structured submissions to Airtable

This avoids redeploying MaHallaOS whenever public campaign form copy, fields, or routing changes.

## MaHallaOS Relationship

`MaHallaOS` is the internal operating system for Mahalla.

It currently contains internal modules such as:

- Stunden / time tracking
- booking intake
- accounting dry run
- internal Airtable-backed tools

MaHallaOS should not be the default home for public website forms.

Use MaHallaOS when the team needs an internal interface to review, manage, or process data. Use `MaHallaWebform` when the public internet needs to submit data.

Good boundary:

- public user submits a form -> `MaHallaWebform`
- internal team reviews or manages records -> `MaHallaOS`
- shared data storage, when needed -> Airtable

## Existing Location Form Context

The current website custom component has two modes:

- `contact`
- `location`

It posts to `/api/inquiry`.

The frontend sends a generic payload:

```js
{
  formType: "location",
  fields: {
    "Project Title": "...",
    "Start Date": "...",
    "End Date": "...",
    "Contact Firstname": "...",
    "contact mail": "...",
    "Project Source": "Webform"
  }
}
```

The backend decides what to do based on `formType`.

For future forms, keep this same idea, but prefer dedicated endpoints when the form has its own workflow. For example, use `/api/volunteer` for volunteering instead of overloading `/api/inquiry`.

## Deployment Notes

This project is hosted on Vercel at:

```text
https://mahallawebform.vercel.app
```

Deploying this project should not require a MaHallaOS deploy.

If a new API file is added, remember to add a matching rewrite in `vercel.json`.
