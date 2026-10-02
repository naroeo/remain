const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");


/*
 * ============================
 * 数据目录
 * ============================
 */

const dataDir =
  process.env.DATA_DIR ||
  "/tmp/remain-data";


fs.mkdirSync(
  dataDir,
  {
    recursive: true
  }
);


const dbPath =
  path.join(
    dataDir,
    "app.db"
  );


console.log(
  `[Database] ${dbPath}`
);


/*
 * ============================
 * 打开数据库
 * ============================
 */

const db =
  new Database(
    dbPath
  );


db.pragma(
  "journal_mode = WAL"
);


/*
 * ============================
 * 创建任务表
 * ============================
 *
 * 如果数据库已经存在，
 * CREATE TABLE IF NOT EXISTS
 * 不会影响现有数据。
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
 * 兼容旧数据库
 * ============================
 *
 * 如果旧数据库没有 name 字段，
 * 自动添加。
 *
 * 不会删除旧字段，
 * 不会修改现有任务 ID。
 * ============================
 */

const columns =
  db
    .prepare(
      "PRAGMA table_info(tasks)"
    )
    .all();


const hasNameColumn =
  columns.some(
    column =>
      column.name === "name"
  );


if (
  !hasNameColumn
) {

  db.exec(
    `
      ALTER TABLE tasks
      ADD COLUMN name TEXT NOT NULL DEFAULT ''
    `
  );


  console.log(
    "[Database] 已添加 tasks.name 字段"
  );

}


/*
 * ============================
 * 获取所有任务
 * ============================
 */

function getTasks() {

  return db
    .prepare(
      `
        SELECT *
        FROM tasks
        ORDER BY id DESC
      `
    )
    .all();

}


/*
 * ============================
 * 获取单个任务
 * ============================
 */

function getTask(
  id
) {

  return db
    .prepare(
      `
        SELECT *
        FROM tasks
        WHERE id = ?
      `
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

  const result =
    db
      .prepare(
        `
          INSERT INTO tasks
          (
            name,
            url,
            interval_minutes,
            stay_seconds,
            created_at
          )
          VALUES
          (
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `
      )
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
 *
 * 未提供的字段继续使用
 * 数据库中原来的值。
 *
 * 特别注意：
 * enabled 只有在明确传入时
 * 才会改变。
 *
 * 所以编辑任务时不会因为
 * 修改名称 / URL / 间隔而
 * 自动改变运行状态。
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


  db
    .prepare(
      `
        UPDATE tasks
        SET
          name = ?,
          url = ?,
          interval_minutes = ?,
          stay_seconds = ?,
          enabled = ?
        WHERE id = ?
      `
    )
    .run(
      name,
      url,
      interval,
      stay,
      enabled,
      id
    );


  return getTask(
    id
  );

}


/*
 * ============================
 * 记录任务执行
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


  db
    .prepare(
      `
        UPDATE tasks
        SET
          visit_count =
            visit_count + 1,

          last_visit = ?,

          next_visit = ?,

          last_status = ?

        WHERE id = ?
      `
    )
    .run(
      now.toISOString(),
      next.toISOString(),
      status,
      id
    );


  return getTask(
    id
  );

}


/*
 * ============================
 * 删除任务
 * ============================
 */

function deleteTask(
  id
) {

  db
    .prepare(
      `
        DELETE FROM tasks
        WHERE id = ?
      `
    )
    .run(id);

}


/*
 * ============================
 * 导出
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
