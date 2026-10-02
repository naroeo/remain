const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { spawnSync, execFile } = require("child_process");

const dataDir = process.env.DATA_DIR || "/tmp/remain-data";
const dbPath = path.join(dataDir, "app.db");
const tempBackupPath = path.join(dataDir, "app-backup.sqlite");

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

function getRcloneEnvironment() {
  if (!rcloneConf) {
    return null;
  }

  return {
    ...process.env,
    RCLONE_CONFIG: rcloneConf
  };
}

/*
 * 启动恢复必须同步完成。
 * 这样 server.js / scheduler.js 开始运行时，
 * SQLite 数据库一定已经初始化完成。
 */
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

  const restorePath = `${dbPath}.restore`;

  try {
    if (fs.existsSync(restorePath)) {
      fs.unlinkSync(restorePath);
    }

    console.log("[Database] 正在从云端恢复数据库...");

    const env = getRcloneEnvironment();

    const result = spawnSync(
      "rclone",
      [
        "copyto",
        remoteFolder,
        restorePath
      ],
      {
        env,
        stdio: "ignore"
      }
    );

    if (result.error || result.status !== 0) {
      console.log("[Database] 云端没有可用数据库备份");
      return false;
    }

    if (!fs.existsSync(restorePath)) {
      console.log("[Database] 云端没有可用数据库备份");
      return false;
    }

    // 验证恢复出来的文件确实是可用的 SQLite 数据库
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
    console.log("[Database] 云端数据库恢复失败，创建新数据库");
    return false;
  } finally {
    try {
      if (fs.existsSync(restorePath)) {
        fs.unlinkSync(restorePath);
      }
    } catch (error) {}
  }
}

function removeOldBackupFile() {
  try {
    if (fs.existsSync(tempBackupPath)) {
      fs.unlinkSync(tempBackupPath);
      console.log("[Database] 已清理旧的临时备份文件");
    }
  } catch (error) {
    console.log("[Database] 清理临时备份文件失败");
  }
}

function backupDatabase() {
  if (backupRunning) {
    return;
  }

  if (!remoteFolder) {
    return;
  }

  if (!rcloneConf) {
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

      const env = getRcloneEnvironment();

      await new Promise((resolve, reject) => {
        execFile(
          "rclone",
          [
            "copyto",
            tempBackupPath,
            remoteFolder
          ],
          {
            env,
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
      try {
        if (fs.existsSync(tempBackupPath)) {
          fs.unlinkSync(tempBackupPath);
        }

        console.log("[Database] 已删除本地临时备份");
      } catch (error) {
        console.log("[Database] 删除本地临时备份失败");
      }
    } catch (error) {
      console.log("[Database] 数据库备份失败");

      // 防止临时文件残留
      try {
        if (fs.existsSync(tempBackupPath)) {
          fs.unlinkSync(tempBackupPath);
        }
      } catch (cleanupError) {
        console.log("[Database] 清理临时备份失败");
      }
    } finally {
      backupRunning = false;
    }
  })();
}


/*
 * ============================
 * 数据库启动初始化
 * ============================
 *
 * 这里必须同步完成。
 */

removeOldBackupFile();

if (!fs.existsSync(dbPath)) {
  restoreDatabaseSync();
}


/*
 * 如果云端没有备份，
 * better-sqlite3 会在这里创建新的 app.db。
 */
const db = new Database(dbPath);

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
 * 兼容旧数据库。
 * 如果以前没有 name 字段，就自动添加。
 */
const columns = db.prepare("PRAGMA table_info(tasks)").all();

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
 * ============================
 * 每 6 小时自动备份
 * ============================
 */

let backupRunning = false;

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
    if (Object.prototype.hasOwnProperty.call(fields, field)) {
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
