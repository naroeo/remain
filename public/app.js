const TOKEN_KEY = "remain_token";

let logStreamController = null;
let refreshTimer = null;

let currentTasks = [];


/* =========================================================
   Token
   ========================================================= */

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}


/* =========================================================
   页面显示
   ========================================================= */

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


/* =========================================================
   通用 API
   ========================================================= */

async function apiFetch(url, options = {}) {
  const token = getToken();

  const headers = new Headers(
    options.headers || {}
  );

  if (token) {
    headers.set(
      "Authorization",
      `Bearer ${token}`
    );
  }

  const response = await fetch(
    url,
    {
      ...options,
      headers
    }
  );

  if (response.status === 401) {
    clearToken();

    if (logStreamController) {
      try {
        logStreamController.abort();
      } catch {}

      logStreamController = null;
    }

    showLoginPage();

    throw new Error(
      "登录已失效，请重新登录"
    );
  }

  return response;
}


/* =========================================================
   HTML 转义
   ========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================
   登录
   ========================================================= */

async function handleLogin(event) {
  event.preventDefault();

  const passwordInput =
    document.getElementById(
      "login-password"
    );

  const errorElement =
    document.getElementById(
      "login-error"
    );

  const button =
    document.querySelector(
      "#login-form button[type='submit']"
    );

  const password =
    passwordInput.value;

  errorElement.textContent = "";

  if (!password) {
    errorElement.textContent =
      "请输入密码";
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "登录中...";
  }

  try {
    const response = await fetch(
      "/api/login",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          password
        })
      }
    );

    let data = {};

    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      throw new Error(
        data.error ||
        "登录失败"
      );
    }

    if (!data.token) {
      throw new Error(
        "服务器没有返回登录凭证"
      );
    }

    setToken(data.token);

    passwordInput.value = "";

    showAppPage();

    await initializeApp();

  } catch (error) {
    errorElement.textContent =
      error.message ||
      "登录失败";

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "登录";
    }
  }
}


/* =========================================================
   退出登录
   ========================================================= */

function logout() {
  clearToken();

  if (logStreamController) {
    try {
      logStreamController.abort();
    } catch {}

    logStreamController = null;
  }

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  showLoginPage();
}


/* =========================================================
   任务列表
   ========================================================= */

async function loadTasks() {
  try {
    const response = await apiFetch(
      "/api/tasks"
    );

    if (!response.ok) {
      throw new Error(
        `加载任务失败：HTTP ${response.status}`
      );
    }

    const tasks = await response.json();

    currentTasks = Array.isArray(tasks)
      ? tasks
      : [];

    renderTasks(currentTasks);

  } catch (error) {
    console.error(
      "[App] 加载任务失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      showAppError(
        error.message ||
        "加载任务失败"
      );
    }
  }
}


function renderTasks(tasks) {
  const container =
    document.getElementById(
      "tasks-container"
    );

  const title =
    document.getElementById(
      "tasks-title"
    );

  if (!container) {
    return;
  }

  const count =
    Array.isArray(tasks)
      ? tasks.length
      : 0;

  if (title) {
    title.textContent =
      `任务列表（共 ${count} 个任务）`;
  }

  if (!count) {
    container.innerHTML = `
      <div class="empty-state">
        暂无任务
      </div>
    `;

    return;
  }

  container.innerHTML =
    tasks
      .map(task => renderTaskCard(task))
      .join("");
}


