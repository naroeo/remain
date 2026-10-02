const {
  getTasks,
  getTask,
  recordVisit
} = require("./database");

const {
  visit
} = require("./browser");

const running = new Set();

async function runTask(id) {

  if (running.has(id)) {
    return;
  }

  const task = getTask(id);

  if (!task || !task.enabled) {
    return;
  }

  running.add(id);

  try {

    const result = await visit(
      task.url,
      task.stay_seconds
    );

    recordVisit(
      id,
      result.success
        ? "success"
        : "error"
    );

  } catch (error) {

    console.error(
      `[Scheduler]`,
      error.message
    );

    recordVisit(
      id,
      "error"
    );

  } finally {

    running.delete(id);
  }
}

function startScheduler() {

  console.log(
    "[Scheduler] Started"
  );

  setInterval(async () => {

    const tasks = getTasks();

    const now = Date.now();

    for (const task of tasks) {

      if (!task.enabled) {
        continue;
      }

      if (running.has(task.id)) {
        continue;
      }

      if (!task.next_visit) {
        await runTask(task.id);
        continue;
      }

      const next =
        new Date(task.next_visit).getTime();

      if (now >= next) {
        runTask(task.id);
      }
    }

  }, 5000);
}

module.exports = {
  startScheduler
};
