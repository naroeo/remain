const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");


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
 * rclone 云盘备份配置
 * ============================
 *
 * 示例：
 *
 * RCLONE_REMOTE=onedrive
 * RCLONE_BACKUP_PATH=Remain/app.db
 *
 * 实际云盘认证信息通过
 * rclone 的环境变量配置。
 *
 * 如果没有配置 RCLONE_REMOTE，
 * 则不启用云盘恢复 / 备份。
 * ============================
 */

const rcloneRemote =
  process.env.RCLONE_REMOTE ||
  "";

const rcloneBackupPath =
  process.env.RCLONE_BACKUP_PATH ||
  "Remain/app.db";


/*
 * ============================
 * 检查 rclone 是否可用
 * ============================
 */

function isRcloneAvailable() {

  if (!rcloneRemote) {
    return false;
  }


  try {

    const result =
      spawnSync(
        "rclone",
        [
          "version"
        ],
        {
          stdio: "ignore"
        }
      );


    return (
      result.status === 0
    );

  } catch (error) {

    return false;

  }

}


/*
 * ============================
 * 云盘路径
 * ============================
 */

function getRemotePath() {

  return (
    `${rcloneRemote}:${rcloneBackupPath}`
  );

}


/*
 * ============================
 * 启动时从云盘恢复
 * ============================
 *
 * 只有本地数据库不存在时
 * 才进行恢复。
 *
 * 这样可以避免：
 *
 * 本地已经有最新数据库
 * ↓
 * 被云盘旧备份覆盖。
 * ============================
 */

function restoreDatabase() {

  if (
    fs.existsSync(
      dbPath
    )
  ) {

    console.log(
      "[Database] 本地数据库已存在，跳过云盘恢复"
    );

    return;

  }


  if (!rcloneRemote) {

    console.log(
      "[Database] 未配置 rclone，使用新的本地数据库"
    );

    return;

  }


  if (
    !isRcloneAvailable()
  ) {

    console.log(
      "[Database] rclone 不可用，使用新的本地数据库"
    );

    return;

  }


  const tempPath =
    `${dbPath}.restore`;


  try {

    if (
      fs.existsSync(
        tempPath
      )
    ) {

      fs.unlinkSync(
        tempPath
      );

    }


    console.log(
      "[Database] 正在检查云盘数据库备份..."
    );


    const result =
      spawnSync(
        "rclone",
        [
          "copyto",
          getRemotePath(),
          tempPath
        ],
        {
          stdio: [
            "ignore",
            "ignore",
            "pipe"
          ]
        }
      );


    if (
      result.status !== 0
    ) {

      if (
        fs.existsSync(
          tempPath
        )
      ) {

        fs.unlinkSync(
          tempPath
        );

      }


      console.log(
        "[Database] 云盘没有可用数据库备份，使用新的本地数据库"
      );

      return;

    }


    if (
      !fs.existsSync(
        tempPath
      )
    ) {

      console.log(
        "[Database] 未找到云盘数据库备份，使用新的本地数据库"
      );

      return;

    }


    /*
     * 简单检查数据库文件
     * 是否确实可以被 SQLite 打开。
     */

    let testDb = null;


    try {

      testDb =
        new Database(
          tempPath,
          {
            readonly: true
          }
        );


      testDb
        .prepare(
          "SELECT name FROM sqlite_master LIMIT 1"
        )
        .get();


      testDb.close();
      testDb = null;

    } catch (error) {

      if (testDb) {

        try {
          testDb.close();
        } catch {}

      }


      fs.unlinkSync(
        tempPath
      );


      console.log(
        "[Database] 云盘数据库无效，使用新的本地数据库"
      );

      return;

    }


    fs.renameSync(
      tempPath,
      dbPath
    );


    console.log(
      "[Database] 云盘数据库恢复完成"
    );

  } catch (error) {

    try {

      if (
        fs.existsSync(
          tempPath
        )
      ) {

        fs.unlinkSync(
          tempPath
        );

      }

    } catch {}


    console.log(
      "[Database] 云盘恢复失败，使用本地数据库"
    );

  }

}


/*
 * ============================
 * 启动时恢复数据库
 * ============================
 *
 * 必须发生在 new Database()
 * 之前。
 * ============================
 */

restoreDatabase();


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
 * 云盘备份
 * ============================
 *
 * 每 6 小时执行一次。
 *
 * 不在创建 / 编辑 / 删除任务时
 * 触发备份。
 * ============================
 */

const BACKUP_INTERVAL =
  6 * 60 * 60 * 1000;


let backupRunning =
  false;


async function backupDatabase() {

  if (backupRunning) {

    return;

  }


  if (!rcloneRemote) {

    return;

  }


  if (
    !isRcloneAvailable()
  ) {

    console.log(
      "[Database] rclone 不可用，跳过本次云盘备份"
    );

    return;

  }


  backupRunning =
    true;


  const backupPath =
    path.join(
      dataDir,
      "app-backup.sqlite"
    );


  try {

    /*
     * 使用 SQLite 官方 backup API
     * 创建一致性的数据库副本。
     *
     * 不直接复制正在运行的
     * app.db。
     */

    if (
      fs.existsSync(
        backupPath
      )
    ) {

      fs.unlinkSync(
        backupPath
      );

    }


    console.log(
      "[Database] 开始创建云盘备份..."
    );


    await db.backup(
      backupPath
    );


    if (
      !fs.existsSync(
        backupPath
      )
    ) {

      throw new Error(
        "backup file was not created"
      );

    }


    const result =
      spawnSync(
        "rclone",
        [
          "copyto",
          backupPath,
          getRemotePath()
        ],
        {
          stdio: [
            "ignore",
            "ignore",
            "pipe"
          ]
        }
      );


    if (
      result.status !== 0
    ) {

      throw new Error(
        "rclone upload failed"
      );

    }


    console.log(
      "[Database] 云盘备份完成"
    );

  } catch (error) {

    console.log(
      "[Database] 云盘备份失败"
    );

  } finally {

    try {

      if (
        fs.existsSync(
          backupPath
        )
      ) {

        fs.unlinkSync(
          backupPath
        );

      }

    } catch {}


    backupRunning =
      false;

  }

}


/*
 * ============================
 * 每 6 小时备份一次
 * ============================
 */

if (
  rcloneRemote
) {

  setInterval(
    () => {

      backupDatabase();

    },
    BACKUP_INTERVAL
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