function renderTaskCard(task) {
  const id = Number(task.id);

  const name =
    task.name &&
    String(task.name).trim()
      ? task.name
      : `任务 #${id}`;

  const url =
    task.url || "";

  const interval =
    Number(task.interval_minutes || 0);

  const stay =
    Number(task.stay_seconds || 0);

  const visitCount =
    Number(task.visit_count || 0);

  const enabled =
    Number(task.enabled) === 1;

  const statusText =
    enabled
      ? "运行中"
      : "已停止";

  const statusClass =
    enabled
      ? "status-on"
      : "status-off";

  const lastVisit =
    formatDateTime(task.last_visit);

  const nextVisit =
    formatDateTime(task.next_visit);

  const lastStatus =
    task.last_status || "暂无";

  return `
    <div
      class="task-card"
      data-task-id="${id}"
    >

      <div class="task-card-main">

        <div class="task-title-row">

          <span class="task-id">
            #${id}
          </span>

          <span class="task-name">
            ${escapeHtml(name)}
          </span>

        </div>


        <div class="task-url">
          ${escapeHtml(url)}
        </div>


        <div class="task-meta">

          <span>
            间隔：
            ${interval} 分钟
          </span>

          <span>
            停留：
            ${stay} 秒
          </span>

          <span>
            访问次数：
            ${visitCount}
          </span>

          <span
            class="${statusClass}"
          >
            ${statusText}
          </span>

        </div>


        <div class="task-extra">

          <span>
            上次访问：
            ${escapeHtml(lastVisit)}
          </span>

          <span>
            下次访问：
            ${escapeHtml(nextVisit)}
          </span>

          <span>
            上次结果：
            ${escapeHtml(lastStatus)}
          </span>

        </div>

      </div>


      <div class="task-actions">

        ${
          enabled
            ? `
              <button
                type="button"
                class="secondary-button task-action-button"
                data-action="stop"
                data-task-id="${id}"
              >
                停止
              </button>
            `
            : `
              <button
                type="button"
                class="primary-button task-action-button"
                data-action="start"
                data-task-id="${id}"
              >
                启动
              </button>
            `
        }


        <button
          type="button"
          class="secondary-button task-action-button"
          data-action="edit"
          data-task-id="${id}"
        >
          编辑
        </button>


        <button
          type="button"
          class="secondary-button danger-button task-action-button"
          data-action="delete"
          data-task-id="${id}"
        >
          删除
        </button>

      </div>

    </div>
  `;
}


/* =========================================================
   日期时间
   ========================================================= */

function formatDateTime(value) {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(
    "zh-CN",
    {
      hour12: false
    }
  );
}


/* =========================================================
   任务操作
   ========================================================= */

async function handleTaskAction(
  action,
  taskId
) {
  if (!taskId) {
    return;
  }

  if (action === "start") {
    await startTask(taskId);
    return;
  }

  if (action === "stop") {
    await stopTask(taskId);
    return;
  }

  if (action === "edit") {
    await openEditTask(taskId);
    return;
  }

  if (action === "delete") {
    await deleteTask(taskId);
  }
}


async function startTask(taskId) {
  try {
    const response = await apiFetch(
      `/api/tasks/${taskId}/start`,
      {
        method: "POST"
      }
    );

    const data =
      await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        `启动任务失败：HTTP ${response.status}`
      );
    }

    await loadTasks();

  } catch (error) {
    console.error(
      "[App] 启动任务失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      alert(
        error.message ||
        "启动任务失败"
      );
    }
  }
}


async function stopTask(taskId) {
  try {
    const response = await apiFetch(
      `/api/tasks/${taskId}/stop`,
      {
        method: "POST"
      }
    );

    const data =
      await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        `停止任务失败：HTTP ${response.status}`
      );
    }

    await loadTasks();

  } catch (error) {
    console.error(
      "[App] 停止任务失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      alert(
        error.message ||
        "停止任务失败"
      );
    }
  }
}


async function deleteTask(taskId) {
  const task =
    currentTasks.find(
      item =>
        Number(item.id) ===
        Number(taskId)
    );

  const taskName =
    task &&
    task.name &&
    String(task.name).trim()
      ? task.name
      : `任务 #${taskId}`;

  const confirmed =
    window.confirm(
      `确定要删除「${taskName}」吗？\n\n删除后任务 #${taskId} 将永久删除。`
    );

  if (!confirmed) {
    return;
  }

  try {
    const response = await apiFetch(
      `/api/tasks/${taskId}`,
      {
        method: "DELETE"
      }
    );

    const data =
      await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        `删除任务失败：HTTP ${response.status}`
      );
    }

    await loadTasks();

  } catch (error) {
    console.error(
      "[App] 删除任务失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      alert(
        error.message ||
        "删除任务失败"
      );
    }
  }
}


/* =========================================================
   创建任务
   ========================================================= */

