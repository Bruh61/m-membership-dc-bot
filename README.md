// --- file: README.md
# Discord Temp Role Bot

**Wichtiges Update:** DMs verwenden jetzt den **Rollen-Namen** statt einer Rollen-Mention, damit die Nachricht außerhalb des Servers sinnvoll lesbar ist.

Features:
- Temporäre Rollen vergeben, verlängern, entfernen (mit Log-Embeds)
- Automatischer Entzug bei Ablauf + 5-Tage-Warnungen (Spam-Schutz)
- `/my-temp-roles` für User (ephemeral)
- `/list-temp-roles` mit Pagination für Admins
- `/expiry-dm` (nur Admin) sendet DM an User mit Ablaufdetails (mit **Rollenname**)
- `/export-json` & `/import-json` (Attachment) für Wartung
- JSON-Datenbank mit Backups & Rotation
- Separates `register-commands.js` (einmalig ausführen)

## Setup
1. `cp .env.example .env` und Werte setzen
2. `npm i`
3. `npm run register` (oder `node register-commands.js`)
4. `npm start`

## Hinweise
- Der Bot benötigt **Manage Roles** und muss **oberhalb** der Zielrollen stehen.
- DMs sind nie *ephemeral*; das Ephemeral gilt nur für Slash-Replies an den Admin.