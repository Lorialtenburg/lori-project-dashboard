import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4174);
const EDIT_KEY = process.env.EDIT_KEY || "local-edit-key";
const DATA_DIR = path.join(__dirname, "server-data");
const DATA_FILE = path.join(DATA_DIR, "dashboard-state.json");

const STATUSES = [
  "Not Started",
  "In Progress",
  "At Risk",
  "Blocked",
  "Complete",
  "Deferred"
];

const initialProjects = [
  ["suspended-hotels-decomm", "Suspended Hotels / Decomm Process", "In Progress", "Operations", "2026-06-17", "Confirm hotel list and sequence remaining decomm steps."],
  ["v5-tracking", "V5 Tracking", "In Progress", "Program Team", "2026-06-14", "Track rollout milestones and surface exceptions during weekly review."],
  ["v5-extended-contracts", "V5 customers with extended contracts", "At Risk", "Contracts", "2026-06-24", "Validate contract terms and escalation needs for extended customers."],
  ["distribution-contract-renewals", "Distribution Contract Renewals", "Not Started", "Vendor Management", "2026-07-01", "Prepare renewal queue and assign negotiation owners."],
  ["weekly-install-implementation", "Weekly Install/Implementation Reports", "In Progress", "Implementation", "2026-06-07", "Keep weekly rollup current for manager review."],
  ["monthly-billing-summary", "Monthly Billing Summary", "Complete", "Billing", "2026-06-05", "Summary package is ready for this review cycle."],
  ["monthly-billing-audit", "Monthly Billing Audit", "Not Started", "Finance Ops", "2026-06-21", "Audit sampling plan still needs owner confirmation."],
  ["iad-fra-region-oda", "IAD to FRA region ODA", "Blocked", "Regional Ops", "2026-06-28", "Awaiting dependency confirmation from regional stakeholders."]
];

function makeInitialState() {
  const timestamp = new Date().toISOString();

  return {
    projects: initialProjects.map(([id, name, status, owner, dueDate, notes]) => ({
      id,
      name,
      status,
      owner,
      dueDate,
      notes,
      updates: [],
      lastUpdatedAt: timestamp,
      lastUpdatedBy: ""
    })),
    comments: [],
    audit: []
  };
}

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    writeState(makeInitialState());
  }
}

function readState() {
  ensureDataFile();

  try {
    const state = normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
    writeState(state);
    return state;
  } catch (error) {
    const backupFile = `${DATA_FILE}.${Date.now()}.broken`;
    fs.copyFileSync(DATA_FILE, backupFile);
    const freshState = makeInitialState();
    writeState(freshState);
    return freshState;
  }
}

function normalizeState(state) {
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.comments = Array.isArray(state.comments) ? state.comments : [];
  state.audit = Array.isArray(state.audit) ? state.audit : [];

  for (const project of state.projects) {
    project.updates = Array.isArray(project.updates) ? project.updates : [];
  }

  return state;
}

function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function publicState(state = readState()) {
  return {
    statuses: STATUSES,
    projects: state.projects,
    comments: state.comments,
    audit: state.audit,
    serverTime: new Date().toISOString()
  };
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function makeProjectId(name, projects) {
  const slug = cleanText(name, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
  const existingIds = new Set(projects.map((project) => project.id));
  let id = slug;
  let suffix = 2;

  while (existingIds.has(id)) {
    id = `${slug}-${suffix}`;
    suffix += 1;
  }

  return id;
}

function requireEdit(req, res, next) {
  const suppliedKey = req.get("x-edit-key") || req.query.editKey;

  if (suppliedKey !== EDIT_KEY) {
    res.status(403).json({ error: "Edit mode requires a valid edit key." });
    return;
  }

  next();
}

function addAudit(state, entry) {
  state.audit.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry
  });
  state.audit = state.audit.slice(0, 80);
}

const clients = new Set();

function broadcastState() {
  const payload = JSON.stringify(publicState());

  for (const client of clients) {
    client.write(`event: state\n`);
    client.write(`data: ${payload}\n\n`);
  }
}

app.use(express.json({ limit: "1mb" }));

