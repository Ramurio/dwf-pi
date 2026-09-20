import { executionFailure, ExecutionFailure } from "./execution-failure.js";

/** Сохраняет обе причины, не маскируя ошибку действия ошибкой освобождения ресурсов. */
export class ProcessCleanupError extends Error {
  constructor(readonly primary: Error | undefined, readonly cleanup: ExecutionFailure) {
    super(primary ? `${primary.message}; ${cleanup.message}` : cleanup.message);
    this.name = "ProcessCleanupError";
  }
}
export async function withProcessCleanup<A>(work: () => Promise<A>, cleanup: () => void): Promise<A> {
  let primary: Error | undefined;
  try { return await work(); }
  catch (error) { primary = error instanceof Error ? error : new Error(String(error)); throw primary; }
  finally {
    try { cleanup(); }
    catch (error) {
      const failure = error instanceof ExecutionFailure && error.failure.phase === "cleanup" ? error
        : executionFailure("uncertain-effect", "cleanup", "unknown", "Worker cleanup could not confirm process settlement");
      throw new ProcessCleanupError(primary, failure);
    }
  }
}
