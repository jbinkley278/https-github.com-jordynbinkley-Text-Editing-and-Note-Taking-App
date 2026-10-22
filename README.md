# GroupFlow – Smart Collaboration Hub

CSCE 3444 Group 6. GroupFlow keeps a student team’s tasks, deadlines, chat, and progress in one place.

**Team:** Tobi Akere, Brandon Clair, Sandesh Pariyar, Jordyn Binkley

## Architecture

| Layer | Stack |
| --- | --- |
| UI | Vanilla HTML, CSS, and JavaScript (`index.html`, `src/`) — hash router, no bundler |
| API | Express (`server/`) — JSON routes under `/api/*`, static UI served from the repo root |
| Data | MongoDB via the official Node driver — shared groups, tasks, chat, events, activity, sessions |

React / Tailwind migration is deferred. Auth uses email/password with bcrypt hashing and HttpOnly session cookies (`gf.sid`). There is no Cloudflare Turnstile (or other CAPTCHA) on registration.

Shared group data is **not** stored in `localStorage`. The browser store is limited to UI preferences and a separate prototype seed path that is not used as a silent fallback for API-backed groups.

## Setup

### Prerequisites

- Node.js 18+ (npm included)
- MongoDB reachable at the URIs in `.env` (local server or Atlas)

### Environment

```bash
cp .env.example .env
```

Configure **two separate databases**:

| Variable | Purpose | Example |
| --- | --- | --- |
| `MONGODB_URI` | App data for `npm start` / `npm run dev` | `mongodb://127.0.0.1:27017/groupflow` |
| `MONGODB_URI_TEST` | Integration tests only (**required**) | `mongodb://127.0.0.1:27017/groupflow_test` |

Rules:

- Tests **never** fall back to `MONGODB_URI` or the `groupflow` database.
- The test database name must end with `_test` (for example `groupflow_test`).
- `npm test` clears collections only inside that validated test database.
- Never point `MONGODB_URI_TEST` at `groupflow`, `admin`, `local`, or `config`.
- Do not commit `.env` (it is gitignored).

### Install and run

```bash
npm install
npm start
```

Open <http://localhost:3000>.

- Health: <http://localhost:3000/api/health>  
  - `server: "ok"` — Express is up  
  - `database: "connected" | "disconnected"` — MongoDB status (process stays up if MongoDB is down)
- App startup uses `MONGODB_URI` only.

Watch mode:

```bash
npm run dev
```

### Checks

```bash
npm run test:safety   # URI validation only; no MongoDB connection
npm run check         # syntax checks for server and client modules
npm test              # safety + unit + integration tests (needs MONGODB_URI_TEST)
```

Integration tests fail fast if `MONGODB_URI_TEST` is missing or unsafe — before connecting or deleting anything.

## Implemented features

| Area | Behavior | SRS (approx.) |
| --- | --- | --- |
| Auth | Register (name, email, password), login, logout, `/api/auth/me`, HttpOnly sessions | FR-01, FR-02, FR-18 |
| Groups | Create/join groups, invitation codes (no email delivery), member list, roles | FR-03 |
| Tasks | Group-scoped board: create/edit/delete, status, assignee, priority, due date, subtasks | FR-05–FR-08 |
| Calendar | Month view: task due dates (date-only) + team meetings (MongoDB; optional time + IANA zone) | FR-09 |
| Chat | Group messages in MongoDB; open chat polls ~every 3s | FR-10 |
| Unread | Per-user read cursor; unread counts on dashboard / nav (not full notification center) | FR-04 (partial vs FR-11) |
| Activity | Best-effort contribution feed/summary after mutations (not atomic; totals may be incomplete) | FR-13 |
| Profiles | Member profile views (no password hashes exposed) | FR-14 |
| Dashboard / progress | Open tasks, due this week, progress, unread, upcoming deadlines, recent activity | — |
| Health | `/api/health` + static hosting of the UI | — |

## Remaining limitations

- No Google / OAuth sign-in.
- No email delivery for invitations (codes only).
- No file attachments, search, or peer feedback.
- FR-11-style notification center (beyond unread message counts) is not implemented.
- Chat is polling-based, not WebSockets.
- No production deploy/DNS/ops hardening in this branch.
- Prefer a single local server on port 3000; a second `npm start` will fail with `EADDRINUSE`.

## Code layout

```
index.html          App shell
src/api.js          Fetch helpers (cookie credentials)
src/app.js          Hash router and UI event handling
src/views.js        Page renderers
src/store.js        Local UI/prototype store (not shared group persistence)
src/styles.css      Layout and responsive styles
server/             Express app, MongoDB, auth, groups, tasks, messages, events, activity, profiles
test/               Safety URI tests + API/integration suites (isolated test DB)
.env.example        Non-secret configuration placeholders
docs/               Course docs and reference materials
```

## Documentation

- [Project Information Sheet](docs/information-sheet.md) (course template; may lag the current GroupFlow stack)
- [Production Plan](docs/production-plan.md)
- [Reference materials](docs/reference/) (SRS/context and setup notes)
