/**
 * OfferAIO desktop (Electron) — repo location: desktop/main.js
 * Boots the engine internally and shows the dashboard in one native window.
 */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 1024, minHeight: 700,
    title: "OfferAIO", backgroundColor: "#07070d", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("http://127.0.0.1")) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
  const tryLoad = () => win.loadURL("http://127.0.0.1:7717/").catch(() => setTimeout(tryLoad, 500));
  setTimeout(tryLoad, 900);
}

app.whenReady().then(() => {
  process.env.OFFERAIO_DATA = path.join(app.getPath("userData"), "engine-data");
  require("./server.js");
  createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
