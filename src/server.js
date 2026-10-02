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

const ADMIN_PASSWORD =
process.env.ADMIN_PASSWORD;

/*

============================

Middleware

============================
*/

app.use(
express.json()
);

/*

============================

Login

============================
*/

app.post(
"/api/login",
(req, res) => {

const {
  password
} = req.body || {};

if (!ADMIN_PASSWORD) {

  console.error(
    "[Auth] ADMIN_PASSWORD is not configured"
  );

  return res
    .status(500)
    .json({
      error:
        "Server password is not configured"
    });

}

if (
  typeof password !== "string" ||
  password !== ADMIN_PASSWORD
) {

  return res
    .status(401)
    .json({
      error:
        "密码错误"
    });

}

/*
 * 简单 Token。
 *
 * Token 不包含密码，
 * 浏览器登录成功后保存。
 */
const token =
  Buffer
    .from(
      `${Date.now()}:${ADMIN_PASSWORD}`
    )
    .toString("base64");

res.json({
  success: true,
  token
});


}
);

/*

============================

Authentication

============================
*/

function checkAuth(req, res, next) {

/*

登录接口本身不需要认证
*/
if (
req.path === "/api/login"
) {
return next();
}

const authorization =
req.headers.authorization || "";

const token =
authorization.startsWith(
"Bearer "
)
? authorization.slice(7)
: "";

if (!token) {

return res
  .status(401)
  .json({
    error:
      "Unauthorized"
  });


}

try {

const decoded =
  Buffer
    .from(
      token,
      "base64"
    )
    .toString("utf8");

/*
 * Token 必须包含当前密码。
 *
 * 如果 Render 环境变量密码改变，
 * 之前的 Token 会自动失效。
 */
if (
  !ADMIN_PASSWORD ||
  !decoded.endsWith(
    `:${ADMIN_PASSWORD}`
  )
) {

  return res
    .status(401)
    .json({
      error:
        "Unauthorized"
    });

}

next();


} catch (error) {

return res
  .status(401)
  .json({
    error:
      "Unauthorized"
  });


}

}

/*

所有 /api/* 接口，

除登录接口外，都需要密码。
*/

app.use(
"/api",
checkAuth
);

/*

静态网页暂时正常提供。

下一步前端会自动显示登录页面，

未登录不会显示任务内容。
*/

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

============================

Tasks API

============================
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

// 获取单个任务

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

  /*
   * Render 日志不显示 URL
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

============================

Start Task

============================
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

  const result =
    updatedTask ||
    getTask(id);

  /*
   * Render 日志不显示 URL
   */

  addLog(
    `启动任务 #${id}`
  );

  res.json(result);

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

============================

Stop Task

============================
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

  const result =
    updatedTask ||
    getTask(id);

  addLog(
    `停止任务 #${id}`
  );

  res.json(result);

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

============================

Update Task

============================
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

============================

Delete Task

============================
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

============================

Logs API

============================
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

// 实时日志 SSE

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

============================

Health Check

============================
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

============================

Start Server

============================
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

============================

Graceful Shutdown

============================
*/

function shutdown(
signal
) {

console.log(
Received ${signal}
);

addLog(
收到 ${signal}，正在停止服务
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
