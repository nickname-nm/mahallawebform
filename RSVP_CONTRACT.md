# RSVP Contract — Art Week 2026

Verbindliche Schnittstelle zwischen Google Sheet, `api/rsvp.js` und der Framer-Seite.
Wer eines der vier Kapitel ändert, muss alle drei Seiten anfassen.

Vollständiger Plan: Projekt „MaHalla OS", `claude/artweek26-guest-management.md`.

---

## 1. Spalten der Listen-Tabs

Jeder Listen-Tab im Sheet „Gästeliste ArtWeek26" hat exakt diese Spalten in dieser
Reihenfolge. Die Apps Scripts lesen über den Kopftext, nicht über den Index — die
Reihenfolge ist trotzdem verbindlich, damit alle Tabs gleich aussehen.

| # | Spalte | Inhalt |
|---|---|---|
| A | `ID` | `VIP-001` — Präfix = Tab, eindeutig über alle Tabs, ändert sich nie |
| B | `Vorname` | geht in den Token und in die Begrüßung auf der RSVP-Seite |
| C | `Nachname` | |
| D | `Funktion/Firma` | |
| E | `Email` | leer = per Brevo nicht erreichbar |
| F | `Telefon` | E.164, also `+49171…` |
| G | `Kontakt Kategorie` | steuert die Brevo-Liste, Zuordnung im Tab `Config` |
| H | `Kanal` | `Brevo` · `WhatsApp` · `persönlich` |
| I | `Status` | siehe Kapitel 4 |
| J | `Eingeladen am` | vom Push gesetzt |
| K | `Personen` | aus dem RSVP |
| L | `Begleitung` | aus dem RSVP |
| M | `Notiz` | von Hand |
| N | `RSVP-Link` | vom Push erzeugt |

---

## 2. Token

Der Link in der Einladung lautet:

```
https://mahalla.berlin/rsvp?g=<payload>.<sig>
```

- `payload` = base64url von `"<ID>|<Vorname>"`, ohne `=`-Padding
- `sig` = die ersten 8 Hex-Zeichen von `HMAC-SHA256(payload, RSVP_SECRET)`

Der Vorname steckt mit im Token, damit die Seite „Hallo Jonas" begrüßen kann, ohne
dass der Endpoint die Gästeliste kennen muss. Weil die Signatur über den gesamten
Payload geht, lässt sich weder die ID noch der Name manipulieren.

`RSVP_SECRET` liegt an genau zwei Stellen: in den Skripteigenschaften des Sheets und
in den Vercel-Env-Variablen von MaHallaWebform. Nirgends sonst, insbesondere nicht in
Git und nicht in einer Sheet-Zelle.

Beispiel mit `RSVP_SECRET=test`:

```
ID      VIP-001
Vorname Jonas
payload VklQLTAwMXxKb25hcw
Token   VklQLTAwMXxKb25hcw.<8 Hex-Zeichen>
```

---

## 3. Endpoint

Ein Handler, drei Zugriffe, unterschieden nach Methode und Query. Basis:
`https://mahallawebform.vercel.app/api/rsvp`

### 3.1 `GET ?g=<token>` — Gast auflösen

Antwort `200`:

```json
{ "ok": true, "gastId": "VIP-001", "vorname": "Jonas",
  "bereitsGeantwortet": false, "antwort": null,
  "personen": 1, "begleitung": "", "allowPlusOne": true }
```

Bei ungültiger Signatur `403 { "error": "invalid_token" }`. Die Seite zeigt dann
„Bitte nutze den Link aus deiner Einladung" — nie ein leeres Formular.

### 3.2 `POST` — Antwort speichern

```json
{ "g": "<token>", "kommt": "Ja", "personen": 2,
  "begleitung": "Maria Vasylieva", "email": "jonas@…", "anmerkung": "" }
```

- `kommt` ∈ `Ja` · `Nein` · `Vielleicht`, Pflicht
- `personen` ∈ 1 · 2. Serverseitig auf 1 gedeckelt, wenn `kommt !== "Ja"` oder
  `RSVP_ALLOW_PLUS_ONE` nicht auf `true` steht
- `begleitung`, `email`, `anmerkung` optional

Antwort `200 { "ok": true }`. Upsert über die Gast-ID: zweimaliges Absenden
aktualisiert dieselbe Zeile, statt eine zweite anzulegen.

### 3.3 `GET ?all=1&token=<admin>` — Abholung durchs Sheet

`token` ist `RSVP_ADMIN_TOKEN`, **nicht** ein Gast-Token. Antwort:

```json
{ "ok": true, "antworten": [
  { "gastId": "VIP-001", "name": "Jonas", "antwort": "Ja", "personen": 2,
    "begleitung": "Maria Vasylieva", "email": "jonas@…",
    "anmerkung": "", "antwortAm": "2026-08-28T14:03:11.000Z" }
] }
```

---

## 4. Status

| Rang | Wert | Gesetzt von |
|---|---|---|
| 0 | `Neu` | Ausgangszustand |
| 1 | `Ready for Brevo Import` | **von Hand** — die Freigabe. Nur diese Zeilen gehen an Brevo |
| 2 | `Eingeladen` | Push nach erfolgreicher Übergabe; beim WhatsApp-Track von Hand |
| 3 | `Geöffnet` | Brevo-Export |
| 4 | `Vielleicht` | RSVP-Import |
| 5 | `Zugesagt` | RSVP-Import |
| 5 | `Abgesagt` | RSVP-Import |
| 99 | `Unzustellbar` | Brevo-Bounce — überschreibt alles, muss auffallen |

**Ein Status wird nie durch einen niedrigeren überschrieben.** Sonst wirft der
nächste Brevo-Export eine bestehende Zusage zurück auf `Geöffnet`.

Abbildung `kommt` → Status: `Ja` → `Zugesagt`, `Nein` → `Abgesagt`,
`Vielleicht` → `Vielleicht`.

---

## 5. Env-Variablen

In Vercel für MaHallaWebform:

```env
RSVP_SECRET=            # gemeinsam mit dem Apps Script
RSVP_ADMIN_TOKEN=       # nur fürs Abholen der Antworten
RSVP_ALLOW_PLUS_ONE=true
RSVP_EVENT_LABEL=       # Textbaustein für die Bestätigungsmail
```

Vorhanden und mitgenutzt: `AIRTABLE_PAT` (oder `AIRTABLE_API_KEY`),
`AIRTABLE_BASE_ID`, `RESEND_API_KEY`.

---

## 6. Airtable-Tabelle `ArtWeek Guests`

| Feld | Typ |
|---|---|
| `Gast-ID` | Einzeiliger Text, eindeutig |
| `Name` | Einzeiliger Text |
| `Antwort` | Auswahl: Ja · Nein · Vielleicht |
| `Personen` | Zahl |
| `Begleitung` | Einzeiliger Text |
| `Email` | Email |
| `Anmerkung` | Langer Text |
| `Antwort am` | Datum, mit Uhrzeit |

Nur Rückläufe. Die Stammdaten bleiben im Sheet.
