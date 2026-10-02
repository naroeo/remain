const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync, execFile } = require("child_process");

const dataDir = process.env.DATA_DIR || "/tmp/remain-data";
const dbPath = path.join(dataDir, "app.db");
const tempBackupPath = path.join(dataDir, "app-backup.sqlite");
const rcloneConfigPath = path.join(dataDir, "rclone.conf");

const remoteFolder = process.env.REMOTE_FOLDER || "";
const rcloneConf = process.env.RCLONE_CONF || "";

fs.mkdirSync(dataDir, { recursive: true });

console.log(`[Database] ${dbPath}`);

function isRcloneAvailable() {
  try {
    const result = spawnSync("rclone", ["version"], {
      stdio: "ignore"
    });

    return result.status === 0;
  } catch (error) {
    return false;
  }
}

function prepareRcloneConfig() {
  if (!rcloneConf) {
    return false;
  }

  try {
    fs.writeFileSync(
      rcloneConfigPath,
      rcloneConf,
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    return true;
  } catch (error) {
    console.log("[Database] rclone 配置文件创建失败");
    return false;
  }
}

function getRemoteDatabasePath() {
  return `${remoteFolder.replace(/\/+$/, "")}/app.db`;
}

function removeFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {}
}

function restoreDatabaseSync() {
  if (fs.existsSync(dbPath)) {
    return false;
  }

  if (!remoteFolder) {
    console.log("[Database] 未配置 REMOTE_FOLDER，创建新数据库");
    return false;
  }

  if (!rcloneConf) {
    console.log("[Database] 未配置 RCLONE_CONF，创建新数据库");
    return false;
  }

  if (!isRcloneAvailable()) {
    console.log("[Database] rclone 不可用，创建新数据库");
    return false;
  }

  if (!prepareRcloneConfig()) {
    return false;
  }

  const restorePath = `${dbPath}.restore`;
  removeFile(restorePath);

  try {
    console.log("[Database] 正在从云端恢复数据库...");

    execFileSync(
      "rclone",
      [
        "--config",
        rcloneConfigPath,
        "copyto",
        getRemoteDatabasePath(),
        restorePath
      ],
      {
        stdio: "ignore"
      }
    );

    if (!fs.existsSync(restorePath)) {
      console.log("[Database] 云端没有可用数据库备份");
      return false;
    }

    let testDb = null;

    try {
      testDb = new Database(restorePath, {
        readonly: true
      });

      testDb
        .prepare("SELECT name FROM sqlite_master LIMIT 1")
        .get();
    } catch (error) {
      console.log("[Database] 云端数据库文件无效，创建新数据库");
      return false;
    } finally {
      if (testDb) {
        try {
          testDb.close();
        } catch (error) {}
      }
    }

    fs.renameSync(restorePath, dbPath);

    console.log("[Database] 数据库恢复成功");

    return true;
  } catch (error) {
    console.log("[Database] 云端没有可用数据库备份");
    return false;
  } finally {
    removeFile(restorePath);
  }
}

function removeOldBackupFile() {
  if (fs.existsSync(tempBackupPath)) {
    removeFile(tempBackupPath);
  }
}

let db;
let backupRunning = false;

function backupDatabase() {
  if (backupRunning) {
    return;
  }

  if (!remoteFolder || !rcloneConf) {
    return;
  }

  if (!isRcloneAvailable()) {
    console.log("[Database] rclone 不可用，跳过数据库备份");
    return;
  }

  backupRunning = true;

  (async () => {
    try {
      removeOldBackupFile();

      console.log("[Database] 开始备份数据库");

      await db.backup(tempBackupPath);

      if (!fs.existsSync(tempBackupPath)) {
        throw new Error("数据库备份文件未生成");
      }

      if (!prepareRcloneConfig()) {
        throw new Error("rclone 配置失败");
      }

      await new Promise((resolve, reject) => {
        execFile(
          "rclone",
          [
            "--config",
            rcloneConfigPath,
            "copyto",
            tempBackupPath,
            getRemoteDatabasePath()
          ],
          {
            windowsHide: true
          },
          error => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          }
        );
      });

      console.log("[Database] 数据库备份成功");

      // 上传成功后立即删除本地临时备份
      removeOldBackupFile();

      console.log("[Database] 已删除本地临时备份");
    } catch (error) {
      console.log("[Database] 数据库备份失败");

      // 即使失败，也不长期保留临时备份
      removeOldBackupFile();
    } finally {
      backupRunning = false;
    }
  })();
}


