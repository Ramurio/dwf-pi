import { parseArgs } from "node:util";
import { defaultStorePath } from "./service.js";
import { startGraphServer } from "./graph-view/server.js";
import { terminalText } from "./terminal.js";
import { dashboardStoreId, manageDashboard, readDashboardConfig } from "./dashboard.js";
const { values } = parseArgs({ options: {
  run: { type: "string" }, store: { type: "string" }, port: { type: "string" }, help: { type: "boolean" },
  install: { type: "boolean" }, uninstall: { type: "boolean" }, foreground: { type: "boolean" }, serve: { type: "boolean" },
} });
if (values.help) {
  process.stdout.write("dynamicwf ui [--run <id>] [--store state.sqlite] [--port 4380]\nReuse or start the persistent local dashboard (CLI exits; viewer stays running).\ndynamicwf ui --install   Enable macOS login startup and start the dashboard\ndynamicwf ui --uninstall Disable login startup and stop only the viewer\ndynamicwf ui --foreground [--port 0]   Temporary viewer; Ctrl+C closes it\n");
} else {
  try {
    if ([values.install, values.uninstall, values.foreground, values.serve].filter(Boolean).length > 1) throw new Error("Choose only one UI lifecycle option");
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error("Invalid --port");
    if (values.serve || values.foreground) {
      const config = values.serve ? await readDashboardConfig() : null;
      if (values.serve && !config) throw new Error("No dashboard config; use dynamicwf ui first");
      const viewer = await startGraphServer(config?.store ?? values.store ?? defaultStorePath(), values.run, config?.port ?? port ?? 0,
        config ? { stable: true, managerKey: config.key, storeId: dashboardStoreId(config.store) } : {});
      let closing = false;
      const close = () => { if (!closing) { closing = true; void viewer.close(); } };
      process.on("SIGINT", close); process.on("SIGTERM", close);
      process.stdout.write(`Workflow dashboard: ${viewer.url}\n`);
      process.send?.({ ready: true });
    } else {
      const result = await manageDashboard({ ...(values.store ? { store: values.store } : {}), ...(port === undefined ? {} : { port }),
        ...(values.install ? { install: true } : {}), ...(values.uninstall ? { uninstall: true } : {}) });
      if (!result.running) process.stdout.write("Панель остановлена, автозапуск отключён. Workflow продолжают работать.\n");
      else process.stdout.write(`Workflow dashboard: ${result.url}${values.run ? `?run=${encodeURIComponent(values.run)}` : ""}\nПанель работает в фоне. Сохрани ссылку в браузере. Автозапуск: ${result.loginStartup ? "включён" : "dynamicwf ui --install"}.\n`);
    }
  } catch (error) {
    process.stderr.write(`${terminalText(error instanceof Error ? error.message : String(error))}\n`); process.exitCode = 1;
  }
}
