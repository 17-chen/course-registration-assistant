import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { startAssistantServer } from "../src/server.js";

let mainWindow;
let assistant;

async function createWindow() {
  const appRoot = app.getAppPath();
  const dataRoot = app.getPath("userData");
  assistant = await startAssistantServer({ appRoot, dataRoot, port: 0 });

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: "#f3f4f5",
    title: "WKU 抢课助手",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  await mainWindow.loadURL(assistant.url);
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (!assistant) return;
  event.preventDefault();
  const current = assistant;
  assistant = null;
  await current.close();
  app.quit();
});
