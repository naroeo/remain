const express = require("express");
const path = require("path");

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
  addLog,
  getLogs,
  clearLogs,
  subscribe
} = require("./logger");


/*
 * ============================
 * Express
 * ============================
 */

const app = express();

const PORT =
  process.env.PORT || 3000;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;


/*
 * ============================
 * Middleware
 * ============================
 */

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
 * Authentication
 * ============================
 */

function createToken() {

  return Buffer
    .from(
      `${Date.now()}:${ADMIN_PASSWORD}`
    )
    .toString("base64");
}


function checkAuth(
  req,
  res,
  next
) {

  /*
   * 登录接口不需要 Token
   */

  if (
    req.path === "/login"
  ) {
    return next();
  }


  const authorization =
    req.headers.authorization || "";


  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {

    return res
      .status(401)
      .json({
        error:
          "未登录或登录已失效"
      });
  }


  const token =
    authorization.slice(7);


  if (!token) {

    return res
      .status(401)
      .json({
        error:
          "未登录或登录已失效"
      });
  }


  /*
   * 当前版本使用时间 + 密码
   * 生成登录 Token。
   *
   * 这里只需要验证 Token 是否
   * 能够还原出当前密码。
   */

  try {

    const decoded =
      Buffer
        .from(
          token,
          "base64"
        )
        .toString("utf8");


    const separator =
      decoded.indexOf(":");


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
        "Invalid token"
      );
    }


    next();

  } catch (error) {

    return res
      .status(401)
      .json({
        error:
          "登录已失效，请重新登录"
      });
  }
}


app.use(
  "/api",
  checkAuth
);


/*
 * ============================
 * Login
 * ============================
 */

app.post(
  "/api/login",
  (req, res) => {

    const {
      password
    } = req.body || {};


    if (
      !ADMIN_PASSWORD
    ) {

      return res
        .status(500)
        .json({
          error:
            "服务器未配置 ADMIN_PASSWORD"
        });
    }


    if (
      password !==
      ADMIN_PASSWORD
    ) {

      addLog(
        "登录失败",
        "warn"
      );

      return res
        .status(401)
        .json({
          error:
            "密码错误"
        });
    }


    const token =
      createToken();


    addLog(
      "管理员登录成功"
    );


    return res.json({
      token
    });
  }
);


/*
 * ============================
 * Tasks - GET
 * ============================
 */

app.get(
  "/api/tasks",
  (req, res) => {

    try {

      const tasks =
        getTasks();

      return res.json(
        tasks
      );

    } catch (error) {

      console.error(
        "[API] GET /api/tasks",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "读取任务失败"
        });
    }
  }
);


/*
 * ============================
 * Task - GET
 * ============================
 */

app.get(
  "/api/tasks/:id",
  (req, res) => {

    const id =
      Number(
        req.params.id
      );


    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return res
        .status(400)
        .json({
          error:
            "无效的任务 ID"
        });
    }


    try {

      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "任务不存在"
          });
      }


      return res.json(
        task
      );

    } catch (error) {

      console.error(
        "[API] GET /api/tasks/:id",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "读取任务失败"
        });
    }
  }
);


/*
 * ============================
 * Task - CREATE
 * ============================
 */

app.post(
  "/api/tasks",
  (req, res) => {

    const {
      name,
      url,
      interval_minutes,
      stay_seconds
    } = req.body || {};


    const taskName =
      String(
        name ?? ""
      ).trim();

    const taskUrl =
      String(
        url ?? ""
      ).trim();

    const interval =
      Number(
        interval_minutes
      );

    const stay =
      Number(
        stay_seconds
      );


    /*
     * 名称
     */

    if (
      !taskName
    ) {

      return res
        .status(400)
        .json({
          error:
            "请输入任务名称"
        });
    }


    /*
     * URL
     */

    if (
      !taskUrl
    ) {

      return res
        .status(400)
        .json({
          error:
            "请输入 URL"
        });
    }


    try {

      new URL(
        taskUrl
      );

    } catch (error) {

      return res
        .status(400)
        .json({
          error:
            "URL 格式不正确"
        });
    }


    /*
     * 间隔
     */

    if (
      !Number.isFinite(interval) ||
      interval <= 0
    ) {

      return res
        .status(400)
        .json({
          error:
            "执行间隔必须大于 0 分钟"
        });
    }


    /*
     * 停留时间
     */

    if (
      !Number.isFinite(stay) ||
      stay < 0
    ) {

      return res
        .status(400)
        .json({
          error:
            "停留时间不能小于 0 秒"
        });
    }


    try {

      const task =
        createTask(
          taskName,
          taskUrl,
          interval,
          stay
        );


      addLog(
        `创建任务 #${task.id}`
      );


      return res
        .status(201)
        .json(task);

    } catch (error) {

      console.error(
        "[API] POST /api/tasks",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "创建任务失败"
        });
    }
  }
);


/*
 * ============================
 * Task - START
 * ============================
 */

