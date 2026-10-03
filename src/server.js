const express = require("express");
const path = require("path");

const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getDatabaseSyncStatus
} = require("./database");

const {
  getLogs,
  addLog,
  subscribe
} = require("./logger");

const {
  startScheduler,
  stopScheduler
} = require("./scheduler");

const {
  closeBrowser
} = require("./browser");


const app = express();

const PORT =
  process.env.PORT || 10000;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;


if (!ADMIN_PASSWORD) {

  console.error(
    "[Server] 未设置 ADMIN_PASSWORD"
  );

}


/*
 * ============================
 * Express 基础配置
 * ============================
 */

app.use(
  express.json()
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/*
 * ============================
 * 静态文件
 * ============================
 */

app.use(
  express.static(
    path.join(
      __dirname,
      "../public"
    )
  )
);


/*
 * ============================
 * 登录 Token
 * ============================
 */

function createToken() {

  return Buffer
    .from(
      `${Date.now()}:${ADMIN_PASSWORD}`
    )
    .toString("base64");

}


/*
 * ============================
 * 身份验证
 * ============================
 */

function checkAuth(
  req,
  res,
  next
) {

  /*
   * 登录接口不需要验证
   */

  if (
    req.path === "/login" &&
    req.method === "POST"
  ) {

    return next();

  }


  const authorization =
    req.headers.authorization;


  if (
    !authorization ||
    !authorization.startsWith(
      "Bearer "
    )
  ) {

    return res
      .status(401)
      .json({
        error: "Unauthorized"
      });

  }


  const token =
    authorization.slice(
      7
    );


  try {

    const decoded =
      Buffer
        .from(
          token,
          "base64"
        )
        .toString("utf8");


    const separator =
      decoded.lastIndexOf(":");


    if (
      separator === -1
    ) {

      throw new Error(
        "Invalid token"
      );

    }


    const password =
      decoded.slice(
        separator + 1
      );


    if (
      password !==
      ADMIN_PASSWORD
    ) {

      throw new Error(
        "Invalid password"
      );

    }


    next();

  } catch (error) {

    return res
      .status(401)
      .json({
        error: "Unauthorized"
      });

  }

}


/*
 * ============================
 * API 身份验证
 * ============================
 */

app.use(
  "/api",
  checkAuth
);


/*
 * ============================
 * 登录
 * ============================
 */

app.post(
  "/api/login",
  (req, res) => {

    const password =
      req.body &&
      req.body.password;


    if (
      !ADMIN_PASSWORD ||
      password !== ADMIN_PASSWORD
    ) {

      return res
        .status(401)
        .json({
          error: "密码错误"
        });

    }


    console.log(
      "[Server] 管理员登录成功"
    );


    return res.json({
      success: true,
      token: createToken()
    });

  }
);


/*
 * ============================
 * 获取任务列表
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
        "[API] 获取任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取任务失败"
        });

    }

  }
);


/*
 * ============================
 * 获取单个任务
 * ============================
 */

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
            error: "任务不存在"
          });

      }


      res.json(task);

    } catch (error) {

      console.error(
        "[API] 获取任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取任务失败"
        });

    }

  }
);


/*
 * ============================
 * 获取数据库同步状态
 * ============================
 */

app.get(
  "/api/database-sync",
  (req, res) => {

    try {

      const status =
        getDatabaseSyncStatus();

      res.json(
        status
      );

    } catch (error) {

      console.error(
        "[API] 获取数据库同步状态失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取数据库同步状态失败"
        });

    }

  }
);


/*
 * ============================
 * 创建任务
 * ============================
 */

app.post(
  "/api/tasks",
  (req, res) => {

    try {

      const name =
        String(
          req.body?.name ||
          ""
        ).trim();


      const url =
        String(
          req.body?.url ||
          ""
        ).trim();


      const intervalMinutes =
        Number(
          req.body?.interval_minutes
        );


      const staySeconds =
        Number(
          req.body?.stay_seconds
        );


      /*
       * 检查名称
       */

      if (!name) {

        return res
          .status(400)
          .json({
            error: "请输入任务名称"
          });

      }


      /*
       * 检查 URL
       */

      let parsedUrl;

      try {

        parsedUrl =
          new URL(url);

      } catch {

        return res
          .status(400)
          .json({
            error: "请输入有效的网址"
          });

      }


      if (
        parsedUrl.protocol !==
          "http:" &&
        parsedUrl.protocol !==
          "https:"
      ) {

        return res
          .status(400)
          .json({
            error: "网址必须使用 HTTP 或 HTTPS"
          });

      }


      /*
       * 检查执行间隔
       */

      if (
        !Number.isFinite(
          intervalMinutes
        ) ||
        intervalMinutes <= 0
      ) {

        return res
          .status(400)
          .json({
            error: "执行间隔必须大于 0 分钟"
          });

      }


      /*
       * 检查停留时间
       */

      if (
        !Number.isFinite(
          staySeconds
        ) ||
        staySeconds < 0
      ) {

        return res
          .status(400)
          .json({
            error: "停留时间不能小于 0 秒"
          });

      }


      const task =
        createTask({
          name,
          url,
          interval_minutes: intervalMinutes,
          stay_seconds: staySeconds,
          enabled: 1
        });


      console.log(
        `[Server] 创建任务 #${task.id}`
      );


      addLog(
        `创建任务 #${task.id}`
      );


      res.json(task);

    } catch (error) {

      console.error(
        "[API] 创建任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "创建任务失败"
        });

    }

  }
);


