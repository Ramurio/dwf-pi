import assert from "node:assert/strict";
import test from "node:test";
import { parseUsage } from "../src/usage.js";

const required = ["input", "output", "totalTokens"] as const;
const optional = ["cacheRead", "cacheWrite", "reasoning", "cost"] as const;
const recognized = [...required, ...optional, "partialFields"];
const base = () => ({ input: 1.5, output: 2.5, totalTokens: 17 });

test("plain SDK and null-prototype usage preserve numbers and optional normalization", () => {
  for (const prototype of [Object.prototype, null]) {
    const value = Object.assign(Object.create(prototype), base(), { sdkExtra: { arbitrary: true } });
    const extend = (fields: object) => Object.assign(Object.create(prototype), value, fields);
    assert.deepEqual(parseUsage(value), base());
    for (const name of optional) {
      assert.deepEqual(parseUsage(extend({ [name]: undefined })), base());
      assert.deepEqual(parseUsage(extend({ [name]: 0 })), { ...base(), [name]: 0 });
      assert.deepEqual(parseUsage(extend({ [name]: 0, partialFields: [name] })), { ...base(), [name]: 0, partialFields: [name] });
      assert.equal(parseUsage(extend({ [name]: undefined, partialFields: [name] })), undefined);
      assert.equal(parseUsage(extend({ partialFields: [name] })), undefined);
    }
    for (const partialFields of [undefined, []]) assert.deepEqual(parseUsage(extend({ partialFields })), base());
  }
});

test("required fields and all numeric fields reject invalid numbers without coercion", () => {
  for (const name of required) {
    const value: Record<string, unknown> = base(); delete value[name];
    assert.equal(parseUsage(value), undefined);
    assert.equal(parseUsage({ ...base(), [name]: undefined }), undefined);
  }
  for (const name of [...required, ...optional]) {
    for (const invalid of [NaN, Infinity, -Infinity, -1, null, "0", true, {}, [], 1n]) {
      assert.equal(parseUsage({ ...base(), [name]: invalid }), undefined);
    }
    assert.equal(parseUsage({ ...base(), [name]: 0 })?.[name], 0);
    assert.equal(parseUsage({ ...base(), [name]: 0.25 })?.[name], 0.25);
  }
});

test("each recognized field rejects inherited, accessor and hidden representations without getters", () => {
  let calls = 0;
  for (const name of recognized) {
    const valid = name === "partialFields" ? [] : 0;
    for (const descriptor of [
      { get() { calls++; return valid; } },
      { get() { calls++; return undefined; } },
      { get() { calls++; throw new Error("must not execute"); } },
      { set(_value: unknown) { calls++; } },
      { value: valid, enumerable: false },
    ]) {
      const value = base();
      Object.defineProperty(value, name, { configurable: true, enumerable: true, ...descriptor });
      assert.equal(parseUsage(value), undefined, name);
    }
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, name);
    try {
      for (const descriptor of [{ value: valid }, { get() { calls++; return valid; } }]) {
        Object.defineProperty(Object.prototype, name, { configurable: true, ...descriptor });
        const value: Record<string, unknown> = base(); delete value[name];
        assert.equal(parseUsage(value), undefined, name);
      }
    } finally {
      if (previous) Object.defineProperty(Object.prototype, name, previous);
      else Reflect.deleteProperty(Object.prototype, name);
    }
  }
  assert.equal(calls, 0);
});

test("nonplain roots are rejected", () => {
  class Usage { input = 1; output = 2; totalTokens = 3; }
  for (const value of [null, undefined, 0, "usage", [], new Usage(), new Date(), new Map(), Object.assign(Object.create(base()), base()), Object.assign(Object.setPrototypeOf([], null), base())]) {
    assert.equal(parseUsage(value), undefined);
  }
});

