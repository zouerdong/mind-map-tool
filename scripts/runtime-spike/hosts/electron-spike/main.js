// Electron host spike (MM-010): minimal window + measurement modes + native
// export leg. Marker-file signals (macOS GUI stdout is unreliable here).
// Structure mirrors the verified mini2 diagnostic (whenReady -> window ->
// load -> executeJavaScript -> marker).

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const state = { windows: new Set(), events: [] };

function recordEvent(kind, payload) {
  state.events.push({ kind, payload, t: Date.now() });
  try { console.log(`[event] ${kind} ${JSON.stringify(payload ?? {})}`); } catch {}
}

function createWindow({ file } = {}) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  state.windows.add(win);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => state.windows.delete(win));
  win.loadFile(path.join(__dirname, "renderer", "index.html")).then(() => {
    if (file) win.webContents.send("spike:open-file", file);
    win.webContents.executeJavaScript("window.__RENDERER_READY === true").then(() => {
      if (process.env.SPIKE_READY_FILE) {
        try { fs.writeFileSync(process.env.SPIKE_READY_FILE, JSON.stringify({ readyAt: Date.now() })); } catch {}
      }
      if (process.env.SPIKE_QUIT_AFTER_READY) setTimeout(() => app.exit(0), 50);
      if (process.env.SPIKE_HOLD) setTimeout(() => app.exit(0), Number(process.env.SPIKE_HOLD) * 1000);
    }).catch(() => {});
  }).catch(() => {});
  return win;
}

function nativeExportPdf() {
  const { svgPath, outPath, width, height } = JSON.parse(process.env.SPIKE_EXPORT_PDF);
  const t0 = process.hrtime.bigint();
  const svg = fs.readFileSync(svgPath, "utf8");
  const win = new BrowserWindow({ show: false });
  const html = `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}</style>${svg}`;
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).then(() => {
    setTimeout(() => {
      win.webContents.printToPDF({
        printBackground: true,
        pageSize: { width: width / 96, height: height / 96 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      }).then((pdf) => {
        fs.writeFileSync(outPath, pdf);
        if (process.env.SPIKE_EXPORT_RESULT_FILE) {
          try {
            const ms = Number(process.hrtime.bigint() - t0) / 1e6;
            fs.writeFileSync(process.env.SPIKE_EXPORT_RESULT_FILE, JSON.stringify({ ok: true, ms: +ms.toFixed(1), bytes: pdf.length }));
          } catch {}
        }
        app.exit(0);
      }).catch((e) => {
        if (process.env.SPIKE_EXPORT_RESULT_FILE) {
          try { fs.writeFileSync(process.env.SPIKE_EXPORT_RESULT_FILE, JSON.stringify({ ok: false, error: String(e).slice(0, 200) })); } catch {}
        }
        app.exit(1);
      });
    }, 200);
  }).catch(() => app.exit(1));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    recordEvent("second-instance", argv);
    const files = argv.slice(1).filter((a) => !a.startsWith("-"));
    if (files.length) files.forEach((f) => createWindow({ file: f }));
    else createWindow();
  });

  app.on("open-file", (e, p) => { e.preventDefault(); recordEvent("open-file", p); createWindow({ file: p }); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  ipcMain.handle("spikemetric:rss", () => ({
    rss: process.memoryUsage().rss,
    windowCount: BrowserWindow.getAllWindows().length,
  }));
  ipcMain.handle("spikemetric:events", () => state.events);

  if (process.env.SPIKE_EXPORT_PDF) {
    app.whenReady().then(nativeExportPdf);
  } else {
    app.whenReady().then(() => {
      const argvFiles = process.argv.slice(1).filter((a) => !a.startsWith("-") && /\.(json|mmap)$/i.test(a));
      if (argvFiles.length) argvFiles.forEach((f) => createWindow({ file: f }));
      else createWindow();
    });
    app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  }
}
