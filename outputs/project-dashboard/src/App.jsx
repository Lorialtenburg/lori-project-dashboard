import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Filter,
  Lock,
  MessageSquare,
  PencilLine,
  Plus,
  RefreshCw,
  Send
} from "lucide-react";

const statusClass = {
  "Not Started": "status-not-started",
  "In Progress": "status-in-progress",
  "At Risk": "status-at-risk",
  Blocked: "status-blocked",
  Complete: "status-complete",
  Deferred: "status-deferred"
};

const fieldLabels = {
  name: "Project name",
  status: "Status",
  update: "Project update"
};

function getParams() {
  return new URLSearchParams(window.location.search);
}

function managerUrl() {
  return `${window.location.origin}${window.location.pathname}?view=manager`;
}

function displayDateTime(value) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) {
    return "Never";
  }

  const diffSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];

  for (const [unit, seconds] of units) {
    const amount = Math.trunc(diffSeconds / seconds);

    if (Math.abs(amount) >= 1) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(amount, unit);
    }
  }

  return "just now";
}

function normalizeAuditValue(value) {
  if (!value) {
    return "blank";
  }

  return String(value);
}

function displayActor(value) {
  return value === "Initial setup" ? "" : value;
}

function StatusChip({ status }) {
  return <span className={`status-chip ${statusClass[status] || ""}`}>{status}</span>;
}

function ConnectionStatus({ connected }) {
  return (
    <span className={`connection ${connected ? "is-live" : "is-offline"}`}>
      <span className="connection-dot" />
      {connected ? "Live" : "Reconnecting"}
    </span>
  );
}