test("partialFields requires dense own enumerable data indices and never invokes array hooks", () => {
  let calls = 0;
  const accessor = ["cost"];
  Object.defineProperty(accessor, "0", { get() { calls++; throw new Error("getter"); } });
  const hidden = ["cost"]; Object.defineProperty(hidden, "0", { enumerable: false });
  const inherited = new Array(1); Object.setPrototypeOf(inherited, { 0: "cost" });
  for (const partialFields of [null, {}, "cost", ["cost", "cost"], ["input"], ["unknown"], [0], [undefined], new Array(1), inherited, accessor, hidden]) {
    assert.equal(parseUsage({ ...base(), cost: 0, partialFields }), undefined);
  }
  const partialFields = ["cost", "cacheRead"];
  for (const name of ["some", Symbol.iterator]) Object.defineProperty(partialFields, name, { get() { calls++; throw new Error("hook"); } });
  const input = { ...base(), cost: 0, cacheRead: 2, partialFields };
  const result = parseUsage(input)!;
  assert.deepEqual(result, { ...base(), cacheRead: 2, cost: 0, partialFields: ["cost", "cacheRead"] });
  input.cost = 9; partialFields[0] = "reasoning";
  assert.equal(result.cost, 0); assert.equal(result.partialFields![0], "cost");
  result.partialFields![1] = "cost"; result.cacheRead = 8;
  assert.equal(input.cacheRead, 2); assert.equal(partialFields[1], "cacheRead");
  assert.equal(calls, 0);
});

// Keep pollution synchronous and restore before assertions (including failed parses).
function underAccessor(name: string, descriptor: PropertyDescriptor, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, name);
  let result: ReturnType<typeof parseUsage>, error: unknown;
  try {
    Object.defineProperty(Object.prototype, name, { configurable: true, ...descriptor });
    try { result = parseUsage(value); } catch (reason) { error = reason; }
  } finally {
    if (previous) Object.defineProperty(Object.prototype, name, previous);
    else Reflect.deleteProperty(Object.prototype, name);
  }
  return { result, error };
}

for (const name of recognized) for (const mode of ["get", "set", "both"] as const) {
  test(`result owns ${name} without inherited ${mode}`, () => {
    const value = { ...base(), cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, partialFields: [...optional] };
    let gets = 0, sets = 0;
    const descriptor = {
      ...(mode !== "set" ? { get() { gets++; return 0; } } : {}),
      ...(mode !== "get" ? { set(_value: unknown) { sets++; } } : {}),
    };
    const { result, error } = underAccessor(name, descriptor, value);
    assert.equal(error, undefined);
    assert.deepEqual({ gets, sets }, { gets: 0, sets: 0 });
    assert.ok(result);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    for (const field of recognized) assert.deepEqual(Object.getOwnPropertyDescriptor(result, field), {
      value: value[field as keyof typeof value], enumerable: true, writable: true, configurable: true,
    });
  });
}

for (const prototype of [Object.prototype, null]) for (const name of optional) for (const missing of [false, true]) for (const throwing of [false, true]) {
  test(`linked ${prototype === null ? "null-prototype" : "plain"} ${name} rejects ${missing ? "absent" : "undefined"} without ${throwing ? "throwing" : "zero"} getter`, () => {
    const value = Object.assign(Object.create(prototype), base(), { partialFields: [name] }, missing ? {} : { [name]: undefined });
    let calls = 0;
    const { result, error } = underAccessor(name, { get() {
      calls++; if (throwing) throw new Error("inherited getter"); return 0;
    } }, value);
    assert.equal(calls, 0);
    assert.equal(error, undefined);
    assert.equal(result, undefined);
  });
}

test("frozen plain and null-prototype inputs preserve descriptors and copy partial fields", () => {
  for (const prototype of [Object.prototype, null]) {
    const partialFields = Object.freeze([...optional]);
    const value = Object.freeze(Object.assign(Object.create(prototype), base(), {
      cacheRead: 0, cacheWrite: 0.25, reasoning: 2, cost: 0, partialFields, sdkExtra: true,
    }));
    const before = Object.getOwnPropertyDescriptors(value);
    const arrayBefore = Object.getOwnPropertyDescriptors(partialFields);
    const result = parseUsage(value)!;
    assert.deepEqual(result, { ...base(), cacheRead: 0, cacheWrite: 0.25, reasoning: 2, cost: 0, partialFields: [...optional] });
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.notEqual(result.partialFields, partialFields);
    assert.deepEqual(Object.getOwnPropertyDescriptors(value), before);
    assert.deepEqual(Object.getOwnPropertyDescriptors(partialFields), arrayBefore);
  }
});
