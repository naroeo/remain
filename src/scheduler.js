const {
  getTasks,
  getTask,
  updateTask,
  recordVisit
} = require("./database");

const {
  visit
} = require("./browser");

const {
  addLog
} = require("./logger");

let schedulerTimer = null;

let runningTasks = new Set();

const CHECK_INTERVAL = 5000;

/*
 * 判断任务是否应该执行
 */
function shouldRun(task) {

  if (!task) {
    return false;
  }

  if (!task.enabled) {
    return false;
  }

  const now =
    Date.now();

  /*
   * 没有 next_visit
   * 表示第一次运行
   */
  if (!task.next_visit) {
    return true;
  }

  const nextVisit =
    new Date(
      task.next_visit
    ).getTime();

  return now >= nextVisit;
}

/*
 * 执行单个任务
 */
async function runTask(task) {

  if (!task) {
    return;
  }

  /*
   * 防止同一个任务重复执行
   */
  if (
    runningTasks.has(task.id)
  ) {
    return;
  }

  runningTasks.add(
    task.id
  );

  addLog(
    `开始执行任务 #${task.id}`
  );

  try {

    const result =
      await visit(
        task.url,
        task.stay_seconds
      );

    if (result.success) {

      recordVisit(
        task.id,
        "success"
      );

      /*
       * 不在日志中显示 URL
       */
      addLog(
        `任务 #${task.id} 执行完成`
      );

    } else {

      recordVisit(
        task.id,
        "failed"
      );

      /*
       * 不在日志中显示 URL
       */
      addLog(
        `任务 #${task.id} 执行失败`,
        "error"
      );

    }

  } catch (error) {

    console.error(
      "[Scheduler]",
      error
    );

    try {

      recordVisit(
        task.id,
        "failed"
      );

    } catch (recordError) {

      console.error(
        "[Scheduler] Failed to record visit:",
        recordError
      );

    }

    addLog(
      `任务 #${task.id} 出现错误：${error.message}`,
      "error"
    );

  } finally {

    runningTasks.delete(
      task.id
    );

  }
}

/*
 * 检查所有任务
 */
async function checkTasks() {

  let tasks;

  try {

    tasks =
      getTasks();

  } catch (error) {

    console.error(
      "[Scheduler] Failed to load tasks:",
      error
    );

    addLog(
      `读取任务失败：${error.message}`,
      "error"
    );

    return;
  }

  for (const task of tasks) {

    if (
      shouldRun(task)
    ) {

      /*
       * 不 await
       * 避免一个任务阻塞其他任务
       */
      runTask(task);

    }

  }
}

/*
 * 启动 Scheduler
 */
function startScheduler() {

  if (schedulerTimer) {
    return;
  }

  addLog(
    "Scheduler 已启动"
  );

  /*
   * 启动后立即检查一次
   */
  checkTasks();

  /*
   * 每 5 秒检查一次任务
   *
   * 注意：
   * 这里的 5 秒不是用户设置的访问间隔。
   *
   * 用户设置的：
   * 5 分钟 / 10 分钟 / 30 分钟
   *
   * 仍然由 task.interval_minutes 控制。
   */
  schedulerTimer =
    setInterval(
      checkTasks,
      CHECK_INTERVAL
    );
}

/*
 * 停止 Scheduler
 */
function stopScheduler() {

  if (!schedulerTimer) {
    return;
  }

  clearInterval(
    schedulerTimer
  );

  schedulerTimer = null;

  addLog(
    "Scheduler 已停止"
  );
}

module.exports = {
  startScheduler,
  stopScheduler
};
