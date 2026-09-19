import type { CredentialStore } from "@earendil-works/pi-ai";

/** Keep a completed mutation inside its original store lock despite caller cancellation. */
export function preserveCredentialPersistence(store: CredentialStore): CredentialStore {
  return {
    read: (provider, options) => store.read(provider, options),
    list: options => store.list(options),
    delete: (provider, options) => store.delete(provider, options),
    async modify(provider, fn, options) {
      const caller = options?.signal;
      if (!caller) return store.modify(provider, fn, options);
      caller.throwIfAborted();
      const persist = new AbortController();
      let mutationStarted = false;
      const abort = () => { if (!mutationStarted) persist.abort(caller.reason); };
      caller.addEventListener("abort", abort, { once: true });
      try {
        const result = await store.modify(provider, current => {
          mutationStarted = true;
          return fn(current);
        }, { ...options, signal: persist.signal });
        caller.throwIfAborted();
        return result;
      } finally {
        caller.removeEventListener("abort", abort);
      }
    },
  };
}
