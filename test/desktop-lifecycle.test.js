import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

test("reopening the desktop window reuses the original server and browser owner", async () => {
  let starts = 0;
  const windows = [];
  const app = {
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: () => {} }),
    on: () => {},
    getAppPath: () => "/tmp/app",
    getPath: () => "/tmp/data",
  };
  class BrowserWindow {
    constructor() {
      this.events = {};
      this.webContents = { setWindowOpenHandler: () => {} };
      windows.push(this);
    }
    isDestroyed() { return false; }
    removeMenu() {}
    on(name, handler) { this.events[name] = handler; }
    async loadURL(url) { this.url = url; }
  }
  const context = vm.createContext({ app, BrowserWindow, shell: {}, path, process: { platform: "darwin" },
    startAssistantServer: async () => { starts++; return { url: `http://127.0.0.1:${43127 + starts}` }; },
  });
  const source = fs.readFileSync(new URL("../electron/main.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  vm.runInContext(source, context);
  await vm.runInContext("createWindow()", context);
  windows[0].events.closed();
  await vm.runInContext("createWindow()", context);
  assert.equal(starts, 1);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].url, windows[1].url);
});
