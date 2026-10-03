const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dataDir = process.env.DATA_DIR || "/tmp/remain-data";
const dbPath = path.join(dataDir, "app.db");

const backupPath = path.join(dataDir, "app-backup.sqlite");
const restoreDir = path.join(dataDir, "restore");
const rcloneConfigPath = path.join(dataDir, "rclone.conf");

const remoteFolder = (process.env.REMOTE_FOLDER || "").replace(/\/+$/, "");
const rcloneConf = process.env.RCLONE_CONF || "";

const BACKUP_INTERVAL = 3 * 60 * 60 * 1000;

let db = null;
let backupRunning = false;


/* =========================================================
   数据库同步状态
   ========================================================= */

let lastSyncAt = null;
let lastSyncResult = null;

let nextSyncAt =
  Date.now() + BACKUP_INTERVAL;


/* =========================================================
   基础目录
   ========================================================= */

fs.mkdirSync(dataDir, { recursive: true });


/* =========================================================
   rclone 配置
   RCLONE_CONF 是完整配置内容
   ========================================================= */

function prepareRcloneConfig() {
  if (!rcloneConf.trim()) {
    return false;
  }

  fs.writeFileSync(
    rcloneConfigPath,
    rcloneConf,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );

  return true;
}


/* =========================================================
   删除文件 / 目录
   ========================================================= */

function removeFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, {
        recursive: true,
        force: true
      });
    }
  } catch (error) {
    console.error(
      `[Database] 删除文件失败：${filePath}`,
      error.message
    );
  }
}


/* =========================================================
   从云端恢复数据库
   ========================================================= */

function restoreDatabase() {
  console.log("[Database] 正在从云端恢复数据库...");

  if (!remoteFolder) {
    console.log("[Database] 未配置 REMOTE_FOLDER");
    return false;
  }

  if (!rcloneConf.trim()) {
    console.log("[Database] 未配置 RCLONE_CONF");
    return false;
  }

  try {
    prepareRcloneConfig();

    // 清理上一次可能残留的恢复目录
    removeFile(restoreDir);

    fs.mkdirSync(restoreDir, {
      recursive: true
    });

    /*
     * 标准 rclone copy：
     *
     * 云端：
     * huggingface:like/
     *
     * ↓
     *
     * 本地：
     * /tmp/remain-data/restore/
     *
     * 最终得到：
     * /tmp/remain-data/restore/app-backup.sqlite
     */
    execFileSync(
      "rclone",
      [
        "--config",
        rcloneConfigPath,
        "copy",
        remoteFolder,
        restoreDir
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const restoredBackupPath = path.join(
      restoreDir,
      "app-backup.sqlite"
    );

    if (!fs.existsSync(restoredBackupPath)) {
      console.log("[Database] 云端没有可用数据库备份");
      removeFile(restoreDir);
      return false;
    }

    /*
     * 先删除当前数据库。
     * 正常情况下启动时这里还不存在。
     */
    removeFile(dbPath);

    // 将恢复出来的数据库变成正式 app.db
    fs.renameSync(
      restoredBackupPath,
      dbPath
    );

    removeFile(restoreDir);

    console.log("[Database] 云端数据库恢复完成");

    return true;

  } catch (error) {
    console.error(
      "[Database] 云端数据库恢复失败，创建新数据库"
    );

    if (error.stderr) {
      console.error(
        `[Database] rclone：${error.stderr.toString().trim()}`
      );
    } else if (error.message) {
      console.error(
        `[Database] ${error.message}`
      );
    }

    removeFile(restoreDir);

    return false;
  }
}


/* =========================================================
   初始化数据库
   ========================================================= */

function initializeDatabase() {
  console.log(`[Database] ${dbPath}`);

  /*
   * 非常重要：
   * 必须先恢复，再打开 SQLite。
   * 避免 Render 启动时出现 db 尚未初始化的问题。
   */
  restoreDatabase();

  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      stay_seconds INTEGER NOT NULL DEFAULT 40,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_visit TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  /*
   * 兼容旧数据库：
   * 如果之前的数据库缺少某些字段，就补上。
   */

  const columns = db
    .prepare("PRAGMA table_info(tasks)")
    .all()
    .map(row => row.name);

  if (!columns.includes("stay_seconds")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN stay_seconds INTEGER NOT NULL DEFAULT 40
    `);
  }

  if (!columns.includes("interval_minutes")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 60
    `);
  }

  if (!columns.includes("enabled")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1
    `);
  }

  if (!columns.includes("visit_count")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (!columns.includes("last_visit")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN last_visit TEXT
    `);
  }

  if (!columns.includes("last_status")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN last_status TEXT
    `);
  }

  if (!columns.includes("created_at")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN created_at TEXT
    `);
  }

  console.log("[Database] SQLite 初始化完成");

  return db;
}


