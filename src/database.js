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

function runRclone(args) {
  return new Promise((resolve, reject) => {
    const env = getRcloneEnvironment();

    if (!env) {
      reject(new Error("RCLONE_CONF 未配置"));
      return;
    }

    execFile(
      "rclone",
      args,
      {
        env,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          stdout,
          stderr
        });
      }
    );
  });
}

async function restoreDatabase() {
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

    await runRclone([
      "copyto",
      remoteFolder,
      restorePath
    ]);

    if (!fs.existsSync(restorePath)) {
      console.log("[Database] 云端没有可用数据库备份");
      return false;
    }

    // 验证 SQLite 文件是否正常
    let testDb = null;

    try {
      testDb = new Database(restorePath, {
        readonly: true
      });

      testDb.prepare(
        "SELECT name FROM sqlite_master LIMIT 1"
      ).get();
    } finally {
      if (testDb) {
        testDb.close();
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
    } catch (error) {
      console.log("[Database] 清理恢复临时文件失败");
    }
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

async function backupDatabase() {
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

  try {
    removeOldBackupFile();

    console.log("[Database] 开始备份数据库");

    await db.backup(tempBackupPath);

    if (!fs.existsSync(tempBackupPath)) {
      throw new Error("数据库备份文件未生成");
    }

    await runRclone([
      "copyto",
      tempBackupPath,
      remoteFolder
    ]);

    console.log("[Database] 数据库备份成功");

    // 上传成功后立即删除本地临时备份
    try {
      fs.unlinkSync(tempBackupPath);
      console.log("[Database] 已删除本地临时备份");
    } catch (error) {
      console.log("[Database] 删除本地临时备份失败");
    }
  } catch (error) {
    console.log("[Database] 数据库备份失败");

    // 无论上传成功还是失败，都不要长期保留临时文件
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
}

async function initializeDatabase() {
  removeOldBackupFile();

  if (!fs.existsSync(dbPath)) {
    await restoreDatabase();
  }
}

let db;
let backupRunning = false;

function initialize() {
  return initializeDatabase();
}

async function setupDatabase() {
  await initialize();

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

  // 每 6 小时备份一次
  setInterval(() => {
    backupDatabase().catch(() => {});
  }, 6 * 60 * 60 * 1000);

  return db;
}

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

setupDatabase().catch(error => {
  console.error("[Database] 数据库初始化失败");
  console.error(error);
  process.exit(1);
});

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  recordVisit,
  deleteTask
};
