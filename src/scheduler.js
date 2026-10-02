const {
  getTasks,
  getTask,
  recordVisit
} = require("./database");

const {
  addLog
} = require("./logger");

const {
  visit
} = require("./browser");


/*
 * ============================
 * 正在执行中的任务
 * ============================
 *
 * 防止同一个任务重复执行。
 * ============================
 */

const runningTasks =
  new Set();


/*
 * ============================
 * 判断任务是否应该执行
 * ============================
 */

function shouldRun(task) {

  /*
   * 未启用
   */

  if (
    !task ||
    !task.enabled
  ) {

    return false;

  }


  /*
   * 当前已经在执行
   */

  if (
    runningTasks.has(task.id)
  ) {

    return false;

  }


  /*
   * 第一次运行
   */

  if (
    !task.last_visit
  ) {

    return true;

  }


  /*
   * 根据上次访问时间
   * 和执行间隔判断
   */

  const lastVisit =
    new Date(
      task.last_visit
    ).getTime();


  if (
    !Number.isFinite(
      lastVisit
    )
  ) {

    return true;

  }


  const interval =
    Number(
      task.interval_minutes
    ) *
    60 *
    1000;


  return (
    Date.now() -
    lastVisit >=
    interval
  );

}


/*
 * ============================
 * 获取错误原因
 * ============================
 */

function getErrorReason(
  result
) {

  if (
    result &&
    typeof result.error ===
      "string" &&
    result.error.trim()
  ) {

    return result.error.trim();

  }


  if (
    result &&
    typeof result.message ===
      "string" &&
    result.message.trim()
  ) {

    return result.message.trim();

  }


  if (
    result &&
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
 * 执行单个任务
 * ============================
 */

async function runTask(
  task
) {

  /*
   * 防止重复执行
   */

  if (
    runningTasks.has(task.id)
  ) {

    return;

  }


  runningTasks.add(
    task.id
  );


  try {

    /*
     * 网页日志
     *
     * 不包含 URL。
     */

    addLog(
      `开始执行任务 #${task.id}`
    );


    /*
     * Render 后台日志
     */

    console.log(
      `[Scheduler] 开始执行任务 #${task.id}`
    );


    /*
     * 执行浏览器访问
     */

    const result =
      await visit(
        task.url,
        task.stay_seconds
      );


    /*
     * ========================
     * 执行成功
     * ========================
     */

    if (
      result &&
      result.success
    ) {

      recordVisit(
        task.id,
        "success"
      );


      /*
       * 网页日志
       */

      addLog(
        `任务 #${task.id} 执行完成`
      );


      /*
       * Render 后台日志
       */

      console.log(
        `[Scheduler] 任务 #${task.id} 执行完成`
      );


    } else {

      /*
       * 获取具体错误原因
       */

      const reason =
        getErrorReason(
          result
        );


      recordVisit(
        task.id,
        `error: ${reason}`
      );


      /*
       * 网页日志
       */

      addLog(
        `任务 #${task.id} 执行失败：${reason}`,
        "error"
      );


      /*
       * Render 后台日志
       */

      console.error(
        `[Scheduler] 任务 #${task.id} 执行失败：${reason}`
      );

    }

  } catch (error) {

    /*
     * 获取异常原因
     */

    const reason =
      getErrorReason(
        error
      );


    /*
     * 数据库记录失败状态
     */

    try {

      recordVisit(
        task.id,
        `error: ${reason}`
      );

    } catch (recordError) {

      console.error(
        `[Scheduler] 记录任务 #${task.id} 状态失败`
      );

    }


    /*
     * 网页日志
     */

    addLog(
      `任务 #${task.id} 出现错误：${reason}`,
      "error"
    );


    /*
     * Render 后台日志
     */

    console.error(
      `[Scheduler] 任务 #${task.id} 出现错误：${reason}`
    );

  } finally {

    /*
     * 无论成功还是失败，
     * 都解除运行状态。
     */

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
      "[Scheduler] 获取任务列表失败：",
      error
    );

    return;

  }


  for (
    const task of tasks
  ) {

    if (
      !shouldRun(task)
    ) {

      continue;

    }


    /*
     * 不等待任务完成，
     * 让其他任务可以独立执行。
     */

    runTask(task)
      .catch(
        error => {

          console.error(
            `[Scheduler] 任务 #${task.id} 执行异常：`,
            error
          );

        }
      );

  }

}


/*
 * ============================
 * 调度器
 * ============================
 */

let schedulerTimer =
  null;


/*
 * ============================
 * 启动调度器
 * ============================
 */

function startScheduler() {

  if (
    schedulerTimer
  ) {

    return;

  }


  console.log(
    "任务调度器启动"
  );


  /*
   * 启动后立即检查一次
   */

  checkTasks();


  /*
   * 每 5 秒检查一次
   */

  schedulerTimer =
    setInterval(
      () => {

        checkTasks();

      },
      5000
    );

}


/*
 * ============================
 * 停止调度器
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


  console.log(
    "任务调度器停止"
  );

}


/*
 * ============================
 * 导出
 * ============================
 */

module.exports = {
  startScheduler,
  stopScheduler
};
