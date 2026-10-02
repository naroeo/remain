```javascript
const TOKEN_KEY = "remain_token";

let logStreamController = null;


// =========================
// Token
// =========================

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}


// =========================
// 页面切换
// =========================

function showLoginPage() {
  const loginPage = document.getElementById("login-page");
  const appPage = document.getElementById("app-page");

  if (loginPage) {
    loginPage.classList.remove("hidden");
  }

  if (appPage) {
    appPage.classList.add("hidden");
  }
}

function showAppPage() {
  const loginPage = document.getElementById("login-page");
  const appPage = document.getElementById("app-page");

  if (loginPage) {
    loginPage.classList.add("hidden");
  }

  if (appPage) {
    appPage.classList.remove("hidden");
  }
}


// =========================
// API 请求
// =========================

async function apiFetch(url, options = {}) {
  const token = getToken();

  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (
    options.body &&
    typeof options.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    clearToken();

    if (logStreamController) {
      logStreamController.abort();
      logStreamController = null;
    }

    showLoginPage();

    throw new Error("登录已失效，请重新登录");
  }

  return response;
}


// =========================
// 登录
// =========================

const loginForm = document.getElementById("login-form");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password =
      loginPassword ? loginPassword.value : "";

    if (!password) {
      if (loginError) {
        loginError.textContent = "请输入密码";
      }

      return;
    }

    if (loginError) {
      loginError.textContent = "";
    }

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "登录失败"
        );
      }

      if (!data.token) {
        throw new Error("服务器没有返回登录 Token");
      }

      setToken(data.token);

      if (loginPassword) {
        loginPassword.value = "";
      }

      showAppPage();

      await loadTasks();
      await loadLogs();

      connectLogStream();

    } catch (error) {
      console.error("[Login]", error);

      if (loginError) {
        loginError.textContent =
          error.message || "登录失败";
      }
    }
  });
}


// =========================
// 退出登录
// =========================

const logoutButton =
  document.getElementById("logout-button");

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    clearToken();

    if (logStreamController) {
      logStreamController.abort();
      logStreamController = null;
    }

    showLoginPage();
  });
}


// =========================
// HTML 转义
// =========================

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// =========================
// Tasks
// =========================

async function loadTasks() {
  try {
    const response =
      await apiFetch("/api/tasks");

    if (!response.ok) {
      throw new Error(
        "加载任务失败"
      );
    }

    const tasks =
      await response.json();

    renderTasks(tasks);

  } catch (error) {
    console.error(
      "[Tasks] Load error:",
      error
    );
  }
}


function renderTasks(tasks) {
  const container =
    document.getElementById("tasks");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!Array.isArray(tasks) || tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        暂无任务
      </div>
    `;

    return;
  }

  tasks.forEach((task) => {
    const card =
      document.createElement("div");

    card.className =
      "task-card";

    const enabled =
      Number(task.enabled) === 1;

    card.innerHTML = `
      <div class="task-info">
        <div class="task-url">
          ${escapeHtml(task.url)}
        </div>

        <div class="task-meta">
          <span>
            间隔：${task.interval_minutes} 分钟
          </span>

          <span>
            停留：${task.stay_seconds} 秒
          </span>

          <span class="${enabled ? "status-on" : "status-off"}">
            ${enabled ? "运行中" : "已停止"}
          </span>
        </div>
      </div>

      <div class="task-actions">
        ${
          enabled
            ? `
              <button
                class="secondary-button"
                data-action="stop"
                data-id="${task.id}"
              >
                停止
              </button>
            `
            : `
              <button
                class="primary-button"
                data-action="start"
                data-id="${task.id}"
              >
                启动
              </button>
            `
        }

        <button
          class="danger-button"
          data-action="delete"
          data-id="${task.id}"
        >
          删除
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}


// =========================
// Task 操作
// =========================

const tasksContainer =
  document.getElementById("tasks");

if (tasksContainer) {
  tasksContainer.addEventListener(
    "click",
    async (event) => {
      const button =
        event.target.closest("button");

      if (!button) {
        return;
      }

      const action =
        button.dataset.action;

      const id =
        button.dataset.id;

      if (!action || !id) {
        return;
      }

      try {
        if (action === "start") {
          await apiFetch(
            `/api/tasks/${id}/start`,
            {
              method: "POST"
            }
          );
        }

        if (action === "stop") {
          await apiFetch(
            `/api/tasks/${id}/stop`,
            {
              method: "POST"
            }
          );
        }

        if (action === "delete") {
          const confirmed =
            confirm("确定要删除这个任务吗？");

          if (!confirmed) {
            return;
          }

          await apiFetch(
            `/api/tasks/${id}`,
            {
              method: "DELETE"
            }
          );
        }

        await loadTasks();

      } catch (error) {
        console.error(
          "[Task Action]",
          error
        );

        alert(
          error.message || "操作失败"
        );
      }
    }
  );
}


// =========================
// 创建任务
// =========================

const taskForm =
  document.getElementById("taskForm");

if (taskForm) {
  taskForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      const formData =
        new FormData(taskForm);

      const url =
        String(formData.get("url") || "").trim();

      const intervalMinutes =
        Number(
          formData.get("interval_minutes") || 5
        );

      const staySeconds =
        Number(
          formData.get("stay_seconds") || 10
        );

      if (!url) {
        alert("请输入 URL");
        return;
      }

      try {
        const response =
          await apiFetch(
            "/api/tasks",
            {
              method: "POST",
              body: JSON.stringify({
                url,
                interval_minutes:
                  intervalMinutes,
                stay_seconds:
                  staySeconds
              })
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "创建任务失败"
          );
        }

        taskForm.reset();

        await loadTasks();

      } catch (error) {
        console.error(
          "[Task Create]",
          error
        );

        alert(
          error.message || "创建任务失败"
        );
      }
    }
  );
}


// =========================
// Logs
// =========================

async function loadLogs() {
  try {
    const response =
      await apiFetch("/api/logs");

    if (!response.ok) {
      throw new Error(
        "加载日志失败"
      );
    }

    const logs =
      await response.json();

    renderLogs(logs);

  } catch (error) {
    console.error(
      "[Logs] Load error:",
      error
    );
  }
}


function renderLogs(logs) {
  const container =
    document.getElementById("logs");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!Array.isArray(logs) || logs.length === 0) {
    return;
  }

  logs.forEach((log) => {
    renderLog(log, false);
  });

  container.scrollTop =
    container.scrollHeight;
}


function renderLog(log, scroll = true) {
  const container =
    document.getElementById("logs");

  if (!container) {
    return;
  }

  const row =
    document.createElement("div");

  row.className =
    `log log-${log.level || "info"}`;

  const time =
    log.time ||
    log.timestamp ||
    new Date().toISOString();

  row.innerHTML = `
    <span class="log-time">
      ${escapeHtml(time)}
    </span>

    <span class="log-message">
      ${escapeHtml(log.message || "")}
    </span>
  `;

  container.appendChild(row);

  if (scroll) {
    container.scrollTop =
      container.scrollHeight;
  }
}


// =========================
// 实时日志 SSE
// =========================
//
// EventSource 无法设置 Authorization Header。
// 所以这里使用 fetch + ReadableStream。
// =========================

async function connectLogStream() {
  if (logStreamController) {
    logStreamController.abort();
  }

  const token = getToken();

  if (!token) {
    return;
  }

  const controller =
    new AbortController();

  logStreamController =
    controller;

  try {
    const response =
      await fetch(
        "/api/logs/stream",
        {
          headers: {
            Authorization:
              `Bearer ${token}`
          },
          signal:
            controller.signal
        }
      );

    if (response.status === 401) {
      clearToken();

      showLoginPage();

      return;
    }

    if (!response.ok) {
      throw new Error(
        `日志连接失
```
