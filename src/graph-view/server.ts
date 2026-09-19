import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RunController } from "../run-controller.js";
import { collectActivity, type WorkerActivity } from "../monitor.js";
import { summarizeTaskUsage, summarizeUsage } from "../usage.js";
import { publicReceipt } from "../lineage.js";
import { publicAttempts } from "../service.js";
import { graphSnapshot } from "./model.js";
import type { Json } from "../graph.js";

async function requestJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new Error("Request too large");
    chunks.push(buffer);
  }
  // A multibyte character may span HTTP chunks; decode only the complete bounded body.
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

async function resolutionBody(request: IncomingMessage) {
  const value = await requestJson(request, 1024 * 1024) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["id", "waitId", "response"].includes(key)) ||
    typeof value.id !== "string" || typeof value.waitId !== "string" || !Object.hasOwn(value, "response")) throw new Error("Invalid wait resolution");
  return { id: value.id, waitId: value.waitId, response: value.response as Json };
}

async function controlBody(
  request: IncomingMessage,
): Promise<{ id: string; command: "pause" | "resume" | "cancel" }> {
  const value = await requestJson(request, 4096);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["id", "command"].includes(key))
  )
    throw new Error("Invalid request");
  const { id, command } = value as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    !id ||
    !["pause", "resume", "cancel"].includes(String(command))
  )
    throw new Error("Invalid control");
  return { id, command: command as "pause" | "resume" | "cancel" };
}
export async function startGraphServer(
  filename: string,
  runId?: string,
  port = 0,
  options: { stable?: boolean; managerKey?: string; storeId?: string } = {},
) {
  const files = new Map(
    await Promise.all(
      ["index.html", "app.js", "layout.js", "usage-pages.js", "task-scope.js", "style.css"].map(
        async (name) =>
          [name, await readFile(new URL(name, import.meta.url))] as const,
      ),
    ),
  );
  const controller = new RunController(filename),
    store = controller.store;
  try {
    if (runId) store.get(runId);
  } catch (error) {
    controller.close();
    throw error;
  }
  const token = randomBytes(24).toString("hex");
  const activityCache = new Map<
    string,
    { cursor: number; activity: Map<string, WorkerActivity> }
  >();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const expected = `127.0.0.1:${(server.address() as { port: number }).port}`;
    if (request.headers.host !== expected) {
      response.writeHead(403).end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${expected}`),
      prefix = options.stable ? "/" : `/${token}/`;
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    const name = url.pathname.slice(prefix.length) || "index.html";
    const json = (value: unknown, code = 200) => {
      response.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(value));
    };
    if (options.stable) {
      // The management key is kept in a private local file, never in page URLs.
      if (name.startsWith("__dynamicwf/")) {
        if (!options.managerKey || request.headers["x-dynamicwf-manager"] !== options.managerKey || request.headers.origin) {
          json({ error: "Local manager authentication required" }, 403); return;
        }
        if (name === "__dynamicwf/identity" && request.method === "GET") {
          json({ service: "dynamicwf-dashboard", version: 1, storeId: options.storeId }); return;
        }
        if (name === "__dynamicwf/stop" && request.method === "POST") {
          json({ stopped: true });
          server.close(); server.closeIdleConnections(); return;
        }
        json({ error: "Unknown management request" }, 404); return;
      }
      const cookieName = `dynamicwf_view_${(server.address() as { port: number }).port}`;
      const authenticated = (request.headers.cookie ?? "").split(";").some(part => part.trim() === `${cookieName}=${token}`);
      const site = request.headers["sec-fetch-site"];
      const navigation = name === "index.html" && request.method === "GET" &&
        request.headers["sec-fetch-mode"] === "navigate" && request.headers["sec-fetch-dest"] === "document";
      if ((!navigation && site && site !== "none" && site !== "same-origin") ||
          (request.headers.origin && request.headers.origin !== `http://${expected}`)) {
        json({ error: "Open the dashboard directly on this computer" }, 403); return;
      }
      if (name === "index.html" && request.method === "GET") {
        // Only a top-level local navigation can establish a browser session.
        if (!navigation) {
          json({ error: "Open the dashboard in a browser tab" }, 403); return;
        }
        response.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`);
      } else if (!authenticated) {
        json({ error: "Dashboard restarted; reload this page" }, 401); return;
      }
    }
    try {
      if (request.method === "POST" && ["control", "resolve", "reconcile"].includes(name)) {
        if (
          request.headers.origin !== `http://${expected}` ||
          request.headers["content-type"] !== "application/json" ||
          request.headers["x-dynamicwf-view"] !== "1"
        ) {
          json({ error: "Control requires this local page" }, 403);
          return;
        }
        if (name === "reconcile") {
          json(await controller.reconcile(await requestJson(request, 1024 * 1024)));
          return;
        } else if (name === "resolve") {
          const body = await resolutionBody(request);
          await controller.resolve(body.id, body.waitId, body.response, "browser");
        } else {
          const body = await controlBody(request);
          await controller.control(body.id, body.command);
        }
        json({ ok: true });
        return;
      }
      if (request.method !== "GET") {
        json({ error: "Method not allowed" }, 405);
        return;
      }
      if (name === "runs") {
        json({
          initialRun: runId ?? null,
          runs: store
            .listRuns()
            .reverse()
            .map((saved) => {
              const { run, activations, presentation } = controller.snapshot(saved.id);
              return {
                id: run.id, name: run.plan.workflow.name, status: run.status,
                taskOutcome: presentation.taskOutcome, presentation, lineage: run.lineage ?? null,
                createdAt: run.createdAt, cwd: run.cwd, usage: summarizeUsage(activations),
              };
            }),
        });
        return;
      }
      if (name === "snapshot") {
        const id = url.searchParams.get("id") ?? runId;
        if (!id) {
          json({ error: "Select a run" }, 400);
          return;
        }
        const observed = controller.snapshot(id);
        let cache = activityCache.get(id);
        if (!cache) {
          cache = { cursor: 0, activity: new Map() };
          activityCache.set(id, cache);
        }
        const events = store.events(id, cache.cursor);
        collectActivity(events, cache.activity);
        cache.cursor = events.at(-1)?.seq ?? cache.cursor;
        json({
          ...graphSnapshot(
            observed.run,
            observed.activations,
            cache.activity,
            store.waits(id),
            observed.presentation,
            store.transitionSummary(id),
          ),
          supervisorAlive: observed.supervisorAlive,
          workersAlive: observed.workersAlive,
          unresolvedGroups: observed.unresolvedGroups,
        });
        return;
      }
      if (name === "usage") {
        const id = url.searchParams.get("id") ?? runId;
        if (!id) throw new Error("Select a run");
        store.get(id);
        json(store.usageReports(id, Number(url.searchParams.get("after") ?? 0), 100));
        return;
      }
      if (name === "task") {
        const id = url.searchParams.get("id");
        if (!id) throw new Error("Select a task");
        const task = store.task(id), members = store.taskMembers(id);
        json({
          ...task,
          members: members.map(member => {
            const observed = controller.snapshot(member.runId);
            return { ...member, status: observed.run.status, name: observed.run.plan.workflow.name, presentation: observed.presentation, lineage: observed.run.lineage ?? null };
          }),
          receipts: members.flatMap(member => member.receiptId ? [publicReceipt(store.receipt(member.receiptId))] : []),
        });
        return;
      }
      if (name === "task-usage") {
        const id = url.searchParams.get("id");
        if (!id) throw new Error("Select a task");
        const members = store.taskMembers(id);
        json({
          taskId: id,
          ...summarizeTaskUsage(members.map(member => ({ id: member.runId, records: store.listActivations(member.runId) }))),
          ...store.taskUsageReports(id, Number(url.searchParams.get("after") ?? 0), 100),
        });
        return;
      }
      if (name === "recovery") {
        const id = url.searchParams.get("id") ?? runId, key = url.searchParams.get("key");
        if (!id || !key) throw new Error("Select a run and activation key");
        json(await controller.recovery(id, key));
        return;
      }
      if (name === "reconciliations") {
        const id = url.searchParams.get("id") ?? runId;
        if (!id) throw new Error("Select a run");
        json(store.reconciliations(id, url.searchParams.get("key") ?? undefined));
        return;
      }
      if (name === "attempts") {
        const id = url.searchParams.get("id") ?? runId, key = url.searchParams.get("key");
        if (!id || !key) throw new Error("Select a run and activation key");
        json(publicAttempts(store.attempts(id, key, Number(url.searchParams.get("after") ?? 0), 100)));
        return;
      }
      if (name === "retries") {
        const id = url.searchParams.get("id") ?? runId, key = url.searchParams.get("key");
        if (!id || !key) throw new Error("Select a run and activation key");
        json(store.retries(id,key,Number(url.searchParams.get("after")??0),100));
        return;
      }
      if (name === "collections") {
        const id = url.searchParams.get("id") ?? runId, key = url.searchParams.get("key");
        if (!id || !key) throw new Error("Select a run and activation key");
        json(store.collections(id, key, Number(url.searchParams.get("after") ?? 0), 100));
        return;
      }
      if (name === "trace") {
        const id = url.searchParams.get("id") ?? runId;
        if (!id) throw new Error("Select a run");
        json({ planHash: store.get(id).plan.hash, summary: store.transitionSummary(id), ...store.transitions(id, Number(url.searchParams.get("after") ?? 0), 100) });
        return;
      }
      const body = files.get(name);
      if (!body) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader(
        "Content-Type",
        name.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : name.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8",
      );
      response.end(body);
    } catch (error) {
      json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Журнал временно недоступен",
        },
        400,
      );
    }
  });
  server.on("close", () => controller.close());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    controller.close();
    throw error;
  }
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}${options.stable ? "/" : `/${token}/`}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