app.post(
  "/api/tasks/:id/start",
  (req, res) => {

    const id =
      Number(
        req.params.id
      );


    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return res
        .status(400)
        .json({
          error:
            "无效的任务 ID"
        });
    }


    try {

      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "任务不存在"
          });
      }


      const updated =
        updateTask(
          id,
          {
            enabled: 1
          }
        );


      addLog(
        `启动任务 #${id}`
      );


      return res.json(
        updated
      );

    } catch (error) {

      console.error(
        "[API] START",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "启动任务失败"
        });
    }
  }
);


/*
 * ============================
 * Task - STOP
 * ============================
 */

app.post(
  "/api/tasks/:id/stop",
  (req, res) => {

    const id =
      Number(
        req.params.id
      );


    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return res
        .status(400)
        .json({
          error:
            "无效的任务 ID"
        });
    }


    try {

      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "任务不存在"
          });
      }


      const updated =
        updateTask(
          id,
          {
            enabled: 0
          }
        );


      addLog(
        `停止任务 #${id}`
      );


      return res.json(
        updated
      );

    } catch (error) {

      console.error(
        "[API] STOP",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "停止任务失败"
        });
    }
  }
);


/*
 * ============================
 * Task - UPDATE
 * ============================
 */

app.put(
  "/api/tasks/:id",
  (req, res) => {

    const id =
      Number(
        req.params.id
      );


    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return res
        .status(400)
        .json({
          error:
            "无效的任务 ID"
        });
    }


    try {

      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "任务不存在"
          });
      }


      const fields =
        req.body || {};


      /*
       * 任务名称
       */

      if (
        fields.name !== undefined
      ) {

        const name =
          String(
            fields.name
          ).trim();


        if (!name) {

          return res
            .status(400)
            .json({
              error:
                "任务名称不能为空"
            });
        }


        fields.name =
          name;
      }


      /*
       * URL
       */

      if (
        fields.url !== undefined
      ) {

        const url =
          String(
            fields.url
          ).trim();


        if (!url) {

          return res
            .status(400)
            .json({
              error:
                "请输入 URL"
            });
        }


        try {

          new URL(url);

        } catch (error) {

          return res
            .status(400)
            .json({
              error:
                "URL 格式不正确"
            });
        }


        fields.url =
          url;
      }


      /*
       * 执行间隔
       */

      if (
        fields.interval_minutes !==
        undefined
      ) {

        const interval =
          Number(
            fields.interval_minutes
          );


        if (
          !Number.isFinite(interval) ||
          interval <= 0
        ) {

          return res
            .status(400)
            .json({
              error:
                "执行间隔必须大于 0 分钟"
            });
        }


        fields.interval_minutes =
          interval;
      }


      /*
       * 停留时间
       */

      if (
        fields.stay_seconds !==
        undefined
      ) {

        const stay =
          Number(
            fields.stay_seconds
          );


        if (
          !Number.isFinite(stay) ||
          stay < 0
        ) {

          return res
            .status(400)
            .json({
              error:
                "停留时间不能小于 0 秒"
            });
        }


        fields.stay_seconds =
          stay;
      }


      const updated =
        updateTask(
          id,
          fields
        );


      addLog(
        `更新任务 #${id}`
      );


      return res.json(
        updated
      );

    } catch (error) {

      console.error(
        "[API] UPDATE",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "更新任务失败"
        });
    }
  }
);


/*
 * ============================
 * Task - DELETE
 * ============================
 */

app.delete(
  "/api/tasks/:id",
  (req, res) => {

    const id =
      Number(
        req.params.id
      );


    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return res
        .status(400)
        .json({
          error:
            "无效的任务 ID"
        });
    }


    try {

      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error:
              "任务不存在"
          });
      }


      deleteTask(id);


      addLog(
        `删除任务 #${id}`
      );


      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "[API] DELETE",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "删除任务失败"
        });
    }
  }
);


/*
 * ============================
 * Logs - GET
 * ============================
 */

app.get(
  "/api/logs",
  (req, res) => {

    try {

      return res.json(
        getLogs()
      );

    } catch (error) {

      console.error(
        "[API] GET /api/logs",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "读取日志失败"
        });
    }
  }
);


/*
 * ============================
 * Logs - CLEAR
 * ============================
 */

app.delete(
  "/api/logs",
  (req, res) => {

    try {

      clearLogs();

      addLog(
        "日志已清空"
      );


      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "[API] DELETE /api/logs",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "清空日志失败"
        });
    }
  }
);


/*
 * ============================
 * Logs - SSE
 * ============================
 */

app.get(
  "/api/logs/stream",
  (req, res) => {

    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.flushHeaders();


    const unsubscribe =
      subscribe(
        log => {

          res.write(
            `data: ${JSON.stringify(log)}\n\n`
          );

        }
      );


    req.on(
      "close",
      () => {

        unsubscribe();

      }
    );
  }
);


/*
 * ============================
 * Frontend
 * ============================
 */

app.get(
  "*",
  (req, res) => {

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
 * ============================
 * Start Server
 * ============================
 */

const server =
  app.listen(
    PORT,
    () => {

      console.log(
        `Remain server listening on port ${PORT}`
      );

      addLog(
        `服务启动，监听端口 ${PORT}`
      );

      startScheduler();

    }
  );


/*
 * ============================
 * Graceful Shutdown
 * ============================
 */

async function shutdown(
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

      console.log(
        "HTTP server closed"
      );

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
