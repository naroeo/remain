const form =
document.getElementById("taskForm");

const tasks =
document.getElementById("tasks");

const logs =
document.getElementById("logs");

const clearLogsButton =
document.getElementById(
"clear-logs-button"
);

const refreshButton =
document.getElementById(
"refresh-button"
);

/* =========================
Tasks
========================= */

async function loadTasks() {

try {

const response =
  await fetch("/api/tasks");

if (!response.ok) {
  throw new Error(
    `HTTP ${response.status}`
  );
}

const data =
  await response.json();

tasks.innerHTML = "";

if (!data.length) {

  tasks.innerHTML =
    `<div class="empty">
      暂时没有任务
    </div>`;

  return;
}

for (const task of data) {

  const card =
    document.createElement("div");

  card.className = "task";

  const status =
    task.enabled
      ? "🟢 运行中"
      : "⚪ 已停止";

  card.innerHTML = `

    <div class="task-main">

      <div class="url">
        ${escapeHtml(task.url)}
      </div>

      <div class="meta">
        ${status}
        · 每 ${task.interval_minutes} 分钟
        · 停留 ${task.stay_seconds} 秒
      </div>

      <div class="meta">
        已访问 ${task.visit_count} 次
      </div>

      ${
        task.last_visit
          ? `<div class="meta">
              上次访问：
              ${new Date(
                task.last_visit
              ).toLocaleString()}
            </div>`
          : ""
      }

    </div>

    <div class="actions">

      ${
        task.enabled
          ? `<button
              type="button"
              onclick="stopTask(${task.id})">
              停止
            </button>`
          : `<button
              type="button"
              onclick="startTask(${task.id})">
              启动
            </button>`
      }

      <button
        type="button"
        class="danger"
        onclick="deleteTask(${task.id})">
        删除
      </button>

    </div>

  `;

  tasks.appendChild(card);
}


} catch (error) {

console.error(
  "Failed to load tasks:",
  error
);


}
}

/* =========================
Create Task
========================= */

if (form) {

form.addEventListener(
"submit",
async event => {

  event.preventDefault();

  const url =
    document.getElementById(
      "url"
    ).value.trim();

  const interval =
    Number(
      document.getElementById(
        "interval"
      ).value
    );

  const stay =
    Number(
      document.getElementById(
        "stay"
      ).value
    );

  if (!url) {
    return;
  }

  try {

    const response =
      await fetch(
        "/api/tasks",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              url,
              interval_minutes:
                interval,
              stay_seconds:
                stay
            })
        }
      );

    if (!response.ok) {

      const errorData =
        await response.json()
          .catch(() => ({}));

      throw new Error(
        errorData.error ||
        `HTTP ${response.status}`
      );
    }

    form.reset();

    document.getElementById(
      "interval"
    ).value = 5;

    document.getElementById(
      "stay"
    ).value = 10;

    await loadTasks();

  } catch (error) {

    console.error(
      "Failed to create task:",
      error
    );

    alert(
      `添加任务失败：${error.message}`
    );

  }

}


);

}

/* =========================
Start Task
========================= */

async function startTask(id) {

try {

const response =
  await fetch(
    `/api/tasks/${id}/start`,
    {
      method: "POST"
    }
  );

if (!response.ok) {
  throw new Error(
    `HTTP ${response.status}`
  );
}

await loadTasks();


} catch (error) {

console.error(
  "Failed to start task:",
  error
);


}
}

/* =========================
Stop Task
========================= */

async function stopTask(id) {

try {

const response =
  await fetch(
    `/api/tasks/${id}/stop`,
    {
      method: "POST"
    }
  );

if (!response.ok) {
  throw new Error(
    `HTTP ${response.status}`
  );
}

await loadTasks();


} catch (error) {

console.error(
  "Failed to stop task:",
  error
);


}
}

/* =========================
Delete Task
========================= */

async function deleteTask(id) {

if (
!confirm(
"确定删除这个任务？"
)
) {
return;
}

try {

const response =
  await fetch(
    `/api/tasks/${id}`,
    {
      method: "DELETE"
    }
  );

if (!response.ok) {
  throw new Error(
    `HTTP ${response.status}`
  );
}

await loadTasks();


} catch (error) {

console.error(
  "Failed to delete task:",
  error
);


}
}

/* =========================
Runtime Logs
========================= */

function formatLogTime(time) {

const date =
new Date(time);

return date.toLocaleTimeString();
}

function renderLog(log) {

if (!logs) {
return;
}

const empty =
logs.querySelector(
".log-empty"
);

if (empty) {
empty.remove();
}

const row =
document.createElement("div");

row.className =
log log-${log.level || "info"};

const time =
document.createElement("span");

time.className =
"log-time";

time.textContent =
formatLogTime(
log.time
);

const message =
document.createElement("span");

message.textContent =
log.message;

row.appendChild(time);
row.appendChild(message);

logs.appendChild(row);

logs.scrollTop =
logs.scrollHeight;
}

/* =========================
Load Logs
========================= */

async function loadLogs() {

if (!logs) {
return;
}

try {

const response =
  await fetch(
    "/api/logs"
  );

if (!response.ok) {
  throw new Error(
    `HTTP ${response.status}`
  );
}

const data =
  await response.json();

logs.innerHTML = "";

if (!data.length) {

  logs.innerHTML =
    `<div class="log-empty">
      等待日志...
    </div>`;

  return;
}

for (const log of data) {
  renderLog(log);
}


} catch (error) {

console.error(
  "Failed to load logs:",
  error
);


}
}

/* =========================
Real-time Log Stream
========================= */

let logSource = null;
let reconnectTimer = null;

function connectLogStream() {

if (!logs) {
return;
}

if (logSource) {

try {
  logSource.close();
} catch (_) {}


}

logSource =
new EventSource(
"/api/logs/stream"
);

logSource.onmessage =
event => {

  try {

    const data =
      JSON.parse(
        event.data
      );

    /*
     * history 是服务器连接时
     * 一次发送的历史日志。
     *
     * 重新连接时不重复追加。
     */
    if (
      data &&
      data.type === "history"
    ) {
      return;
    }

    renderLog(data);

  } catch (error) {

    console.error(
      "Invalid log event:",
      error
    );

  }

};


logSource.onerror =
() => {

  if (logSource) {

    logSource.close();
    logSource = null;

  }

  if (reconnectTimer) {
    return;
  }

  reconnectTimer =
    setTimeout(
      () => {

        reconnectTimer = null;

        connectLogStream();

      },
      3000
    );

};


}

/* =========================
Clear Displayed Logs
========================= */

if (clearLogsButton) {

clearLogsButton.addEventListener(
"click",
() => {

  if (!logs) {
    return;
  }

  logs.innerHTML =
    `<div class="log-empty">
      等待日志...
    </div>`;

}


);

}

/* =========================
Refresh
========================= */

if (refreshButton) {

refreshButton.addEventListener(
"click",
() => {
loadTasks();
}
);

}

/* =========================
Helpers
========================= */

function escapeHtml(value) {

return String(value)
.replaceAll(
"&",
"&"
)
.replaceAll(
"<",
"<"
)
.replaceAll(
">",
">"
)
.replaceAll(
'"',
"""
)
.replaceAll(
"'",
"'"
);

}

/* =========================
Initial Load
========================= */

loadTasks();

loadLogs();

connectLogStream();

/* =========================
Auto Refresh Tasks
========================= */

setInterval(
loadTasks,
5000
);
