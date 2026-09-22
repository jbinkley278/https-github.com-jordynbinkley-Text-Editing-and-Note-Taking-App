# Production Plan — Text Editing and Note Taking Application

**Plan version:** 1.0

**Planning date:** September 22, 2026

**Target release:** October 23, 2026

**Project group:** Group 6

**Team:** Tobi Akere, Brandon Clair, Pariyar Sandesh, Jordyn Binkley

**Information Sheet submission deadline:** Tuesday, September 25 (as provided in the assignment)

## Product goal and success criteria

Build a responsive web application where authenticated users can create, edit, autosave, organize, search, and delete notes. The release is successful when the critical user journey passes on current Chrome, Firefox, and Safari; no high-severity accessibility or security issue remains; and at least 90% of planned acceptance tests pass.

## Roles and working agreement

| Member | Primary responsibility | Review responsibility |
| --- | --- | --- |
| Tobi Akere | Team lead, API, authentication, deployment | Architecture and pull requests |
| Brandon Clair | UI system, responsive editor, accessibility | UX acceptance criteria |
| Pariyar Sandesh | Data model, search, testing, documentation | Test coverage and release checklist |
| Jordyn Binkley | Product coordination, documentation, and acceptance testing | Requirements and release readiness |

Work is tracked on Trello; each task has one owner, deadline, acceptance criteria, and status. Work is completed through a feature branch and reviewed pull request. The team holds a 15-minute check-in Monday/Wednesday/Friday and a Friday demo/retrospective.

## Milestones and task schedule

| ID | Task / deliverable | Owner | Start | Due | Dependency | Status / definition of done |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | Confirm scope, personas, and user stories | Tobi | Sep 22 | Sep 23 | — | In progress; stories approved by team |
| P-02 | Set up repository, README, ignore rules, and PR template | Pariyar | Sep 22 | Sep 22 | — | **Done** |
| P-03 | Create Trello workflow and enter/assign backlog | Tobi | Sep 22 | Sep 23 | P-01 | To do; board shared and ≥3 cards assigned |
| P-04 | Produce wireframes and responsive interaction states | Brandon | Sep 22 | Sep 25 | P-01 | In progress; desktop/mobile states reviewed |
| P-05 | Define data model and API contract | Pariyar | Sep 23 | Sep 25 | P-01 | To do; schemas and errors documented |
| I-01 | Build application shell and responsive note editor | Brandon | Sep 22 | Sep 28 | P-04 | **Started**; keyboard-usable at 360–1440 px |
| I-02 | Implement local note CRUD and autosave prototype | Pariyar | Sep 22 | Sep 28 | P-05 | **Started**; unit tests pass and data persists |
| I-03 | Implement search, pinning, folders, and tags | Pariyar | Sep 29 | Oct 2 | I-02 | To do; filters return expected notes |
| I-04 | Build REST API and database migrations | Tobi | Sep 28 | Oct 5 | P-05 | To do; CRUD integration tests pass |
| I-05 | Add registration, login, logout, and session handling | Tobi | Oct 2 | Oct 7 | I-04 | To do; protected routes reject anonymous users |
| I-06 | Connect UI to API and resolve offline/error states | Brandon | Oct 6 | Oct 9 | I-01, I-04 | To do; all states provide actionable feedback |
| Q-01 | Add unit and integration test suites | Pariyar | Sep 24 | Oct 12 | I-02, I-04 | In progress; core data functions covered |
| Q-02 | Run keyboard, contrast, and screen-reader audit | Brandon | Oct 9 | Oct 13 | I-06 | To do; WCAG 2.2 AA blockers resolved |
| Q-03 | Cross-browser and responsive acceptance testing | Team | Oct 12 | Oct 15 | I-06 | To do; test matrix signed off |
| Q-04 | Security review: validation, authorization, secrets | Tobi | Oct 12 | Oct 15 | I-05 | To do; no critical/high findings |
| R-01 | Prepare deployment configuration and runbook | Tobi | Oct 14 | Oct 19 | Q-04 | To do; staging deploy reproducible |
| R-02 | Complete user guide, architecture notes, and demo script | Pariyar | Oct 14 | Oct 20 | I-06 | To do; links and screenshots verified |
| R-03 | User acceptance test and defect triage | Team | Oct 19 | Oct 21 | Q-01–Q-04 | To do; release blockers closed |
| R-04 | Production release and smoke test | Tobi | Oct 22 | Oct 23 | R-01–R-03 | To do; health checks and critical journey pass |

## Sprint outcomes

1. **Sprint 1 (Sep 22–28): Foundation.** Approved requirements, wireframes, data/API design, responsive shell, and local CRUD prototype.
2. **Sprint 2 (Sep 29–Oct 5): Core features.** Organization/search tools, database, API, and initial integration tests.
3. **Sprint 3 (Oct 6–12): Integration.** Authentication, UI/API integration, error handling, and expanded automated tests.
4. **Sprint 4 (Oct 13–23): Quality and release.** Accessibility, security, browser validation, documentation, UAT, and deployment.

## Risks and responses

| Risk | Probability / impact | Mitigation | Owner |
| --- | --- | --- | --- |
| API integration takes longer than expected | Medium / High | Agree on contract early; use fixtures while API is built | Tobi |
| Data loss during autosave | Low / High | Debounce writes, add persistence tests, retain timestamps | Pariyar |
| Accessibility defects found late | Medium / Medium | Use semantic controls from Sprint 1 and audit in Sprint 3 | Brandon |
| Team availability delays a critical task | Medium / Medium | Document handoffs, flag blockers within one workday | Tobi |
| Scope expansion threatens release | Medium / High | Prioritize CRUD/auth/search; defer collaboration/export | Team |

## Initial Trello assignments

These cards are the minimum work that must be present and assigned on the shared board before the September 25 submission deadline:

| Trello card | Assignee | Due date | First action | Evidence of progress |
| --- | --- | --- | --- | --- |
| I-01 — Responsive note editor | Brandon | Sep 28 | Compare the implementation shell with the approved digital wireframe and record responsive gaps | Application shell committed; desktop and mobile review recorded on the card |
| I-02 — Local CRUD and autosave | Pariyar | Sep 28 | Validate create, update, delete, and persistence behavior | Store implementation and passing unit tests linked on the card |
| I-04 — REST API and migrations | Tobi | Oct 5 | Draft note endpoints, request fields, and response/error shapes | API contract attached to the card and reviewed by the team |

P-03 requires Tobi to copy these assignments to Trello, invite the team, and enable public link viewing. Each owner moves their card to **Doing** when the first action begins and posts evidence in the card rather than reporting progress only in chat.

## September 25 submission gate

Before submitting the Information Sheet, Group 6 will complete this checklist:

- [x] Production Plan is complete and linked from the Information Sheet.
- [ ] Production Plan link opens in a logged-out/private browser window.
- [ ] Public Trello URL is pasted into the Information Sheet and opens while logged out.
- [ ] I-01, I-02, and I-04 are assigned to Brandon, Pariyar, and Tobi respectively.
- [x] GitHub repository link opens and the repository contains an initialized README.
- [x] Implementation has started and the initial source/tests are committed.
- [ ] One teammate performs a final link and spelling review before submission.

## Release checklist

- All release-blocking acceptance criteria and migrations pass in staging.
- Automated tests, lint/static checks, and manual browser matrix are recorded.
- Secrets are stored outside source control; backups and rollback are documented.
- README, Information Sheet, production plan, user guide, and board are current.
- Product owner approves UAT; team completes post-deploy smoke test.

