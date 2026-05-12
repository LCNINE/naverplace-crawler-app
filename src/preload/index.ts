import { contextBridge, ipcRenderer } from "electron";

const validInvokeChannels = new Set([
  "secrets:save",
  "secrets:load",
  "secrets:clear",
  "crawler:test-connection",
  "crawler:preflight",
  "crawler:create-table",
  "crawler:start",
  "crawler:stop",
  "progress:get",
  "progress:clear",
  "progress:listAll",
  "prefs:get",
  "prefs:setLastForm",
  "sessions:listActive",
  "logs:recent",
  "logs:clear",
  "auth:signIn",
  "auth:signOut",
  "auth:restore",
  "auth:defaultSettings",
  "updater:check",
  "updater:status",
  "updater:quitAndInstall",
  "updater:appVersion",
]);

const validOnChannels = new Set([
  "crawler:log",
  "crawler:progress",
  "crawler:done",
  "updater:status",
]);

contextBridge.exposeInMainWorld("api", {
  invoke: (channel: string, payload?: unknown) => {
    if (!validInvokeChannels.has(channel)) {
      return Promise.reject(new Error(`invalid channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!validOnChannels.has(channel)) {
      throw new Error(`invalid channel: ${channel}`);
    }
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
