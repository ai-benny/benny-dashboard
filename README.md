# 🧠 Benny Dashboard

Persoonlijk OpenClaw control panel voor Bas. Lokaal draaien op `localhost:3000`.

## Functies

- **Home** — OpenClaw status, cron jobs overzicht, recente LinkedIn ideeën
- **Cron Jobs** — Alle geplande taken met tijden, status en taakprompts
- **Config Files** — Bekijk en bewerk SOUL.md, USER.md, MEMORY.md en meer
- **Memory** — Dagelijkse notitiebestanden van Benny
- **LinkedIn Planner** — Content ideeën vanuit Notion, gefilterd op type/status
- **Flowcharts** — Visuele overzichten (Mermaid.js)

## Setup

```bash
git clone https://github.com/ai-benny/benny-dashboard.git
cd benny-dashboard
npm install
node server.js
```

Open: http://localhost:3000

## Config aanpassen

De bestanden die Benny's gedrag bepalen zijn direct bewerkbaar via het dashboard onder **Config Files**. Aanpassingen worden direct opgeslagen — Benny gebruikt ze bij de volgende sessie.

| Bestand | Effect |
|---------|--------|
| `SOUL.md` | Persoonlijkheid, communicatiestijl |
| `USER.md` | Context over Bas en zijn projecten |
| `MEMORY.md` | Langetermijngeheugen |
| `HEARTBEAT.md` | Proactieve checks |
| `TOOLS.md` | Lokale notities (cameras, SSH etc.) |

## API

| Route | Beschrijving |
|-------|-------------|
| `GET /api/status` | OpenClaw status |
| `GET /api/crons` | Alle cron jobs (JSON) |
| `GET /api/files` | Lijst van config bestanden |
| `GET /api/file/:name` | Bestand lezen |
| `PUT /api/file/:name` | Bestand opslaan |
| `GET /api/notion/linkedin` | LinkedIn Planner uit Notion |
| `GET /api/memory` | Memory bestanden lijst |
| `GET /api/memory/:name` | Memory bestand lezen |
| `GET /api/models` | Model status |

## Vereisten

- Node.js 18+
- OpenClaw geïnstalleerd (`/opt/homebrew/bin/openclaw`)
- Notion API key op `~/.config/notion/api_key`
