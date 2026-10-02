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
  startScheduler
} = require("./scheduler");

const app = express();

const PORT =
  process.env.PORT || 3000;

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "../public")
  )
);

app.get("/api/tasks", (req, res) => {

  res.json(
    getTasks()
  );

});

app.post("/api/tasks", (req, res) => {

  const {
    url,
    interval_minutes,
    stay_seconds
  } = req.body;

  if (
    !url ||
    !url.startsWith("http")
  ) {
    return res.status(400).json({
      error: "Invalid URL"
    });
  }

  const task = createTask(
    url,
    Math.max(
      1,
      Number(interval_minutes) || 5
    ),
    Math.max(
      1,
      Number(stay_seconds) || 10
    )
  );

  res.json(task);

});

app.post(
  "/api/tasks/:id/start",
  (req, res) => {

    const task =
      updateTask(
        req.params.id,
        {
          enabled: 1
        }
      );

    res.json(task);
  }
);

app.post(
  "/api/tasks/:id/stop",
  (req, res) => {

    const task =
      updateTask(
        req.params.id,
        {
          enabled: 0
        }
      );

    res.json(task);
  }
);

app.delete(
  "/api/tasks/:id",
  (req, res) => {

    deleteTask(
      req.params.id
    );

    res.json({
      success: true
    });

  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Browser KeepAlive running on ${PORT}`
    );

    startScheduler();
  }
);
