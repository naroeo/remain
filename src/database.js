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


/*
 * ============================
 * 创建任务表
 * ============================
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
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


/*
 * ============================
 * 数据库升级
 * ============================
 *
 * 如果 Render 上已经存在旧版 app.db，
 * 旧表里没有 name 字段，
 * 这里自动补上。
 *
 * 不会删除原来的任务。
 */

const columns = db
  .prepare("PRAGMA table_info(tasks)")
  .all();

const hasNameColumn =
  columns.some(
    column => column.name === "name"
  );

if (!hasNameColumn) {

  db.exec(`
    ALTER TABLE tasks
    ADD COLUMN name TEXT NOT NULL DEFAULT ''
  `);

  console.log(
    "[Database] 已添加 tasks.name 字段"
  );
}


/*
 * ============================
 * 获取任务
 * ============================
 */

function getTasks() {

  return db
    .prepare(
      "SELECT * FROM tasks ORDER BY id DESC"
    )
    .all();
}


/*
 * ============================
 * 获取单个任务
 * ============================
 */

function getTask(id) {

  return db
    .prepare(
      "SELECT * FROM tasks WHERE id = ?"
    )
    .get(id);
}


/*
 * ============================
 * 创建任务
 * ============================
 */

function createTask(
  name,
  url,
  intervalMinutes,
  staySeconds
) {

  const result = db
    .prepare(`
      INSERT INTO tasks (
        name,
        url,
        interval_minutes,
        stay_seconds,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      name,
      url,
      intervalMinutes,
      staySeconds,
      new Date().toISOString()
    );

  return getTask(
    result.lastInsertRowid
  );
}


/*
 * ============================
 * 更新任务
 * ============================
 */

function updateTask(
  id,
  fields
) {

  const task =
    getTask(id);

  if (!task) {
    return null;
  }


  const name =
    fields.name ??
    task.name ??
    "";

  const url =
    fields.url ??
    task.url;

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
      name = ?,
      url = ?,
      interval_minutes = ?,
      stay_seconds = ?,
      enabled = ?
    WHERE id = ?
  `).run(
    name,
    url,
    interval,
    stay,
    enabled,
    id
  );


  return getTask(id);
}


/*
 * ============================
 * 记录访问
 * ============================
 */

function recordVisit(
  id,
  status
) {

  const now =
    new Date();

  const task =
    getTask(id);

  if (!task) {
    return null;
  }


  const next =
    new Date(
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


/*
 * ============================
 * 删除任务
 * ============================
 */

function deleteTask(id) {

  db.prepare(
    "DELETE FROM tasks WHERE id = ?"
  ).run(id);
}


/*
 * ============================
 * Export
 * ============================
 */

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  recordVisit,
  deleteTask
};
