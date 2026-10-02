const {
  getTasks,
  getTask,
  recordVisit
} = require("./database");

const {
  visit
} = require("./browser");

const {
  addLog
} = require("./logger");


/*
 * ============================
 * Scheduler
 * ============================
 */

let schedulerTimer = null;

const runningTasks =
  new Set();

const CHECK_INTERVAL =
  5000;


/*
 * ============================
 * 判断任务是否应该执行
 * ============================
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
   * 第一次启动任务：
   * 没有 next_visit 时立即执行。
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
 * ============================
 * 获取错误原因
 * ============================
 */

function getErrorReason(
  result
) {

  if (!result) {
    return "未知错误";
  }


  /*
   * browser.js 当前会返回：
   *
   * {
   *   success: false,
   *   error: error.message
   * }
   *
   * 所以优先使用 error。
   */

  if (
    typeof result.error ===
    "string" &&
    result.error.trim()
  ) {

    return result.error.trim();
  }


  if (
    typeof result.message ===
    "string" &&
    result.message.trim()
  ) {

    return result.message.trim();
  }


  if (
    typeof result.reason ===
    "string" &&
    result.reason.trim()
  ) {

    return result.reason.trim();
  }


  return "未知错误";
}


/*
 * ============================
 * 执行任务
 * ============================
 */

async function runTask(
  task
) {

  if (!task) {
    return;
  }


  /*
   * 防止同一个任务重复执行。
   */

  if (
    runningTasks.has(
      task.id
    )
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


    if (
      result &&
      result.success
    ) {

      recordVisit(
        task.id,
        "success"
      );


      addLog(
        `任务 #${task.id} 执行完成`
      );

    } else {

      const reason =
        getErrorReason(
          result
        );


      recordVisit(
        task.id,
        "failed"
      );


      addLog(
        `任务 #${task.id} 执行失败：${reason}`,
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

    } catch (
      recordError
    ) {

      console.error(
        "[Scheduler] Record visit error:",
        recordError
      );
    }


    const reason =
      error &&
      error.message
        ? error.message
        : String(error);


    addLog(
      `任务 #${task.id} 出现错误：${reason}`,
      "error"
    );

  } finally {

    runningTasks.delete(
      task.id
    );
  }
}


/*
 * ============================
 * 检查所有任务
 * ============================
 */

async function checkTasks() {

  let tasks;


  try {

    tasks =
      getTasks();

  } catch (error) {

    console.error(
      "[Scheduler] Get tasks error:",
      error
    );


    addLog(
      `读取任务失败：${error.message}`,
      "error"
    );


    return;
  }


  for (
    const task of tasks
  ) {

    if (
      shouldRun(task)
    ) {

      /*
       * 不 await。
       *
       * 这样多个任务可以
       * 同时运行，不互相等待。
       */

      runTask(task);
    }
  }
}


/*
 * ============================
 * Start
 * ============================
 */

function startScheduler() {

  if (
    schedulerTimer
  ) {

    return;
  }


  addLog(
    "任务调度器启动"
  );


  /*
   * 服务启动后立即检查一次。
   */

  checkTasks();


  /*
   * 后续每 5 秒检查一次。
   */

  schedulerTimer =
    setInterval(
      checkTasks,
      CHECK_INTERVAL
    );
}


/*
 * ============================
 * Stop
 * ============================
 */

function stopScheduler() {

  if (
    schedulerTimer
  ) {

    clearInterval(
      schedulerTimer
    );

    schedulerTimer = null;
  }


  addLog(
    "任务调度器已停止"
  );
}


/*
 * ============================
 * Export
 * ============================
 */

module.exports = {
  startScheduler,
  stopScheduler
};
