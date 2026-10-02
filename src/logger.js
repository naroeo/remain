const clients = new Set();

const logs = [];

const MAX_LOGS = 200;

function addLog(
  message,
  level = "info"
) {
  const log = {
    time: new Date().toISOString(),
    level,
    message
  };

  logs.push(log);

  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  const data =
    `data: ${JSON.stringify(log)}\n\n`;

  for (const client of clients) {
    try {
      client.write(data);
    } catch (error) {
      clients.delete(client);
    }
  }

  console.log(
    `[${level.toUpperCase()}] ${message}`
  );

  return log;
}

function subscribe(response) {

  response.setHeader(
    "Content-Type",
    "text/event-stream"
  );

  response.setHeader(
    "Cache-Control",
    "no-cache"
  );

  response.setHeader(
    "Connection",
    "keep-alive"
  );

  if (response.flushHeaders) {
    response.flushHeaders();
  }

  clients.add(response);

  // 把已经存在的日志发送给刚连接的浏览器
  for (const log of logs) {

    response.write(
      `data: ${JSON.stringify(log)}\n\n`
    );

  }

  // 每 15 秒发送一次心跳
  // 防止某些代理服务器关闭长连接
  const heartbeat =
    setInterval(() => {

      try {

        response.write(
          ": heartbeat\n\n"
        );

      } catch (error) {

        clearInterval(
          heartbeat
        );

      }

    }, 15000);

  response.on(
    "close",
    () => {

      clearInterval(
        heartbeat
      );

      clients.delete(
        response
      );

    }
  );
}

function getLogs() {
  return [...logs];
}

module.exports = {
  addLog,
  subscribe,
  getLogs
};
