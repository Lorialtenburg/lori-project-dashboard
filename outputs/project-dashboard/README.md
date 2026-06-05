# Lori Project Dashboard

A responsive single-page project dashboard for shared manager review. The app provides a professional table-based view of project status, collapsible project updates, manager comments, live refresh across viewers, and a protected edit mode for updating project details.

## Features

- Responsive project dashboard for desktop and mobile
- Status filters for quick manager review
- Editable project name and status in edit mode
- Collapsible update/task sections for each project
- Add project updates with timestamp tracking
- Manager comment box
- Live updates across connected viewers using server-sent events
- Read-only manager view
- Protected edit mode controlled by an edit key
- Local JSON-backed server state for development and small shared deployments

## Installation

Install Node.js, then install project dependencies:

```bash
npm install
```

Use `.env.example` as a reference for the environment variables your host should set:

```bash
EDIT_KEY=replace-with-a-private-edit-key
PORT=4174
```

Do not commit a real `.env` file or private edit key.

## Usage

Build the React client:

```bash
npm run build
```

Start the dashboard server:

```bash
npm start
```

Open the manager read-only view:

```text
http://localhost:4174/?view=manager
```

Open edit mode:

```text
http://localhost:4174/?mode=edit&key=local-edit-key
```

For deployment, set `EDIT_KEY` in the hosting provider environment and use that value in the edit-mode URL.

## Technology Stack

- React
- Vite
- Express
- Node.js
- Server-sent events for live updates
- JSON file storage for local/shared server state
- Lucide React icons

## Deployment Notes

This app is ready to commit to GitHub as source code. The generated `dist/` folder, installed `node_modules/`, logs, `.env`, and runtime `server-data/` are intentionally excluded from Git.

For a production deployment, use a Node-compatible host and configure:

- `PORT`
- `EDIT_KEY`

If multiple people will use the app long term, replace local JSON file storage with a persistent database such as Supabase, PostgreSQL, Firebase, or another managed backend.
