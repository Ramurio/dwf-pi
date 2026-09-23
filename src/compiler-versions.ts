/** Central version feature predicates. Do not hard-code current-only lists at call sites. */
export const compilerVersion = "dynamicwf-effect-v10";
export const runtimeVersion = "dynamicwf-runtime-v10";
export const compilerVersions = [
  "dynamicwf-effect-v1", "dynamicwf-effect-v2", "dynamicwf-effect-v3", "dynamicwf-effect-v4",
  "dynamicwf-effect-v5", "dynamicwf-effect-v6", "dynamicwf-effect-v7", "dynamicwf-effect-v8", "dynamicwf-effect-v9", compilerVersion,
] as const;
export const runtimeVersions = [
  "dynamicwf-runtime-v1", "dynamicwf-runtime-v2", "dynamicwf-runtime-v3", "dynamicwf-runtime-v4",
  "dynamicwf-runtime-v5", "dynamicwf-runtime-v6", "dynamicwf-runtime-v7", "dynamicwf-runtime-v8", "dynamicwf-runtime-v9", runtimeVersion,
] as const;
export type CompilerVersion = typeof compilerVersions[number];
export type RuntimeVersion = typeof runtimeVersions[number];

function indexOf<T extends readonly string[]>(list: T, value: string): number {
  return (list as readonly string[]).indexOf(value);
}
export function isCompilerVersion(value: string): value is CompilerVersion {
  return indexOf(compilerVersions, value) >= 0;
}
export function isRuntimeVersion(value: string): value is RuntimeVersion {
  return indexOf(runtimeVersions, value) >= 0;
}
export function compilerAtLeast(version: string, minimum: CompilerVersion): boolean {
  const current = indexOf(compilerVersions, version), need = indexOf(compilerVersions, minimum);
  return current >= 0 && need >= 0 && current >= need;
}
export function runtimeAtLeast(version: string, minimum: RuntimeVersion): boolean {
  const current = indexOf(runtimeVersions, version), need = indexOf(runtimeVersions, minimum);
  return current >= 0 && need >= 0 && current >= need;
}
export function pairedRuntime(compiler: string): RuntimeVersion | undefined {
  const index = indexOf(compilerVersions, compiler);
  return index >= 0 ? runtimeVersions[index] : undefined;
}
export function isCompatiblePlanPair(runtime: string, compiler: string): boolean {
  return pairedRuntime(compiler) === runtime && isRuntimeVersion(runtime);
}
export function supportsFinishAwait(version: string): boolean { return compilerAtLeast(version, "dynamicwf-effect-v2"); }
export function supportsGeneratedRouting(version: string): boolean { return compilerAtLeast(version, "dynamicwf-effect-v3"); }
export function supportsOutputRepair(version: string): boolean { return compilerAtLeast(version, "dynamicwf-effect-v4") || runtimeAtLeast(version, "dynamicwf-runtime-v4"); }
export function supportsFailurePolicy(version: string): boolean { return compilerAtLeast(version, "dynamicwf-effect-v5"); }
export function supportsRetryPolicy(version: string): boolean { return compilerAtLeast(version, "dynamicwf-effect-v6"); }
export function supportsProviderRetry(version: string): boolean { return compilerAtLeast(version, "dynamicwf-effect-v7"); }
export function supportsFrozenCapabilities(version: string): boolean {
  return compilerAtLeast(version, "dynamicwf-effect-v8") || runtimeAtLeast(version, "dynamicwf-runtime-v8");
}
export function supportsReuseNodes(version: string): boolean {
  return compilerAtLeast(version, "dynamicwf-effect-v9") || runtimeAtLeast(version, "dynamicwf-runtime-v9");
}

export function supportsAtomicOperationAdmission(version: string): boolean {
  return compilerAtLeast(version, "dynamicwf-effect-v10") || runtimeAtLeast(version, "dynamicwf-runtime-v10");
}