/* =========================================================
   数据库备份 / 同步
   ========================================================= */

async function backupDatabase() {
  if (backupRunning) {
    console.log("[Database] 上一次备份还未完成，跳过本次备份");
    return;
  }

  if (!db) {
    console.log("[Database] 数据库尚未初始化，跳过备份");

    lastSyncAt = new Date().toISOString();
    lastSyncResult = "error: 数据库尚未初始化";

    return;
  }

  if (!remoteFolder) {
    console.log("[Database] 未配置 REMOTE_FOLDER，跳过备份");

    lastSyncAt = new Date().toISOString();
    lastSyncResult = "error: 未配置 REMOTE_FOLDER";

    return;
  }

  if (!rcloneConf.trim()) {
    console.log("[Database] 未配置 RCLONE_CONF，跳过备份");

    lastSyncAt = new Date().toISOString();
    lastSyncResult = "error: 未配置 RCLONE_CONF";

    return;
  }

  backupRunning = true;

  try {
    console.log("[Database] 开始数据库备份");

    prepareRcloneConfig();

    /*
     * 使用 SQLite 官方 backup API 创建临时备份。
     *
     * 本地：
     * /tmp/remain-data/app-backup.sqlite
     */
    removeFile(backupPath);

    await db.backup(backupPath);

    if (!fs.existsSync(backupPath)) {
      throw new Error("数据库备份文件未生成");
    }

    console.log("[Database] 本地备份文件生成完成");

    /*
     * 标准 rclone copy：
     *
     * /tmp/remain-data/app-backup.sqlite
     *              ↓
     * huggingface:like/
     *
     * 云端最终：
     * huggingface:like/app-backup.sqlite
     */
    execFileSync(
      "rclone",
      [
        "--config",
        rcloneConfigPath,
        "copy",
        backupPath,
        remoteFolder
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    console.log("[Database] 数据库已上传到云端");

    /*
     * 记录本次同步成功。
     */
    lastSyncAt = new Date().toISOString();
    lastSyncResult = "success";

  } catch (error) {
    console.error(
      "[Database] 数据库备份失败：",
      error.message
    );

    let reason =
      error.message ||
      "未知错误";

    if (error.stderr) {
      const stderr =
        error.stderr
          .toString()
          .trim();

      if (stderr) {
        reason = stderr;
      }
    }

    /*
     * 记录本次同步失败。
     */
    lastSyncAt = new Date().toISOString();
    lastSyncResult =
      `error: ${reason}`;

    if (error.stderr) {
      console.error(
        `[Database] rclone：${error.stderr.toString().trim()}`
      );
    }

  } finally {
    /*
     * 无论成功还是失败，
     * 都删除临时数据库备份文件。
     */
    removeFile(backupPath);

    backupRunning = false;

    console.log("[Database] 本地临时备份已清理");
  }
}


/* =========================================================
   获取数据库同步状态
   ========================================================= */

function getDatabaseSyncStatus() {
  return {
    interval_minutes: 180,

    last_sync:
      lastSyncAt,

    next_sync:
      new Date(
        nextSyncAt
      ).toISOString(),

    result:
      lastSyncResult
  };
}


/* =========================================================
   每 3 小时自动备份
   ========================================================= */

function startDatabaseBackupScheduler() {
  setInterval(() => {

    /*
     * 本次定时同步开始后，
     * 下一次同步时间继续顺延 3 小时。
     */
    nextSyncAt =
      Date.now() + BACKUP_INTERVAL;

    backupDatabase().catch(error => {

      console.error(
        "[Database] 自动备份异常：",
        error.message
      );

      lastSyncAt =
        new Date().toISOString();

      lastSyncResult =
        `error: ${error.message || "未知错误"}`;

    });

  }, BACKUP_INTERVAL);

  console.log("[Database] 数据库自动备份已启动：每 3 小时一次");
}


/* =========================================================
   初始化
   ========================================================= */

initializeDatabase();

startDatabaseBackupScheduler();


/* =========================================================
   Tasks API
   ========================================================= */

function getTasks() {
  return db
    .prepare(`
      SELECT
        id,
        name,
        url,
        stay_seconds,
        interval_minutes,
        enabled,
        visit_count,
        last_visit,
        last_status,
        created_at
      FROM tasks
      ORDER BY id ASC
    `)
    .all();
}


function getTask(id) {
  return db
    .prepare(`
      SELECT
        id,
        name,
        url,
        stay_seconds,
        interval_minutes,
        enabled,
        visit_count,
        last_visit,
        last_status,
        created_at
      FROM tasks
      WHERE id = ?
    `)
    .get(id);
}


function createTask({
  name,
  url,
  stay_seconds = 40,
  interval_minutes = 60,
  enabled = 1
}) {
  const result = db
    .prepare(`
      INSERT INTO tasks (
        name,
        url,
        stay_seconds,
        interval_minutes,
        enabled
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      name,
      url,
      Number(stay_seconds),
      Number(interval_minutes),
      enabled ? 1 : 0
    );

  return getTask(result.lastInsertRowid);
}


function updateTask(
  id,
  {
    name,
    url,
    stay_seconds,
    interval_minutes,
    enabled
  }
) {
  const oldTask = getTask(id);

  if (!oldTask) {
    return null;
  }

  const newName =
    name !== undefined
      ? name
      : oldTask.name;

  const newUrl =
    url !== undefined
      ? url
      : oldTask.url;

  const newStaySeconds =
    stay_seconds !== undefined
      ? Number(stay_seconds)
      : oldTask.stay_seconds;

  const newIntervalMinutes =
    interval_minutes !== undefined
      ? Number(interval_minutes)
      : oldTask.interval_minutes;

  const newEnabled =
    enabled !== undefined
      ? (enabled ? 1 : 0)
      : oldTask.enabled;

  db
    .prepare(`
      UPDATE tasks
      SET
        name = ?,
        url = ?,
        stay_seconds = ?,
        interval_minutes = ?,
        enabled = ?
      WHERE id = ?
    `)
    .run(
      newName,
      newUrl,
      newStaySeconds,
      newIntervalMinutes,
      newEnabled,
      id
    );

  return getTask(id);
}


function deleteTask(id) {
  const result = db
    .prepare(`
      DELETE FROM tasks
      WHERE id = ?
    `)
    .run(id);

  return result.changes > 0;
}


function recordVisit(id, status = "success") {
  db
    .prepare(`
      UPDATE tasks
      SET
        visit_count = visit_count + 1,
        last_visit = ?,
        last_status = ?
      WHERE id = ?
    `)
    .run(
      new Date().toISOString(),
      status || "success",
      id
    );
}


/* =========================================================
   导出
   ========================================================= */

module.exports = {
  db,
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  recordVisit,
  backupDatabase,
  getDatabaseSyncStatus
};
