import type { ChildProcess } from "node:child_process";
/** Ожидание exit и обоих pipe: IPC disconnect может не породить child.close. */
export function drainedChild(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let exited = false, code: number | null = null;
    let outDone = !child.stdout || child.stdout.destroyed, errDone = !child.stderr || child.stderr.destroyed;
    const check = () => { if (exited && outDone && errDone) resolve(code); };
    child.once("error", reject);
    child.once("exit", value => { exited = true; code = value; check(); });
    for (const event of ["end", "close"] as const) {
      child.stdout?.once(event, () => { outDone = true; check(); });
      child.stderr?.once(event, () => { errDone = true; check(); });
    }
  });
}