function App() {
  const params = useMemo(getParams, []);
  const editKey = params.get("key") || params.get("editKey") || "";
  const isEditor = params.get("mode") === "edit" && editKey.length > 0;
  const [dashboard, setDashboard] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activeStatus, setActiveStatus] = useState("All");
  const [drafts, setDrafts] = useState({});
  const [updateDrafts, setUpdateDrafts] = useState({});
  const [expandedProjectIds, setExpandedProjectIds] = useState(new Set());
  const [dirtyFields, setDirtyFields] = useState(new Set());
  const [highlightedUpdateIds, setHighlightedUpdateIds] = useState(new Set());
  const [updateAlert, setUpdateAlert] = useState(null);
  const [actor, setActor] = useState(isEditor ? "Lori" : "Manager");
  const [newProjectName, setNewProjectName] = useState("");
  const [commentText, setCommentText] = useState("");
  const [notice, setNotice] = useState("");
  const hasSeenDashboard = useRef(false);
  const knownUpdateIds = useRef(new Set());
  const updateAlertTimeout = useRef(null);

  function collectProjectUpdates(data) {
    return (data?.projects || []).flatMap((project) =>
      (project.updates || []).map((update) => ({
        project,
        update
      }))
    );
  }

  function announceNewUpdates(newUpdates) {
    if (newUpdates.length === 0) {
      return;
    }

    const sortedUpdates = [...newUpdates].sort(
      (a, b) => new Date(b.update.timestamp).getTime() - new Date(a.update.timestamp).getTime()
    );
    const latest = sortedUpdates[0];
    const newIds = newUpdates.map(({ update }) => update.id);

    setHighlightedUpdateIds(new Set(newIds));
    setUpdateAlert({
      id: latest.update.id,
      projectName: latest.project.name,
      actor: latest.update.actor
    });

    if (updateAlertTimeout.current) {
      clearTimeout(updateAlertTimeout.current);
    }

    updateAlertTimeout.current = setTimeout(() => {
      setUpdateAlert(null);
      updateAlertTimeout.current = null;
    }, 7000);
  }

  function applyDashboardUpdate(data) {
    const updateItems = collectProjectUpdates(data);
    const nextUpdateIds = new Set(updateItems.map(({ update }) => update.id));

    if (!hasSeenDashboard.current) {
      knownUpdateIds.current = nextUpdateIds;
      hasSeenDashboard.current = true;
      setDashboard(data);
      return;
    }

    const newUpdates = updateItems.filter(({ update }) => !knownUpdateIds.current.has(update.id));
    knownUpdateIds.current = nextUpdateIds;
    announceNewUpdates(newUpdates);
    setDashboard(data);
  }

  useEffect(() => {
    let mounted = true;

    fetch("/api/state")
      .then((response) => response.json())
      .then((data) => {
        if (mounted) {
          applyDashboardUpdate(data);
        }
      })
      .catch(() => setNotice("Unable to load dashboard data."));

    const events = new EventSource("/api/events");
    events.addEventListener("state", (event) => {
      applyDashboardUpdate(JSON.parse(event.data));
      setConnected(true);
    });
    events.onerror = () => {
      setConnected(false);
    };

    return () => {
      mounted = false;
      events.close();
    };
  }, []);

  useEffect(
    () => () => {
      if (updateAlertTimeout.current) {
        clearTimeout(updateAlertTimeout.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!dashboard?.projects) {
      return;
    }

    setDrafts((currentDrafts) => {
      const nextDrafts = {};

      for (const project of dashboard.projects) {
        const previous = currentDrafts[project.id] || {};
        nextDrafts[project.id] = {
          name: dirtyFields.has(`${project.id}:name`) ? previous.name : project.name,
          status: dirtyFields.has(`${project.id}:status`) ? previous.status : project.status
        };
      }

      return nextDrafts;
    });
  }, [dashboard, dirtyFields]);

  const statuses = dashboard?.statuses || [];
  const filteredProjects = useMemo(() => {
    const projects = dashboard?.projects || [];

    if (activeStatus === "All") {
      return projects;
    }

    return projects.filter((project) => project.status === activeStatus);
  }, [activeStatus, dashboard]);

  const statusCounts = useMemo(() => {
    const counts = { All: dashboard?.projects?.length || 0 };

    for (const status of statuses) {
      counts[status] = dashboard?.projects?.filter((project) => project.status === status).length || 0;
    }

    return counts;
  }, [dashboard, statuses]);

  function markDirty(projectId, field) {
    setDirtyFields((current) => {
      const next = new Set(current);
      next.add(`${projectId}:${field}`);
      return next;
    });
  }

  function clearDirty(projectId, field) {
    setDirtyFields((current) => {
      const next = new Set(current);
      next.delete(`${projectId}:${field}`);
      return next;
    });
  }

  function updateDraft(projectId, field, value) {
    setDrafts((current) => ({
      ...current,
      [projectId]: {
        ...(current[projectId] || {}),
        [field]: value
      }
    }));
    markDirty(projectId, field);
  }

  function updateProjectUpdateDraft(projectId, field, value) {
    setUpdateDrafts((current) => ({
      ...current,
      [projectId]: {
        ...(current[projectId] || {}),
        [field]: value
      }
    }));
  }

  function toggleProjectUpdates(projectId) {
    setExpandedProjectIds((current) => {
      const next = new Set(current);

      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }

      return next;
    });
  }

  function expandProjectUpdates(projectId) {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }

  async function patchProject(projectId, updates) {
    if (!isEditor) {
      return;
    }

    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-edit-key": editKey
      },
      body: JSON.stringify({ ...updates, actor })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Unable to save change.");
    }

    applyDashboardUpdate(await response.json());
  }

  async function commitField(project, field) {
    if (!isEditor) {
      return;
    }

    const value = drafts[project.id]?.[field] ?? "";

    if ((project[field] || "") === value) {
      clearDirty(project.id, field);
      return;
    }

    try {
      await patchProject(project.id, { [field]: value });
      clearDirty(project.id, field);
      setNotice(`${fieldLabels[field]} saved.`);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function changeStatus(project, status) {
    updateDraft(project.id, "status", status);

    try {
      await patchProject(project.id, { status });
      clearDirty(project.id, "status");
      setNotice("Status saved.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function submitNewProject(event) {
    event.preventDefault();

    if (!isEditor) {
      return;
    }

    const name = newProjectName.trim();

    if (!name) {
      setNotice("Project name is required.");
      return;
    }

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-edit-key": editKey
        },
        body: JSON.stringify({ actor, name })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Unable to add project.");
      }

      applyDashboardUpdate(await response.json());
      setNewProjectName("");
      setNotice("Project added.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function submitProjectUpdate(event, project) {
    event.preventDefault();

    if (!isEditor) {
      return;
    }

    const draft = updateDrafts[project.id] || {};
    const lastUpdate = "";
    const nextTask = (draft.nextTask || "").trim();

    if (!lastUpdate && !nextTask) {
      setNotice("Add a last update or next task before saving.");
      return;
    }

    try {
      const response = await fetch(`/api/projects/${project.id}/updates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-edit-key": editKey
        },
        body: JSON.stringify({ actor, lastUpdate, nextTask })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Unable to add update line.");
      }

      applyDashboardUpdate(await response.json());
      expandProjectUpdates(project.id);
      setUpdateDrafts((current) => ({
        ...current,
        [project.id]: {
          nextTask: ""
        }
      }));
      setNotice("Update line added.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function submitComment(event) {
    event.preventDefault();
    const text = commentText.trim();

    if (!text) {
      return;
    }

    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, text })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Unable to add comment.");
      }

      applyDashboardUpdate(await response.json());
      setCommentText("");
      setNotice("Comment added.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function copyManagerLink() {
    await navigator.clipboard.writeText(managerUrl());
    setNotice("Manager link copied.");
  }

  if (!dashboard) {
    return (
      <main className="loading">
        <RefreshCw className="spin" size={22} aria-hidden="true" />
        Loading dashboard
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="dashboard-header">
        <div className="dashboard-image-wrap">
          <img src="/assets/dashboard-illustration.svg" alt="Project dashboard illustration" />
        </div>
        <div className="topbar dashboard-title-bar">
          <div>
            <p className="eyebrow">Shared Manager Review</p>
            <h1>Lori Project Dashboard</h1>
          </div>
          <div className="top-actions">
            <ConnectionStatus connected={connected} />
            <span className={`mode-badge ${isEditor ? "mode-edit" : "mode-read"}`}>
              {isEditor ? <PencilLine size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}
              {isEditor ? "Edit Mode" : "Manager View"}
            </span>
            {isEditor && (
              <button className="icon-button" type="button" onClick={copyManagerLink} title="Copy manager link">
                <Clipboard size={16} aria-hidden="true" />
                Manager Link
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="toolbar" aria-label="Dashboard filters">
        <div className="filter-label">
          <Filter size={16} aria-hidden="true" />
          Status
        </div>
        <div className="filter-tabs">
          {["All", ...statuses].map((status) => (
            <button
              type="button"
              key={status}
              className={activeStatus === status ? "is-active" : ""}
              onClick={() => setActiveStatus(status)}
            >
              {status}
              <span>{statusCounts[status] || 0}</span>
            </button>
          ))}
        </div>
      </section>

      {isEditor && (
        <form className="add-project-form" onSubmit={submitNewProject}>
          <input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="Add a new project"
            aria-label="New project name"
          />
          <button className="primary-button" type="submit" disabled={!newProjectName.trim()}>
            <Plus size={16} aria-hidden="true" />
            Add Project
          </button>
        </form>
      )}

      {notice && (
        <div className="notice" role="status">
          <Check size={16} aria-hidden="true" />
          {notice}
        </div>
      )}

      {updateAlert && (
        <div className="update-alert" role="status">
          <Bell size={17} aria-hidden="true" />
          <div>
            <strong>New update added</strong>
            <span>
              {updateAlert.projectName}
              {updateAlert.actor ? ` by ${updateAlert.actor}` : ""}
            </span>
          </div>
        </div>
      )}

      <section className="table-panel" aria-label="Projects">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Updates</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((project) => {
              const draft = drafts[project.id] || project;
              const isUpdatesExpanded = expandedProjectIds.has(project.id);
              const updateCount = project.updates?.length || 0;
              const updatesPanelId = `updates-${project.id}`;

              return (
                <tr
                  className={
                    project.updates?.some((update) => highlightedUpdateIds.has(update.id)) ? "has-new-update" : ""
                  }
                  key={project.id}
                >
                  <td data-label="Project">
                    {isEditor ? (
                      <input
                        className="project-name-input"
                        value={draft.name || ""}
                        onChange={(event) => updateDraft(project.id, "name", event.target.value)}
                        onBlur={() => commitField(project, "name")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                        aria-label={`${project.name} project name`}
                      />
                    ) : (
                      <strong>{project.name}</strong>
                    )}
                  </td>
                  <td data-label="Status">
                    {isEditor ? (
                      <select
                        className={`status-select ${statusClass[draft.status] || ""}`}
                        value={draft.status}
                        onChange={(event) => changeStatus(project, event.target.value)}
                      >
                        {statuses.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusChip status={project.status} />
                    )}
                  </td>
                  <td data-label="Updates" className="updates-cell">
                    <div className="updates-toolbar">
                      <button
                        type="button"
                        className="updates-toggle"
                        aria-expanded={isUpdatesExpanded}
                        aria-controls={updatesPanelId}
                        onClick={() => toggleProjectUpdates(project.id)}
                      >
                        {isUpdatesExpanded ? (
                          <ChevronDown size={15} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={15} aria-hidden="true" />
                        )}
                        <span>{isUpdatesExpanded ? "Hide updates" : "Show updates"}</span>
                        <small>{updateCount}</small>
                      </button>
                      {project.lastUpdatedAt && (
                        <span className="updates-summary">Latest {relativeTime(project.lastUpdatedAt)}</span>
                      )}
                    </div>
                    {isUpdatesExpanded && (
                      <div className="updates-collapse" id={updatesPanelId}>
                        <div className="project-updates">
                          {project.updates?.length ? (
                            project.updates.map((update) => (
                              <article
                                className={`project-update ${
                                  highlightedUpdateIds.has(update.id) ? "is-new-update" : ""
                                }`}
                                key={update.id}
                              >
                                <header>
                                  <time dateTime={update.timestamp}>{displayDateTime(update.timestamp)}</time>
                                </header>
                                {update.lastUpdate && (
                                  <p>
                                    <span>Last update</span>
                                    {update.lastUpdate}
                                  </p>
                                )}
                                {update.nextTask && (
                                  <p>
                                    <span>Next task</span>
                                    {update.nextTask}
                                  </p>
                                )}
                              </article>
                            ))
                          ) : (
                            <p className="empty-state">No updates yet.</p>
                          )}
                        </div>
                        {isEditor && (
                          <form className="project-update-form" onSubmit={(event) => submitProjectUpdate(event, project)}>
                            <textarea
                              value={updateDrafts[project.id]?.nextTask || ""}
                              onChange={(event) => updateProjectUpdateDraft(project.id, "nextTask", event.target.value)}
                              placeholder="Next task"
                              aria-label={`${project.name} next task`}
                            />
                            <button
                              className="secondary-button"
                              type="submit"
                              disabled={!updateDrafts[project.id]?.nextTask?.trim()}
                            >
                              <Plus size={15} aria-hidden="true" />
                              Add Update
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                  <td data-label="Last Updated">
                    <time dateTime={project.lastUpdatedAt} title={displayDateTime(project.lastUpdatedAt)}>
                      {relativeTime(project.lastUpdatedAt)}
                    </time>
                    {displayActor(project.lastUpdatedBy) && <small>{displayActor(project.lastUpdatedBy)}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="review-grid single-panel">
        <section className="review-panel" aria-label="Manager comments">
          <div className="panel-heading">
            <MessageSquare size={18} aria-hidden="true" />
            <h2>Manager Comments</h2>
          </div>
          <form className="comment-form" onSubmit={submitComment}>
            <input
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="Reviewer name"
              aria-label="Reviewer name"
            />
            <textarea
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder="Add a manager comment"
              aria-label="Manager comment"
            />
            <button className="primary-button" type="submit" disabled={!commentText.trim()}>
              <Send size={16} aria-hidden="true" />
              Add Comment
            </button>
          </form>
          <div className="comment-list">
            {dashboard.comments.length === 0 ? (
              <p className="empty-state">No manager comments yet.</p>
            ) : (
              dashboard.comments.map((comment) => (
                <article className="comment-item" key={comment.id}>
                  <p>{comment.text}</p>
                  <footer>
                    <strong>{comment.actor}</strong>
                    <time dateTime={comment.timestamp}>{displayDateTime(comment.timestamp)}</time>
                  </footer>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