/*
 * ============================
 * 数据库启动
 * ============================
 */

removeOldBackupFile();

if (!fs.existsSync(dbPath)) {
  restoreDatabaseSync();
}


/*
 * 云端没有备份时，
 * better-sqlite3 会在这里创建新的 app.db。
 */

db = new Database(dbPath);

db.pragma("journal_mode = WAL");

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
 * 兼容旧数据库
 */

const columns = db
  .prepare("PRAGMA table_info(tasks)")
  .all();

const hasNameColumn = columns.some(
  column => column.name === "name"
);

if (!hasNameColumn) {
  db.exec(`
    ALTER TABLE tasks
    ADD COLUMN name TEXT NOT NULL DEFAULT ''
  `);

  console.log("[Database] 已添加 tasks.name 字段");
}


/*
 * 每 6 小时备份一次
 */

setInterval(() => {
  backupDatabase();
}, 6 * 60 * 60 * 1000);


/*
 * ============================
 * Tasks
 * ============================
 */

function getTasks() {
  return db.prepare(`
    SELECT
      id,
      name,
      url,
      interval_minutes,
      stay_seconds,
      enabled,
      visit_count,
      last_visit,
      next_visit,
      last_status,
      created_at
    FROM tasks
    ORDER BY id ASC
  `).all();
}

function getTask(id) {
  return db.prepare(`
    SELECT
      id,
      name,
      url,
      interval_minutes,
      stay_seconds,
      enabled,
      visit_count,
      last_visit,
      next_visit,
      last_status,
      created_at
    FROM tasks
    WHERE id = ?
  `).get(id);
}

function createTask(
  name,
  url,
  intervalMinutes,
  staySeconds
) {
  const createdAt = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO tasks (
      name,
      url,
      interval_minutes,
      stay_seconds,
      enabled,
      visit_count,
      last_visit,
      next_visit,
      last_status,
      created_at
    )
    VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, NULL, ?)
  `).run(
    name,
    url,
    intervalMinutes,
    staySeconds,
    createdAt
  );

  return getTask(result.lastInsertRowid);
}

function updateTask(id, fields) {
  const allowedFields = [
    "name",
    "url",
    "interval_minutes",
    "stay_seconds",
    "enabled"
  ];

  const updates = [];
  const values = [];

  for (const field of allowedFields) {
    if (
      Object.prototype.hasOwnProperty.call(
        fields,
        field
      )
    ) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  if (updates.length === 0) {
    return getTask(id);
  }

  values.push(id);

  db.prepare(`
    UPDATE tasks
    SET ${updates.join(", ")}
    WHERE id = ?
  `).run(...values);

  return getTask(id);
}

function recordVisit(id, status) {
  const now = new Date();
  const nowIso = now.toISOString();

  const task = getTask(id);

  if (!task) {
    return null;
  }

  const nextVisit = new Date(
    now.getTime() +
    task.interval_minutes * 60 * 1000
  ).toISOString();

  db.prepare(`
    UPDATE tasks
    SET
      visit_count = visit_count + 1,
      last_visit = ?,
      next_visit = ?,
      last_status = ?
    WHERE id = ?
  `).run(
    nowIso,
    nextVisit,
    status,
    id
  );

  return getTask(id);
}

function deleteTask(id) {
  return db.prepare(`
    DELETE FROM tasks
    WHERE id = ?
  `).run(id);
}

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  recordVisit,
  deleteTask
};
