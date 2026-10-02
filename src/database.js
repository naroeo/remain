const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dataDir =
  process.env.DATA_DIR ||
  "/tmp/remain-data";

fs.mkdirSync(dataDir, {
  recursive: true
});

const dbPath = path.join(
  dataDir,
  "app.db"
);

console.log(`[Database] ${dbPath}`);

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL DEFAULT 5,
    stay_seconds INTEGER NOT NULL DEFAULT 10,
    enabled INTEGER NOT NULL DEFAULT 0,
    visit_count INTEGER NOT NULL DEFAULT 0,
    last_visit TEXT,
    next_visit TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL
  )
`);

function getTasks() {
  return db
    .prepare(
      "SELECT * FROM tasks ORDER BY id DESC"
    )
    .all();
}

function getTask(id) {
  return db
    .prepare(
      "SELECT * FROM tasks WHERE id = ?"
    )
    .get(id);
}

function createTask(
  url,
  intervalMinutes,
  staySeconds
) {
  const result = db
    .prepare(`
      INSERT INTO tasks (
        url,
        interval_minutes,
        stay_seconds,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
    .run(
      url,
      intervalMinutes,
      staySeconds,
      new Date().toISOString()
    );

  return getTask(
    result.lastInsertRowid
  );
}

function updateTask(id, fields) {
  const task = getTask(id);

  if (!task) {
    return null;
  }

  const url =
    fields.url ?? task.url;

  const interval =
    fields.interval_minutes ??
    task.interval_minutes;

  const stay =
    fields.stay_seconds ??
    task.stay_seconds;

  const enabled =
    fields.enabled ??
    task.enabled;

  db.prepare(`
    UPDATE tasks
    SET
      url = ?,
      interval_minutes = ?,
      stay_seconds = ?,
      enabled = ?
    WHERE id = ?
  `).run(
    url,
    interval,
    stay,
    enabled,
    id
  );

  return getTask(id);
}

function recordVisit(id, status) {
  const now = new Date();

  const task = getTask(id);

  if (!task) {
    return null;
  }

  const next = new Date(
    now.getTime() +
    task.interval_minutes *
    60 *
    1000
  );

  db.prepare(`
    UPDATE tasks
    SET
      visit_count = visit_count + 1,
      last_visit = ?,
      next_visit = ?,
      last_status = ?
    WHERE id = ?
  `).run(
    now.toISOString(),
    next.toISOString(),
    status,
    id
  );

  return getTask(id);
}

function deleteTask(id) {
  db.prepare(
    "DELETE FROM tasks WHERE id = ?"
  ).run(id);
}

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  recordVisit,
  deleteTask
};
