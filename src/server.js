import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RegistrationRunner, DEFAULT_URL } from "./registration-runner.js";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(srcDir);
const publicDir = path.join(rootDir, "public");
const runner = new RegistrationRunner({ rootDir });
const clients = new Set();
const port = Number(process.env.COURSE_ASSISTANT_PORT || 43127);

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return value ? JSON.parse(value) : {};
}

function broadcast(state) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) client.write(payload);
}

runner.on("state", broadcast);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, { ...runner.state, defaultUrl: DEFAULT_URL });
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify(runner.state)}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/open") {
      const input = await body(request);
      return json(response, 200, await runner.openPortal(input.url, input.browser));
    }
    if (request.method === "POST" && url.pathname === "/api/scan") return json(response, 200, await runner.scanCurrentPage());
    if (request.method === "POST" && url.pathname === "/api/start") return json(response, 200, await runner.start(await body(request)));
    if (request.method === "POST" && url.pathname === "/api/stop") return json(response, 200, runner.stop());
    if (request.method === "POST" && url.pathname === "/api/notify") {
      const { notify } = await import("./notifier.js");
      notify("抢课助手测试", "macOS 通知工作正常");
      return json(response, 200, { ok: true });
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(publicDir, relative);
    if (!file.startsWith(publicDir) || !fs.existsSync(file)) return json(response, 404, { error: "Not found" });
    const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    fs.createReadStream(file).pipe(response);
  } catch (error) {
    json(response, 400, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`抢课助手已启动：http://127.0.0.1:${port}`);
});

process.on("SIGINT", () => {
  runner.stop("程序已退出");
  server.close(() => process.exit(0));
});
