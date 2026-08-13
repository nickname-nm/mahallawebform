import { addPropertyControls, ControlType } from "framer"
import { useEffect, useState } from "react"

// RSVP-Formular für mahalla.berlin/rsvp.
// In Framer als Code-Komponente einfügen und auf die Seite ziehen.
// Schnittstelle: siehe RSVP_CONTRACT.md in MaHallaWebform.
//
// Die Seite lebt vom Link aus der Einladung: ohne ?g=<token> gibt es kein
// Formular, sonst wäre die Gästeliste keine Gästeliste.

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight auto
 */
export default function RsvpForm(props) {
    const { endpoint, allowPlusOne, accent, danke } = props

    const [state, setState] = useState("laden") // laden | formular | fertig | ungueltig | fehler
    const [gast, setGast] = useState(null)
    const [kommt, setKommt] = useState("")
    const [plusOne, setPlusOne] = useState(false)
    const [begleitung, setBegleitung] = useState("")
    const [anmerkung, setAnmerkung] = useState("")
    const [email, setEmail] = useState("")
    const [sendet, setSendet] = useState(false)

    // Token einmal beim Laden auflösen. Der Vorname steckt im Token, den Rest
    // holt der Endpoint aus Airtable, falls schon geantwortet wurde.
    const token =
        typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("g")
            : null

    useEffect(() => {
        if (!token) {
            setState("ungueltig")
            return
        }

        fetch(`${endpoint}?g=${encodeURIComponent(token)}`)
            .then(async (res) => {
                if (res.status === 403) return setState("ungueltig")
                if (!res.ok) return setState("fehler")

                const data = await res.json()
                setGast(data)
                setKommt(data.antwort || "")
                setPlusOne(data.personen === 2)
                setBegleitung(data.begleitung || "")
                setState("formular")
            })
            .catch(() => setState("fehler"))
    }, [token, endpoint])

    // Plus 1 zeigen wir nur, wenn beide Seiten es erlauben. Verbindlich ist
    // ohnehin die Prüfung im Endpoint.
    const zeigePlusOne = allowPlusOne && gast?.allowPlusOne !== false

    async function absenden() {
        if (!kommt || sendet) return
        setSendet(true)

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    g: token,
                    kommt,
                    personen: kommt === "Ja" && zeigePlusOne && plusOne ? 2 : 1,
                    begleitung,
                    email,
                    anmerkung,
                }),
            })
            setState(res.ok ? "fertig" : "fehler")
        } catch {
            setState("fehler")
        } finally {
            setSendet(false)
        }
    }

    if (state === "laden") return <Rahmen>…</Rahmen>

    if (state === "ungueltig")
        return (
            <Rahmen>
                <p style={text}>
                    Bitte nutze den persönlichen Link aus deiner Einladung.
                </p>
            </Rahmen>
        )

    if (state === "fehler")
        return (
            <Rahmen>
                <p style={text}>
                    Das hat gerade nicht geklappt. Bitte versuch es später noch
                    einmal oder antworte direkt auf die Einladung.
                </p>
            </Rahmen>
        )

    if (state === "fertig")
        return (
            <Rahmen>
                <p style={{ ...text, fontSize: 20 }}>{danke}</p>
            </Rahmen>
        )

    return (
        <Rahmen>
            <p style={{ ...text, fontSize: 20, marginBottom: 24 }}>
                {gast?.vorname ? `Hallo ${gast.vorname},` : "Hallo,"} kommst du?
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                {["Ja", "Nein", "Vielleicht"].map((wert) => (
                    <button
                        key={wert}
                        onClick={() => setKommt(wert)}
                        style={{
                            ...knopf,
                            background: kommt === wert ? accent : "transparent",
                            color: kommt === wert ? "#fff" : "#111",
                            borderColor: kommt === wert ? accent : "#ccc",
                        }}
                    >
                        {wert}
                    </button>
                ))}
            </div>

            {kommt === "Ja" && zeigePlusOne && (
                <label
                    style={{
                        ...text,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 12,
                    }}
                >
                    <input
                        type="checkbox"
                        checked={plusOne}
                        onChange={(e) => setPlusOne(e.target.checked)}
                    />
                    Ich bringe jemanden mit
                </label>
            )}

            {kommt === "Ja" && zeigePlusOne && plusOne && (
                <input
                    style={feld}
                    placeholder="Name der Begleitung"
                    value={begleitung}
                    onChange={(e) => setBegleitung(e.target.value)}
                />
            )}

            {kommt && (
                <input
                    style={feld}
                    type="email"
                    placeholder="Email für die Bestätigung (optional)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
            )}

            {kommt && (
                <textarea
                    style={{ ...feld, minHeight: 80, resize: "vertical" }}
                    placeholder="Anmerkung (optional)"
                    value={anmerkung}
                    onChange={(e) => setAnmerkung(e.target.value)}
                />
            )}

            <button
                onClick={absenden}
                disabled={!kommt || sendet}
                style={{
                    ...knopf,
                    width: "100%",
                    marginTop: 12,
                    background: kommt ? accent : "#ddd",
                    color: "#fff",
                    borderColor: "transparent",
                    cursor: kommt ? "pointer" : "default",
                }}
            >
                {sendet
                    ? "…"
                    : gast?.bereitsGeantwortet
                      ? "Antwort ändern"
                      : "Absenden"}
            </button>
        </Rahmen>
    )
}

function Rahmen({ children }) {
    return (
        <div
            style={{
                width: "100%",
                maxWidth: 460,
                padding: 28,
                boxSizing: "border-box",
                fontFamily: "inherit",
            }}
        >
            {children}
        </div>
    )
}

const text = { margin: 0, fontSize: 16, lineHeight: 1.5, color: "#111" }

const knopf = {
    padding: "12px 18px",
    fontSize: 16,
    border: "1px solid #ccc",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "inherit",
}

const feld = {
    width: "100%",
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    border: "1px solid #ccc",
    borderRadius: 4,
    boxSizing: "border-box" as const,
    fontFamily: "inherit",
}

RsvpForm.defaultProps = {
    endpoint: "https://mahallawebform.vercel.app/api/rsvp",
    allowPlusOne: true,
    accent: "#111111",
    danke: "Danke — wir haben deine Antwort.",
}

addPropertyControls(RsvpForm, {
    endpoint: { type: ControlType.String, title: "Endpoint" },
    allowPlusOne: { type: ControlType.Boolean, title: "Plus 1" },
    accent: { type: ControlType.Color, title: "Akzent" },
    danke: { type: ControlType.String, title: "Danke-Text" },
})
