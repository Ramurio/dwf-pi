/** Only bounded numeric HTTP observations cross the public failure boundary. */
export interface ProviderResponseRecord { status: number; retryAfterMs?: number }
export function providerResponseSummary(response: ProviderResponseRecord | undefined): string {
  return response ? ` · HTTP ${response.status}${response.retryAfterMs===undefined?"":` · Retry-After ${response.retryAfterMs} ms`}` : "";
}
export function parseProviderResponse(value: unknown): ProviderResponseRecord | undefined {
  if (!value || typeof value !== "object" || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return;
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
  if (!keys.includes("status") || keys.some(key=>typeof key!=="string" || !["status","retryAfterMs"].includes(key) || !fields[key]?.enumerable || !Object.hasOwn(fields[key]!,"value"))) return;
  const record=value as ProviderResponseRecord;
  if (!Number.isInteger(record.status) || record.status<100 || record.status>599) return;
  if (Object.hasOwn(record,"retryAfterMs") && (!Number.isSafeInteger(record.retryAfterMs) || record.retryAfterMs!<0)) return;
  return {status:record.status,...(record.retryAfterMs===undefined?{}:{retryAfterMs:record.retryAfterMs})};
}
/** Delta-seconds or IMF-fixdate. Malformed/unsafe values remain unknown. */
export function retryAfterMs(value: string | null | undefined, now=Date.now()): number | undefined {
  if (!value) return;
  const input=value.trim();
  if (/^\d+$/.test(input)) {
    const milliseconds=Number(input)*1000;
    return Number.isSafeInteger(milliseconds)?milliseconds:undefined;
  }
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(input)) return;
  const target=Date.parse(input);
  // Reject normalized invalid dates as well as misleading weekday names.
  if (!Number.isFinite(target) || new Date(target).toUTCString()!==input) return;
  const milliseconds=Math.max(0,target-now);
  return Number.isSafeInteger(milliseconds)?milliseconds:undefined;
}
export function observeProviderResponse(status: number, retryAfter: string | null | undefined, now=Date.now()): ProviderResponseRecord | undefined {
  const delay=retryAfterMs(retryAfter,now);
  return parseProviderResponse({status,...(delay===undefined?{}:{retryAfterMs:delay})});
}
