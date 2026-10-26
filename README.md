# GroupFlow – Smart Collaboration Hub

CSCE 3444 Group 6. GroupFlow keeps a student team’s tasks, deadlines, chat, and progress in one place.

**Team:** Tobi Akere, Brandon Clair, Sandesh Pariyar, Jordyn Binkley

## Architecture

| Layer | Stack |
| --- | --- |
| UI | Vanilla HTML, CSS, and JavaScript (`index.html`, `src/`) — hash router, no bundler |
| API | Express (`server/`) — JSON routes under `/api/*`, static UI served from the repo root |
| Data | MongoDB via the official Node driver — shared groups, tasks, chat, events, activity, sessions |

React / Tailwind migration is deferred. Auth uses email/password with bcrypt hashing and HttpOnly session cookies (`gf.sid`). New accounts require Cloudflare Turnstile on registration and a 6-digit email verification code before a session is created.

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

Registration also needs:

| Variable | Purpose |
| --- | --- |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile widget (dummy keys OK in development) |
| `REGISTRATION_CODE_PEPPER` | HMAC secret for verification codes at rest |
| `RESEND_API_KEY` + `EMAIL_FROM` | Real email delivery via Resend |

For local UI without Resend, set `EMAIL_ADAPTER=memory` and `EXPOSE_DEV_VERIFICATION_CODE=1` so the verify screen can show the code. **Dev-code / memory-adapter verification does not prove email ownership** — it only exercises the pending→verify flow. Real ownership checks require configured Resend (`RESEND_API_KEY` + `EMAIL_FROM`, `EMAIL_ADAPTER` unset or `resend`). Dummy Turnstile keys are rejected when `NODE_ENV=production`.

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

## Feature status (local vs deployed)

Do not assume <https://groupflow-demo.onrender.com> matches this branch.

| Surface | Locally implemented & tested (this branch) | Currently deployed on Render (as last probed) |
| --- | --- | --- |
| Auth | Turnstile + pending registration + email code verify/resend + session after verify | Immediate `POST /api/auth/register` → user + `gf.sid` (no Turnstile/OTP routes) |
| Chat attachments | GridFS upload/download/delete (membership-gated) | Attachment routes not present |
| Groups / tasks / calendar / unread / activity | As in the table below | Present on the prior release |

### Locally implemented features

| Area | Behavior | SRS (approx.) |
| --- | --- | --- |
| Auth | Register + Turnstile → pending account → email code → activate session; login/logout/`/api/auth/me` | FR-01, FR-02, FR-18 |
| Groups | Create/join groups, invitation codes (no email delivery), member list, roles | FR-03 |
| Tasks | Group-scoped board: create/edit/delete, status, assignee, priority, due date, subtasks | FR-05–FR-08 |
| Calendar | Month view: task due dates (date-only) + team meetings (MongoDB; optional time + IANA zone) | FR-09 |
| Chat | Group messages in MongoDB; open chat polls ~every 3s | FR-10 |
| Chat attachments | One file per message via GridFS (≤10 MB; JPEG/PNG/WebP/PDF/TXT/DOCX/XLSX/PPTX); authenticated download; delete by uploader or coordinator | — |
| Unread | Per-user read cursor; unread counts on dashboard / nav (not full notification center) | FR-04 (partial vs FR-11) |
| Activity | Best-effort contribution feed/summary after mutations (not atomic; totals may be incomplete) | FR-13 |
| Profiles | Member profile views (no password hashes exposed) | FR-14 |
| Dashboard / progress | Open tasks, due this week, progress, unread, upcoming deadlines, recent activity | — |
| Health | `/api/health` + static hosting of the UI | — |

### Remaining production blockers / limitations

- **Deploy:** This branch (verified registration + attachments) has not been pushed/deployed to Render yet.
- **Sending domain:** Real verification mail needs Resend with a **verified sending domain** and production `RESEND_API_KEY` + `EMAIL_FROM`. Until then, use `EMAIL_ADAPTER=memory` locally only (does **not** prove email ownership).
- **Turnstile:** Production needs real widget keys and `TURNSTILE_ALLOWED_HOSTNAMES` set to the live host(s) (not localhost defaults). Dummy keys are rejected when `NODE_ENV=production`.
- **Abandoned GridFS uploads:** Staged attachment **metadata** expires after ~1 hour via TTL; there is **no** automatic cleanup of orphaned GridFS file/chunk bytes after that expiry.
- No malware scanning for chat attachments (type/size/magic-byte checks only); no per-group storage quota.
- No Google / OAuth sign-in; invitation codes are still not emailed.
- No search or peer feedback; chat remains polling-based.
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