async function handleCreateTask(event) {
  event.preventDefault();

  const nameInput =
    document.getElementById(
      "task-name"
    );

  const urlInput =
    document.getElementById(
      "task-url"
    );

  const intervalInput =
    document.getElementById(
      "task-interval"
    );

  const stayInput =
    document.getElementById(
      "task-stay"
    );

  const name =
    nameInput.value.trim();

  const url =
    urlInput.value.trim();

  const interval =
    Number(intervalInput.value);

  const stay =
    Number(stayInput.value);

  if (!name) {
    alert("请输入任务名称");
    nameInput.focus();
    return;
  }

  if (!url) {
    alert("请输入访问 URL");
    urlInput.focus();
    return;
  }

  if (
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    alert("执行间隔必须大于 0");
    intervalInput.focus();
    return;
  }

  if (
    !Number.isFinite(stay) ||
    stay < 0
  ) {
    alert("页面停留时间不能小于 0");
    stayInput.focus();
    return;
  }

  const submitButton =
    event.target.querySelector(
      "button[type='submit']"
    );

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent =
      "创建中...";
  }

  try {
    const response = await apiFetch(
      "/api/tasks",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          name,
          url,
          interval_minutes: interval,
          stay_seconds: stay
        })
      }
    );

    const data =
      await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        `创建任务失败：HTTP ${response.status}`
      );
    }

    event.target.reset();

    /*
     * 保持创建任务时的默认参数。
     */
    intervalInput.value = 5;
    stayInput.value = 10;

    await loadTasks();

  } catch (error) {
    console.error(
      "[App] 创建任务失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      alert(
        error.message ||
        "创建任务失败"
      );
    }

  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent =
        "创建任务";
    }
  }
}


/* =========================================================
   编辑任务
   ========================================================= */

async function openEditTask(taskId) {
  let task =
    currentTasks.find(
      item =>
        Number(item.id) ===
        Number(taskId)
    );

  try {
    /*
     * 如果当前缓存里没有，
     * 再从服务器获取一次。
     */
    if (!task) {
      const response =
        await apiFetch(
          `/api/tasks/${taskId}`
        );

      const data =
        await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(
          data.error ||
          `获取任务失败：HTTP ${response.status}`
        );
      }

      task = data;
    }

    if (!task) {
      throw new Error(
        "任务不存在"
      );
    }

    const idInput =
      document.getElementById(
        "edit-task-id"
      );

    const nameInput =
      document.getElementById(
        "edit-task-name"
      );

    const urlInput =
      document.getElementById(
        "edit-task-url"
      );

    const intervalInput =
      document.getElementById(
        "edit-task-interval"
      );

    const stayInput =
      document.getElementById(
        "edit-task-stay"
      );

    idInput.value = task.id;

    nameInput.value =
      task.name || "";

    urlInput.value =
      task.url || "";

    intervalInput.value =
      task.interval_minutes ?? 5;

    stayInput.value =
      task.stay_seconds ?? 10;

    showEditModal();

    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 50);

  } catch (error) {
    console.error(
      "[App] 打开编辑任务失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      alert(
        error.message ||
        "打开编辑任务失败"
      );
    }
  }
}


function showEditModal() {
  const modal =
    document.getElementById(
      "edit-task-modal"
    );

  if (!modal) {
    return;
  }

  modal.classList.remove("hidden");

  document.body.classList.add(
    "modal-open"
  );
}


function closeEditModal() {
  const modal =
    document.getElementById(
      "edit-task-modal"
    );

  if (!modal) {
    return;
  }

  modal.classList.add("hidden");

  document.body.classList.remove(
    "modal-open"
  );
}


async function handleEditTask(event) {
  event.preventDefault();

  const id =
    document.getElementById(
      "edit-task-id"
    ).value;

  const nameInput =
    document.getElementById(
      "edit-task-name"
    );

  const urlInput =
    document.getElementById(
      "edit-task-url"
    );

  const intervalInput =
    document.getElementById(
      "edit-task-interval"
    );

  const stayInput =
    document.getElementById(
      "edit-task-stay"
    );

  const name =
    nameInput.value.trim();

  const url =
    urlInput.value.trim();

  const interval =
    Number(intervalInput.value);

  const stay =
    Number(stayInput.value);

  if (!id) {
    alert("任务 ID 无效");
    return;
  }

  if (!name) {
    alert("请输入任务名称");
    nameInput.focus();
    return;
  }

  if (!url) {
    alert("请输入访问 URL");
    urlInput.focus();
    return;
  }

  if (
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    alert("执行间隔必须大于 0");
    intervalInput.focus();
    return;
  }

  if (
    !Number.isFinite(stay) ||
    stay < 0
  ) {
    alert("页面停留时间不能小于 0");
    stayInput.focus();
    return;
  }

  const submitButton =
    event.target.querySelector(
      "button[type='submit']"
    );

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent =
      "保存中...";
  }

  try {
    const response =
      await apiFetch(
        `/api/tasks/${id}`,
        {
          method: "PUT",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            name,
            url,
            interval_minutes: interval,
            stay_seconds: stay
          })
        }
      );

    const data =
      await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        `保存任务失败：HTTP ${response.status}`
      );
    }

    closeEditModal();

    await loadTasks();

  } catch (error) {
    console.error(
      "[App] 保存任务失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      alert(
        error.message ||
        "保存任务失败"
      );
    }

  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent =
        "保存修改";
    }
  }
}


