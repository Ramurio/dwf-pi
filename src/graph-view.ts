import { parseArgs } from "node:util";
import { defaultStorePath } from "./service.js";
import { startGraphServer } from "./graph-view/server.js";
import { terminalText } from "./terminal.js";
const { values } = parseArgs({
  options: {
    run: { type: "string" },
    store: { type: "string" },
    port: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  process.stdout.write(
    "dynamicwf ui [--run <id>] [--store state.sqlite] [--port 4380]\nLocal workflow dashboard. Ctrl+C closes the viewer server; the workflow continues.\n",
  );
} else {
  try {
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid --port");
    const viewer = await startGraphServer(
      values.store ?? defaultStorePath(),
      values.run,
      port,
    );
    let closing = false;
    const close = () => {
      if (!closing) {
        closing = true;
        void viewer.close();
      }
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
    process.stdout.write(
      `Workflow dashboard: ${viewer.url}\nОткрой ссылку в браузере. Ctrl+C закрывает просмотр, workflow продолжает работу.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${terminalText(error instanceof Error ? error.message : String(error))}\n`,
    );
    process.exitCode = 1;
  }
}
