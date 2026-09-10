import { execFileSync } from "node:child_process";

export interface GroupProcess { pid: number; parentPid: number; groupPid: number; state: string }
/** No command lines or environment are collected for group membership. */
export function processGroups(): GroupProcess[] {
  const output = execFileSync("ps", ["-ax", "-o", "pid=,ppid=,pgid=,stat="], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return parseProcessGroups(output);
}
export function parseProcessGroups(output: string): GroupProcess[] {
  return output.split("\n").filter(line => line.trim()).map(line => {
    const fields = line.trim().split(/\s+/);
    const [pid, parentPid, groupPid] = fields.slice(0, 3).map(Number);
    if (fields.length !== 4 || !Number.isSafeInteger(pid) || pid! <= 0 || !Number.isSafeInteger(parentPid) || parentPid! < 0 ||
      !Number.isSafeInteger(groupPid) || groupPid! < 0 || !/^[A-Za-z?+<>-]+$/.test(fields[3]!)) throw new Error(`Invalid OS process group observation (${JSON.stringify(fields)})`);
    return { pid: pid!, parentPid: parentPid!, groupPid: groupPid!, state: fields[3]! };
  });
}
/** A zombie cannot perform more work. Group membership alone does not certify ownership. */
export function groupMembers(groupPid: number, processes = processGroups()): GroupProcess[] {
  return processes.filter(item => item.groupPid === groupPid && !item.state.startsWith("Z"));
}