/* =========================================================
   日志
   ========================================================= */

async function loadLogs() {
  try {
    const response =
      await apiFetch(
        "/api/logs"
      );

    if (!response.ok) {
      throw new Error(
        `加载日志失败：HTTP ${response.status}`
      );
    }

    const logs =
      await response.json();

    renderLogs(logs);

  } catch (error) {
    console.error(
      "[App] 加载日志失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      showAppError(
        error.message ||
        "加载日志失败"
      );
    }
  }
}


function renderLogs(logs) {
  const container =
    document.getElementById(
      "logs-container"
    );

  if (!container) {
    return;
  }

  if (
    !Array.isArray(logs) ||
    logs.length === 0
  ) {
    container.innerHTML = `
      <div class="empty-state">
        暂无日志
      </div>
    `;

    return;
  }

  container.innerHTML =
    logs
      .map(log => renderLogItem(log))
      .join("");

  container.scrollTop =
    container.scrollHeight;
}


function renderLogItem(log) {
  const level =
    log.level || "info";

  const message =
    log.message || "";

  const time =
    formatDateTime(
      log.created_at ||
      log.time ||
      log.timestamp
    );

  return `
    <div class="log-item log-${escapeHtml(level)}">

      <span class="log-time">
        ${escapeHtml(time)}
      </span>

      <span class="log-level">
        ${escapeHtml(level)}
      </span>

      <span class="log-message">
        ${escapeHtml(message)}
      </span>

    </div>
  `;
}


/* =========================================================
   实时日志
   ========================================================= */