app.get("/api/state", (req, res) => {
  res.json(publicState());
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  clients.add(res);
  res.write(`event: state\n`);
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);

  const keepAlive = setInterval(() => {
    res.write(`: keepalive\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
});

app.post("/api/projects", requireEdit, (req, res) => {
  const state = readState();
  const actor = cleanText(req.body.actor || "Editor", 80) || "Editor";
  const name = cleanText(req.body.name, 160);

  if (!name) {
    res.status(400).json({ error: "Project name is required." });
    return;
  }

  const timestamp = new Date().toISOString();
  const project = {
    id: makeProjectId(name, state.projects),
    name,
    status: "Not Started",
    owner: "",
    dueDate: "",
    notes: "",
    updates: [],
    lastUpdatedAt: timestamp,
    lastUpdatedBy: actor
  };

  state.projects.push(project);
  addAudit(state, {
    actor,
    type: "project-created",
    projectId: project.id,
    projectName: project.name,
    field: "project",
    oldValue: "",
    newValue: project.name,
    message: `${project.name}: project added.`
  });

  writeState(state);
  broadcastState();
  res.status(201).json(publicState(state));
});

app.patch("/api/projects/:id", requireEdit, (req, res) => {
  const state = readState();
  const project = state.projects.find((item) => item.id === req.params.id);

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  const actor = cleanText(req.body.actor || "Editor", 80) || "Editor";
  const allowedFields = {
    name: (value) => cleanText(value, 160) || project.name,
    status: (value) => {
      const nextValue = cleanText(value, 40);
      return STATUSES.includes(nextValue) ? nextValue : project.status;
    },
    owner: (value) => cleanText(value, 100),
    dueDate: (value) => {
      const nextValue = cleanText(value, 20);
      return /^\d{4}-\d{2}-\d{2}$/.test(nextValue) || nextValue === "" ? nextValue : project.dueDate;
    },
    notes: (value) => cleanText(value, 1200)
  };

  const changedFields = [];

  for (const [field, normalize] of Object.entries(allowedFields)) {
    if (!(field in req.body)) {
      continue;
    }

    const oldValue = project[field] || "";
    const newValue = normalize(req.body[field]);

    if (oldValue !== newValue) {
      project[field] = newValue;
      changedFields.push({ field, oldValue, newValue });
    }
  }

  if (changedFields.length > 0) {
    const timestamp = new Date().toISOString();
    project.lastUpdatedAt = timestamp;
    project.lastUpdatedBy = actor;

    for (const change of changedFields) {
      addAudit(state, {
        actor,
        type: "project",
        projectId: project.id,
        projectName: project.name,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        message: `${project.name}: ${change.field} updated.`
      });
    }

    writeState(state);
    broadcastState();
  }

  res.json(publicState(state));
});

app.post("/api/projects/:id/updates", requireEdit, (req, res) => {
  const state = readState();
  const project = state.projects.find((item) => item.id === req.params.id);

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  const actor = cleanText(req.body.actor || "Editor", 80) || "Editor";
  const lastUpdate = cleanText(req.body.lastUpdate, 1200);
  const nextTask = cleanText(req.body.nextTask, 1200);

  if (!lastUpdate && !nextTask) {
    res.status(400).json({ error: "Add a last update or next task before saving." });
    return;
  }

  const timestamp = new Date().toISOString();
  project.updates = Array.isArray(project.updates) ? project.updates : [];
  project.updates.unshift({
    id: crypto.randomUUID(),
    timestamp,
    actor,
    lastUpdate,
    nextTask
  });
  project.updates = project.updates.slice(0, 50);
  project.lastUpdatedAt = timestamp;
  project.lastUpdatedBy = actor;

  addAudit(state, {
    actor,
    type: "project-update",
    projectId: project.id,
    projectName: project.name,
    field: "update",
    oldValue: "",
    newValue: [lastUpdate, nextTask].filter(Boolean).join(" Next task: "),
    message: `${project.name}: update line added.`
  });

  writeState(state);
  broadcastState();
  res.status(201).json(publicState(state));
});

app.post("/api/comments", (req, res) => {
  const text = cleanText(req.body.text, 1600);

  if (!text) {
    res.status(400).json({ error: "Comment text is required." });
    return;
  }

  const state = readState();
  const actor = cleanText(req.body.actor || "Manager", 80) || "Manager";
  const timestamp = new Date().toISOString();

  state.comments.unshift({
    id: crypto.randomUUID(),
    timestamp,
    actor,
    text
  });
  state.comments = state.comments.slice(0, 60);

  addAudit(state, {
    actor,
    type: "comment",
    field: "manager comment",
    oldValue: "",
    newValue: text,
    message: "Manager comment added."
  });

  writeState(state);
  broadcastState();
  res.status(201).json(publicState(state));
});

const requestedMode = process.argv.includes("--dev") ? "development" : process.env.NODE_ENV;
const serveMode = requestedMode || (fs.existsSync(path.join(__dirname, "dist", "index.html")) ? "production" : "development");

if (serveMode === "production") {
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

app.listen(PORT, () => {
  const baseUrl = `http://localhost:${PORT}`;
  console.log(`Project dashboard running at ${baseUrl} in ${serveMode} mode`);
  console.log(`Manager view: ${baseUrl}/?view=manager`);
  console.log(`Edit mode: ${baseUrl}/?mode=edit&key=${EDIT_KEY}`);
});
