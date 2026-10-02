const form =
  document.getElementById("taskForm");

const tasks =
  document.getElementById("tasks");

async function loadTasks() {

  const response =
    await fetch("/api/tasks");

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
                onclick="stopTask(${task.id})">
                停止
              </button>`
            : `<button
                onclick="startTask(${task.id})">
                启动
              </button>`
        }

        <button
          class="danger"
          onclick="deleteTask(${task.id})">
          删除
        </button>

      </div>

    `;

    tasks.appendChild(card);
  }
}

form.addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const url =
      document.getElementById("url").value;

    const interval =
      document.getElementById("interval").value;

    const stay =
      document.getElementById("stay").value;

    await fetch("/api/tasks", {

      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        url,
        interval_minutes:
          Number(interval),
        stay_seconds:
          Number(stay)
      })
    });

    form.reset();

    document.getElementById(
      "interval"
    ).value = 5;

    document.getElementById(
      "stay"
    ).value = 10;

    loadTasks();
  }
);

async function startTask(id) {

  await fetch(
    `/api/tasks/${id}/start`,
    {
      method: "POST"
    }
  );

  loadTasks();
}

async function stopTask(id) {

  await fetch(
    `/api/tasks/${id}/stop`,
    {
      method: "POST"
    }
  );

  loadTasks();
}

async function deleteTask(id) {

  if (
    !confirm("确定删除这个任务？")
  ) {
    return;
  }

  await fetch(
    `/api/tasks/${id}`,
    {
      method: "DELETE"
    }
  );

  loadTasks();
}

function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadTasks();

setInterval(
  loadTasks,
  5000
);
