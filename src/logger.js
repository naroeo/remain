const MAX_LOGS = 200;

const logs = [];

const subscribers = new Set();

/*

============================

添加日志

============================
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

保存到内存
*/
logs.push(log);

/*

限制日志数量

只保留最近 MAX_LOGS 条
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

输出到 Render 控制台
*/
const prefix =
level === "error"
? "[ERROR]"
: "[INFO]";

console.log(
${prefix} ${log.message}
);

/*

推送给网页端
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

============================

获取历史日志

============================
*/

function getLogs() {

return [
...logs
];

}

/*

============================

SSE 实时订阅

============================
*/

function subscribe(res) {

/*

SSE Headers
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

立即发送当前历史日志
*/
res.write(
data: ${JSON.stringify({ type: "history", logs: getLogs() })}\n\n
);

/*

加入订阅列表
*/
subscribers.add(
res
);

/*

保持连接
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

浏览器关闭连接
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

============================

导出

============================
*/

module.exports = {
addLog,
getLogs,
subscribe
};
