# Text Editing and Note Taking Application

A browser-based notes workspace created by Cyril Jijo, Jeremiah Hackworth, and Jordyn Binkley. The first implementation supports creating, editing, searching, pinning, and deleting notes, with automatic persistence in the browser.

## Run locally

No build step is required. Start any static web server from the repository root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Documentation

- [Project Information Sheet](docs/information-sheet.md)
- [Production Plan](docs/production-plan.md)
- [Sprint documentation](docs/)

## Team

- Cyril Jijo — Team Lead / Backend
- Jeremiah Hackworth — Frontend / UX
- Jordyn Binkley — Data / QA

## Current functionality

- Create, update, and delete notes
- Autosave title and body changes
- Search note titles and content
- Pin important notes
- Store notes in `localStorage`

## Planned functionality

- User authentication
- Folder and tag organization
- Backend API and database synchronization
- Automated accessibility and end-to-end testing
