const MAX_LOGS = 200;

const logs = [];

const subscribers = new Set();


/*
 * ============================
 * 添加日志
 * ============================
 */

function addLog(
  message,
  level = "info"
) {

  const log = {
    time:
      new Date().toISOString(),

    level,

    message:
      String(message)
  };


  /*
   * 保存日志
   */

  logs.push(log);


  /*
   * 最多保留 200 条
   */

  if (
    logs.length > MAX_LOGS
  ) {

    logs.splice(
      0,
      logs.length - MAX_LOGS
    );

  }


  /*
   * 输出到 Render 日志
   *
   * 注意：
   * 这里不修改 message。
   *
   * 哪些内容需要隐藏 URL、
   * 密码等敏感信息，
   * 由调用 addLog() 的地方决定。
   */

  const prefix =
    level === "error"
      ? "[ERROR]"
      : "[INFO]";


  console.log(
    `${prefix} ${log.message}`
  );


  /*
   * 推送到网页端
   */

  for (
    const res of subscribers
  ) {

    try {

      res.write(
        `data: ${JSON.stringify(log)}\n\n`
      );

    } catch (error) {

      subscribers.delete(
        res
      );

    }

  }

}


/*
 * ============================
 * 获取历史日志
 * ============================
 */

function getLogs() {

  return [
    ...logs
  ];

}


/*
 * ============================
 * SSE 实时日志
 * ============================
 */

function subscribe(
  res
) {

  /*
   * 设置 SSE Headers
   */

  res.writeHead(
    200,
    {
      "Content-Type":
        "text/event-stream",

      "Cache-Control":
        "no-cache",

      "Connection":
        "keep-alive",

      "X-Accel-Buffering":
        "no"
    }
  );


  /*
   * 发送当前历史日志
   */

  res.write(
    `data: ${JSON.stringify({
      type: "history",
      logs: getLogs()
    })}\n\n`
  );


  /*
   * 保存连接
   */

  subscribers.add(
    res
  );


  /*
   * 心跳
   *
   * 防止 Render / 代理
   * 长时间没有数据时关闭连接。
   */

  const heartbeat =
    setInterval(
      () => {

        try {

          res.write(
            ": heartbeat\n\n"
          );

        } catch (error) {

          clearInterval(
            heartbeat
          );

          subscribers.delete(
            res
          );

        }

      },
      15000
    );


  /*
   * 浏览器关闭连接
   */

  res.on(
    "close",
    () => {

      clearInterval(
        heartbeat
      );

      subscribers.delete(
        res
      );

    }
  );

}


/*
 * ============================
 * 导出
 * ============================
 */

module.exports = {
  addLog,
  getLogs,
  subscribe
};
