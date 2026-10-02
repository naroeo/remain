const express = require("express");
const path = require("path");
const crypto = require("crypto");

const {
  getTasks,
  getTask,
  createTask,
  updateTask,
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

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "";

const SESSION_COOKIE =
  "remain_session";

const SESSION_TTL =
  24 * 60 * 60 * 1000;

const sessions =
  new Map();


/*
 * ============================
 * Middleware
 * ============================
 */

app.use(
  express.json()
);


/*
 * ============================
 * Session Helpers
 * ============================
 */

function createSession() {

  const token =
    crypto.randomBytes(32).toString("hex");

  sessions.set(
    token,
    Date.now() + SESSION_TTL
  );

  return token;
}


function getSessionToken(req) {

  const cookie =
    req.headers.cookie || "";

  const match =
    cookie
      .split(";")
      .map(item => item.trim())
      .find(
        item =>
          item.startsWith(
            `${SESSION_COOKIE}=`
          )
      );

  if (!match) {
    return null;
  }

  return match.substring(
    SESSION_COOKIE.length + 1
  );
}


function isAuthenticated(req) {

  const token =
    getSessionToken(req);

  if (!token) {
    return false;
  }

  const expires =
    sessions.get(token);

  if (!expires) {
    return false;
  }

  if (
    Date.now() > expires
  ) {

    sessions.delete(token);

    return false;
  }

  return true;
}


function requireAuth(req, res, next) {

  if (
    isAuthenticated(req)
  ) {

    return next();
  }

  /*
   * API 请求返回 401
   */
  if (
    req.path.startsWith("/api/")
  ) {

    return res
      .status(401)
      .json({
        error: "Unauthorized"
      });

  }

  /*
   * 页面访问跳转登录页
   */
  return res.redirect(
    "/login.html"
  );
}


/*
 * ============================
 * Login API
 * ============================
 */

app.post(
  "/api/login",
  (req, res) => {

    if (!ADMIN_PASSWORD) {

      console.error(
        "[Auth] ADMIN_PASSWORD is not configured"
      );

      return res
        .status(500)
        .json({
          error:
            "Server authentication is not configured"
        });

    }

    const password =
      String(
        req.body?.password || ""
      );

    if (
      !crypto.timingSafeEqual(
        Buffer.from(password),
        Buffer.from(ADMIN_PASSWORD)
      )
    ) {

      addLog(
        "登录失败",
        "error"
      );

      return res
        .status(401)
        .json({
          error:
            "密码错误"
        });

    }

    const token =
      createSession();

    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax; Secure`
    );

    addLog(
      "管理员登录成功"
    );

    res.json({
      success: true
    });

  }
);


/*
 * ============================
 * Logout API
 * ============================
 */

app.post(
  "/api/logout",
  (req, res) => {

    const token =
      getSessionToken(req);

    if (token) {
      sessions.delete(token);
    }

    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`
    );

    res.json({
      success: true
    });

  }
);


/*
 * ============================
 * Login Status
 * ============================
 */

app.get(
  "/api/auth/status",
  (req, res) => {

    res.json({
      authenticated:
        isAuthenticated(req)
    });

  }
);


/*
 * ============================
 * Public Login Page
 * ============================
 */

app.get(
  "/login",
  (req, res) => {

    if (
      isAuthenticated(req)
    ) {

      return res.redirect(
        "/"
      );

    }

    res.sendFile(
      path.join(
        __dirname,
        "..",
        "public",
        "login.html"
      )
    );

  }
);


/*
 * ============================
 * Protected Static Files
 * ============================
 *
 * index.html 需要登录。
 * login.html 保持公开。
 */

app.get(
  "/",
  (req, res) => {

    if (
      !isAuthenticated(req)
    ) {

      return res.redirect(
        "/login"
      );

    }

    res.sendFile(
      path.join(
        __dirname,
        "..",
        "public",
        "index.html"
      )
    );

  }
);


/*
 * login.html / CSS / JS
 */

app.use(
  express.static(
    path.join(
      __dirname,
      "..",
      "public"
    ),
    {
      index: false
    }
  )
);