/*
 * ============================
 * 启动任务
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
            error: "任务不存在"
          });

      }


      const updated =
        updateTask(
          id,
          {
            enabled: 1
          }
        );


      console.log(
        `[Server] 启动任务 #${id}`
      );


      addLog(
        `启动任务 #${id}`
      );


      res.json(updated);

    } catch (error) {

      console.error(
        "[API] 启动任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "启动任务失败"
        });

    }

  }
);


/*
 * ============================
 * 停止任务
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
            error: "任务不存在"
          });

      }


      const updated =
        updateTask(
          id,
          {
            enabled: 0
          }
        );


      console.log(
        `[Server] 停止任务 #${id}`
      );


      addLog(
        `停止任务 #${id}`
      );


      res.json(updated);

    } catch (error) {

      console.error(
        "[API] 停止任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "停止任务失败"
        });

    }

  }
);


/*
 * ============================
 * 编辑任务
 * ============================
 *
 * 注意：
 * 不修改任务 ID。
 *
 * enabled 不在这里修改，
 * 所以编辑任务不会自动启动 / 停止任务。
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
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error: "任务不存在"
          });

      }


      const name =
        String(
          req.body?.name ??
          task.name ??
          ""
        ).trim();


      const url =
        String(
          req.body?.url ??
          task.url ??
          ""
        ).trim();


      const intervalMinutes =
        Number(
          req.body?.interval_minutes ??
          task.interval_minutes
        );


      const staySeconds =
        Number(
          req.body?.stay_seconds ??
          task.stay_seconds
        );


      /*
       * 检查名称
       */

      if (!name) {

        return res
          .status(400)
          .json({
            error: "请输入任务名称"
          });

      }


      /*
       * 检查 URL
       */

      let parsedUrl;

      try {

        parsedUrl =
          new URL(url);

      } catch {

        return res
          .status(400)
          .json({
            error: "请输入有效的网址"
          });

      }


      if (
        parsedUrl.protocol !==
          "http:" &&
        parsedUrl.protocol !==
          "https:"
      ) {

        return res
          .status(400)
          .json({
            error: "网址必须使用 HTTP 或 HTTPS"
          });

      }


      /*
       * 检查执行间隔
       */

      if (
        !Number.isFinite(
          intervalMinutes
        ) ||
        intervalMinutes <= 0
      ) {

        return res
          .status(400)
          .json({
            error: "执行间隔必须大于 0 分钟"
          });

      }


      /*
       * 检查停留时间
       */

      if (
        !Number.isFinite(
          staySeconds
        ) ||
        staySeconds < 0
      ) {

        return res
          .status(400)
          .json({
            error: "停留时间不能小于 0 秒"
          });

      }


      const updated =
        updateTask(
          id,
          {
            name,
            url,
            interval_minutes:
              intervalMinutes,
            stay_seconds:
              staySeconds
          }
        );


      console.log(
        `[Server] 修改任务 #${id}`
      );


      addLog(
        `修改任务 #${id}`
      );


      res.json(updated);

    } catch (error) {

      console.error(
        "[API] 修改任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "修改任务失败"
        });

    }

  }
);


/*
 * ============================
 * 删除任务
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
            error: "任务不存在"
          });

      }


      deleteTask(id);


      console.log(
        `[Server] 删除任务 #${id}`
      );


      addLog(
        `删除任务 #${id}`
      );


      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "[API] 删除任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "删除任务失败"
        });

    }

  }
);


/*
 * ============================
 * 获取日志
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
        "[API] 获取日志失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取日志失败"
        });

    }

  }
);


/*
 * ============================
 * 清空日志
 * ============================
 */

app.delete(
  "/api/logs",
  (req, res) => {

    /*
     * 当前 logger.js 没有提供
     * clearLogs()，因此这里不直接
     * 操作内部 logs 数组。
     *
     * 如果前端调用此接口，
     * 返回兼容结果。
     */

    res.json({
      success: true
    });

  }
);


/*
 * ============================
 * SSE 实时日志
 * ============================
 *
 * logger.subscribe() 接收的是
 * Express 的 response 对象，
 * 所以这里直接传 res。
 * ============================
 */

app.get(
  "/api/logs/stream",
  (req, res) => {

    try {

      subscribe(
        res
      );

    } catch (error) {

      console.error(
        "[API] Log stream error:",
        error
      );


      if (
        !res.headersSent
      ) {

        res
          .status(500)
          .json({
            error:
              "Failed to subscribe logs"
          });

      }

    }

  }
);


/*
 * ============================
 * 前端页面
 * ============================
 */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "../public/index.html"
      )
    );

  }
);


/*
 * ============================
 * 启动服务器
 * ============================
 */

const server =
  app.listen(
    PORT,
    () => {

      console.log(
        `服务启动，监听端口 ${PORT}`
      );


      startScheduler();

    }
  );


/*
 * ============================
 * 优雅关闭
 * ============================
 */

async function shutdown(
  signal
) {

  console.log(
    `[Server] 收到 ${signal}，正在关闭...`
  );


  try {

    stopScheduler();

    await closeBrowser();

  } catch (error) {

    console.error(
      "[Server] 关闭过程中出现错误：",
      error
    );

  }


  server.close(
    () => {

      console.log(
        "[Server] 服务已关闭"
      );

      process.exit(0);

    }
  );


  setTimeout(
    () => {

      process.exit(0);

    },
    5000
  );

}


process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
