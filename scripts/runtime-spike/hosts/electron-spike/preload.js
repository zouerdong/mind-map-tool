const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spike", {
  rss: () => ipcRenderer.invoke("spikemetric:rss"),
  events: () => ipcRenderer.invoke("spikemetric:events"),
  uptime: () => ipcRenderer.invoke("spikemetric:uptime"),
  exportPdf: (args) => ipcRenderer.invoke("spikexport:pdf", args),
  onOpenFile: (cb) => ipcRenderer.on("spike:open-file", (_e, path) => cb(path)),
});
