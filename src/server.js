const express = require("express");
const path = require("path");

const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  recordVisit,
  deleteTask
} = require("./database");

const {
  startScheduler,
  stopScheduler
} = require("./scheduler");

const {
  subscribe,
  getLogs,
  addLog
} = require("./logger");

const app = express();

const PORT =
  process.env.PORT || 3000;

app.use(
  express.json()
);

app.use(
  express.static(
    path.join(
      __dirname,
      "..",
      "public"
    )
  )
);

/*
 * ============================
 * Tasks API
 * ============================
 */

// 获取所有任务
app.get(
  "/api/tasks",
  (req, res) => {

    try {

      const tasks =
        getTasks();

      res.json(tasks);

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        error:
          "Failed to get tasks"
      });

    }

  }
);

// 获取单个任务
app.get(
  "/api/tasks/:id",
  (req, res) => {

    try {

      const task =
        getTask(
          Number(req.params.id)
        );

      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "Task not found"
          });

      }

      res.json(task);

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        error:
          "Failed to get task"
      });

    }

  }
);

// 创建任务
app.post(
  "/api/tasks",
  (req, res) => {

    try {

      const {
        url,
        interval_minutes,
        stay_seconds
      } = req.body;

      if (!url) {

        return res
          .status(400)
          .json({
            error:
              "URL is required"
          });

      }

      const interval =
        Number(
          interval_minutes || 5
        );

      const stay =
        Number(
          stay_seconds || 10
        );

      if (
        !Number.isFinite(interval) ||
        interval <= 0
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid interval"
          });

      }

      if (
        !Number.isFinite(stay) ||
        stay < 0
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid stay time"
          });

      }

      const task =
        createTask(
          url,
          interval,
          stay
        );

      addLog(
        `创建任务 #${task.id}：${task.url}`
      );

      res.json(task);

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        error:
          "Failed to create task"
      });

    }

  }
);

// 更新任务
app.put(
  "/api/tasks/:id",
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      const task =
        updateTask(
          id,
          req.body
        );

      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "Task not found"
          });

      }

      addLog(
        `更新任务 #${task.id}：${task.url}`
      );

      res.json(task);

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        error:
          "Failed to update task"
      });

    }

  }
);

// 删除任务
app.delete(
  "/api/tasks/:id",
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      const task =
        getTask(id);

      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "Task not found"
          });

      }

      deleteTask(id);

      addLog(
        `删除任务 #${id}`
      );

      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        error:
          "Failed to delete task"
      });

    }

  }
);

/*
 * ============================
 * Logs API
 * ============================
 */

// 获取当前历史日志
app.get(
  "/api/logs",
  (req, res) => {

    try {

      res.json(
        getLogs()
      );

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        error:
          "Failed to get logs"
      });

    }

  }
);

// 实时日志 SSE
app.get(
  "/api/logs/stream",
  (req, res) => {

    subscribe(res);

  }
);

/*
 * ============================
 * Health Check
 * ============================
 */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      status: "ok",
      time:
        new Date().toISOString()
    });

  }
);

/*
 * ============================
 * Start Server
 * ============================
 */

app.listen(
  PORT,
  () => {

    console.log(
      `Remain running on port ${PORT}`
    );

    addLog(
      `Remain 服务启动，端口 ${PORT}`
    );

    startScheduler();

  }
);

process.on(
  "SIGTERM",
  () => {

    console.log(
      "Received SIGTERM"
    );

    stopScheduler();

    process.exit(0);

  }
);

process.on(
  "SIGINT",
  () => {

    console.log(
      "Received SIGINT"
    );

    stopScheduler();

    process.exit(0);

  }
);