async function connectLogStream() {
  if (!getToken()) {
    return;
  }

  if (logStreamController) {
    try {
      logStreamController.abort();
    } catch {}
  }

  const controller =
    new AbortController();

  logStreamController = controller;

  try {
    const response =
      await fetch(
        "/api/logs/stream",
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${getToken()}`
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
        `日志连接失败：HTTP ${response.status}`
      );
    }

    if (!response.body) {
      throw new Error(
        "浏览器不支持实时日志流"
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";

    while (!controller.signal.aborted) {
      const result =
        await reader.read();

      if (result.done) {
        break;
      }

      buffer +=
        decoder.decode(
          result.value,
          {
            stream: true
          }
        );

      const parts =
        buffer.split("\n");

      buffer =
        parts.pop() || "";

      for (const line of parts) {
        processLogStreamLine(line);
      }
    }

  } catch (error) {
    if (
      controller.signal.aborted
    ) {
      return;
    }

    console.error(
      "[App] 实时日志连接失败:",
      error
    );

  } finally {
    if (
      logStreamController ===
      controller
    ) {
      logStreamController = null;
    }

    /*
     * 连接断开后自动重连。
     */
    if (
      getToken() &&
      !controller.signal.aborted
    ) {
      setTimeout(() => {
        if (getToken()) {
          connectLogStream();
        }
      }, 3000);
    }
  }
}


function processLogStreamLine(line) {
  const trimmed =
    line.trim();

  if (!trimmed) {
    return;
  }

  if (
    !trimmed.startsWith("data:")
  ) {
    return;
  }

  const raw =
    trimmed.slice(5).trim();

  if (!raw) {
    return;
  }

  try {
    const log =
      JSON.parse(raw);

    appendLog(log);

  } catch (error) {
    console.error(
      "[App] 日志数据解析失败:",
      error
    );
  }
}


function appendLog(log) {
  const container =
    document.getElementById(
      "logs-container"
    );

  if (!container) {
    return;
  }

  /*
   * 如果当前显示的是“暂无日志”，
   * 先清掉空状态。
   */
  const emptyState =
    container.querySelector(
      ".empty-state"
    );

  if (emptyState) {
    emptyState.remove();
  }

  container.insertAdjacentHTML(
    "beforeend",
    renderLogItem(log)
  );

  /*
   * 限制前端日志节点数量，
   * 避免长时间运行导致页面越来越大。
   */
  const items =
    container.querySelectorAll(
      ".log-item"
    );

  const maxItems = 500;

  if (items.length > maxItems) {
    const removeCount =
      items.length - maxItems;

    for (
      let i = 0;
      i < removeCount;
      i++
    ) {
      items[i].remove();
    }
  }

  container.scrollTop =
    container.scrollHeight;
}


/* =========================================================
   清空日志
   ========================================================= */

async function clearLogs() {
  const confirmed =
    window.confirm(
      "确定要清空全部运行日志吗？"
    );

  if (!confirmed) {
    return;
  }

  try {
    const response =
      await apiFetch(
        "/api/logs",
        {
          method: "DELETE"
        }
      );

    const data =
      await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        `清空日志失败：HTTP ${response.status}`
      );
    }

    await loadLogs();

  } catch (error) {
    console.error(
      "[App] 清空日志失败:",
      error
    );

    if (
      error.message !==
      "登录已失效，请重新登录"
    ) {
      alert(
        error.message ||
        "清空日志失败"
      );
    }
  }
}


/* =========================================================
   JSON 响应
   ========================================================= */

async function parseJsonResponse(
  response
) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}


/* =========================================================
   错误提示
   ========================================================= */

function showAppError(message) {
  console.error(
    "[App]",
    message
  );
}


/* =========================================================
   初始化
   ========================================================= */

async function initializeApp() {
  showAppPage();

  await Promise.all([
    loadTasks(),
    loadLogs()
  ]);

  connectLogStream();

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  /*
   * 保留原来的自动刷新机制。
   */
  refreshTimer =
    setInterval(() => {
      if (getToken()) {
        loadTasks();
        loadLogs();
      }
    }, 5000);
}


/* =========================================================
   事件绑定
   ========================================================= */

function bindEvents() {
  const loginForm =
    document.getElementById(
      "login-form"
    );

  if (loginForm) {
    loginForm.addEventListener(
      "submit",
      handleLogin
    );
  }


  const logoutButton =
    document.getElementById(
      "logout-button"
    );

  if (logoutButton) {
    logoutButton.addEventListener(
      "click",
      logout
    );
  }


  const taskForm =
    document.getElementById(
      "task-form"
    );

  if (taskForm) {
    taskForm.addEventListener(
      "submit",
      handleCreateTask
    );
  }


  const refreshTasksButton =
    document.getElementById(
      "refresh-tasks-button"
    );

  if (refreshTasksButton) {
    refreshTasksButton.addEventListener(
      "click",
      loadTasks
    );
  }


  const clearLogsButton =
    document.getElementById(
      "clear-logs-button"
    );

  if (clearLogsButton) {
    clearLogsButton.addEventListener(
      "click",
      clearLogs
    );
  }


  /*
   * 任务按钮使用事件委托。
   */
  const tasksContainer =
    document.getElementById(
      "tasks-container"
    );

  if (tasksContainer) {
    tasksContainer.addEventListener(
      "click",
      event => {
        const button =
          event.target.closest(
            "[data-action]"
          );

        if (!button) {
          return;
        }

        const action =
          button.dataset.action;

        const taskId =
          button.dataset.taskId;

        handleTaskAction(
          action,
          taskId
        );
      }
    );
  }


  /*
   * 编辑任务
   */
  const editTaskForm =
    document.getElementById(
      "edit-task-form"
    );

  if (editTaskForm) {
    editTaskForm.addEventListener(
      "submit",
      handleEditTask
    );
  }


  const closeEditButton =
    document.getElementById(
      "close-edit-task-button"
    );

  if (closeEditButton) {
    closeEditButton.addEventListener(
      "click",
      closeEditModal
    );
  }


  const cancelEditButton =
    document.getElementById(
      "cancel-edit-task-button"
    );

  if (cancelEditButton) {
    cancelEditButton.addEventListener(
      "click",
      closeEditModal
    );
  }


  const editBackdrop =
    document.getElementById(
      "edit-modal-backdrop"
    );

  if (editBackdrop) {
    editBackdrop.addEventListener(
      "click",
      closeEditModal
    );
  }


  /*
   * ESC 关闭编辑窗口
   */
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape"
      ) {
        const modal =
          document.getElementById(
            "edit-task-modal"
          );

        if (
          modal &&
          !modal.classList.contains(
            "hidden"
          )
        ) {
          closeEditModal();
        }
      }
    }
  );
}


/* =========================================================
   启动
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    bindEvents();

    if (getToken()) {
      try {
        await initializeApp();
      } catch (error) {
        console.error(
          "[App] 初始化失败:",
          error
        );

        clearToken();
        showLoginPage();
      }
    } else {
      showLoginPage();
    }
  }
);