/*
 * ============================
 * Protected API
 * ============================
 */

app.use(
  "/api/tasks",
  requireAuth
);

app.use(
  "/api/logs",
  requireAuth
);


/*
 * ============================
 * Tasks API
 * ============================
 */

app.get(
  "/api/tasks",
  (req, res) => {

    try {

      const tasks =
        getTasks();

      res.json(tasks);

    } catch (error) {

      console.error(
        "[API] Get tasks error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to get tasks"
      });

    }

  }
);


app.get(
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

      res.json(task);

    } catch (error) {

      console.error(
        "[API] Get task error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to get task"
      });

    }

  }
);


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

      /*
       * Render 日志不输出 URL
       */
      addLog(
        `创建任务 #${task.id}`
      );

      res.json(task);

    } catch (error) {

      console.error(
        "[API] Create task error:",
        error
      );

      addLog(
        `创建任务失败：${error.message}`,
        "error"
      );

      res.status(500).json({
        error:
          "Failed to create task"
      });

    }

  }
);


/*
 * ============================
 * Start Task
 * ============================
 */

app.post(
  "/api/tasks/:id/start",
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

      const updatedTask =
        updateTask(
          id,
          {
            enabled: 1
          }
        );

      addLog(
        `启动任务 #${id}`
      );

      res.json(
        updatedTask ||
        getTask(id)
      );

    } catch (error) {

      console.error(
        "[API] Start task error:",
        error
      );

      addLog(
        `启动任务失败：${error.message}`,
        "error"
      );

      res.status(500).json({
        error:
          "Failed to start task"
      });

    }

  }
);


/*
 * ============================
 * Stop Task
 * ============================
 */

app.post(
  "/api/tasks/:id/stop",
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

      const updatedTask =
        updateTask(
          id,
          {
            enabled: 0
          }
        );

      addLog(
        `停止任务 #${id}`
      );

      res.json(
        updatedTask ||
        getTask(id)
      );

    } catch (error) {

      console.error(
        "[API] Stop task error:",
        error
      );

      addLog(
        `停止任务失败：${error.message}`,
        "error"
      );

      res.status(500).json({
        error:
          "Failed to stop task"
      });

    }

  }
);


/*
 * ============================
 * Update Task
 * ============================
 */

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
        `更新任务 #${task.id}`
      );

      res.json(task);

    } catch (error) {

      console.error(
        "[API] Update task error:",
        error
      );

      addLog(
        `更新任务失败：${error.message}`,
        "error"
      );

      res.status(500).json({
        error:
          "Failed to update task"
      });

    }

  }
);


/*
 * ============================
 * Delete Task
 * ============================
 */

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
        "[API] Delete task error:",
        error
      );

      addLog(
        `删除任务失败：${error.message}`,
        "error"
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

app.get(
  "/api/logs",
  (req, res) => {

    try {

      res.json(
        getLogs()
      );

    } catch (error) {

      console.error(
        "[API] Get logs error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to get logs"
      });

    }

  }
);


app.get(
  "/api/logs/stream",
  (req, res) => {

    try {

      subscribe(res);

    } catch (error) {

      console.error(
        "[API] Log stream error:",
        error
      );

      if (!res.headersSent) {

        res.status(500).json({
          error:
            "Failed to subscribe logs"
        });

      }

    }

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
 * Session Cleanup
 * ============================
 */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        token,
        expires
      ] of sessions
    ) {

      if (
        now > expires
      ) {

        sessions.delete(
          token
        );

      }

    }

  },
  60 * 60 * 1000
);


/*
 * ============================
 * Start Server
 * ============================
 */

const server =
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


/*
 * ============================
 * Graceful Shutdown
 * ============================
 */

function shutdown(
  signal
) {

  console.log(
    `Received ${signal}`
  );

  addLog(
    `收到 ${signal}，正在停止服务`
  );

  stopScheduler();

  server.close(
    () => {

      process.exit(0);

    }
  );

}


process.on(
  "SIGTERM",
  () => {
    shutdown("SIGTERM");
  }
);


process.on(
  "SIGINT",
  () => {
    shutdown("SIGINT");
  }
);
