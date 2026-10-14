# GroupFlow – Smart Collaboration Hub

CSCE 3444 Group 6 project. GroupFlow keeps a student team's tasks, deadlines, chat and progress in one place.

Team: Tobi Akere, Brandon Clair, Sandesh Pariyar, Jordyn Binkley

## Run locally

No build step. Start any static server from the repo root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

Run the tests with `npm test` (Node 18+).

## What works right now

| Screen | Status | SRS |
| --- | --- | --- |
| Dashboard – open tasks, due this week, progress, unread messages, upcoming deadlines, recent activity | Done | FR-04, FR-05 |
| Task Board – To Do / In Progress / Done, create/edit/delete, assignee, priority, due date, drag and drop + arrow buttons for keyboard | Done | FR-08 – FR-10, FR-12 |
| Activity history – task moves, assignments, creates and deletes get logged | Done | FR-13, FR-18 |
| Calendar – month view with task due dates and group events, add event | Done | FR-14 |
| Group Chat | Done (local only) | FR-15 |
| Progress – overall %, status breakdown, per-member contributions | Done | FR-16 |
| Member profiles | Done | FR-17 |
| Login / sign up / sign out | Not started (I-05) | FR-01, FR-02, FR-21 |

Data is stored in the browser (`localStorage`) and seeded with sample tasks the first time it loads. To reset it, clear site data or run `localStorage.removeItem("groupflow.state.v1")` in the console.

## Code layout

- `index.html` – app shell (top bar, sidebar, mobile tab bar, task/event dialogs)
- `src/store.js` – data model and all state changes. This is the file that gets swapped to API calls once the backend is ready.
- `src/views.js` – renders each page
- `src/app.js` – hash router and event handling
- `src/styles.css` – styles, responsive down to 360px
- `test/store.test.mjs` – unit tests for the store

## Documentation

- [Project Information Sheet](docs/information-sheet.md)
- [Production Plan](docs/production-plan.md)
