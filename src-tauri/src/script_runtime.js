// The returned result function stays in Rust; scripts cannot access the journal.
(function (inputText) {
  const input = JSON.parse(inputText);
  const stringify = JSON.stringify.bind(JSON);
  const parse = JSON.parse.bind(JSON);
  const changes = [],
    logs = [],
    tests = [];
  const scopes = input.scopes;
  let count = 0;
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const text = (value) =>
    typeof value === "string" ? value : (stringify(value) ?? String(value));
  const validKey = (key) => {
    if (typeof key !== "string" || !key.trim() || key.length > 1024)
      throw new Error(
        "Variable name must be a nonempty string (max 1024 characters)",
      );
    return key;
  };
  const scope = (name) =>
    Object.freeze({
      get(key) {
        return own(scopes[name], String(key))
          ? scopes[name][String(key)]
          : undefined;
      },
      has(key) {
        return own(scopes[name], String(key));
      },
      toObject() {
        return parse(stringify(scopes[name]));
      },
      set(key, value) {
        validKey(key);
        if (name === "environment" && !input.environmentId)
          throw new Error(
            "Select an environment before writing environment variables",
          );
        if (name === "collection" && !input.collectionId)
          throw new Error("This request does not belong to a collection");
        const valueText = String(value);
        if (valueText.length > 262144 || ++count > 1000)
          throw new Error("Script variable write limit exceeded");
        Object.defineProperty(scopes[name], key, {
          value: valueText,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        if (name !== "local")
          changes.push({ scope: name, key, value: valueText });
      },
      unset(key) {
        validKey(key);
        if (name === "environment" && !input.environmentId)
          throw new Error(
            "Select an environment before writing environment variables",
          );
        if (name === "collection" && !input.collectionId)
          throw new Error("This request does not belong to a collection");
        if (++count > 1000)
          throw new Error("Script variable write limit exceeded");
        delete scopes[name][key];
        if (name !== "local") changes.push({ scope: name, key, value: null });
      },
    });
  const globals = scope("global"),
    environment = scope("environment"),
    collection = scope("collection"),
    local = scope("local");
  const get = (key) => {
    for (const name of ["local", "environment", "collection", "global"])
      if (own(scopes[name], key)) return scopes[name][key];
  };
  const replaceIn = (str) => {
    const resolve = (str, stack) =>
      String(str).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
        if (stack.includes(key) || stack.length >= 10)
          throw new Error("Variable cycle or depth limit: " + key);
        const value = get(key);
        return value === undefined ? match : resolve(value, [...stack, key]);
      });
    return resolve(str, []);
  };
  const headers = (pairs) =>
    Object.freeze({
      get(name) {
        const p = pairs.find(
          (p) => p[0].toLowerCase() === String(name).toLowerCase(),
        );
        return p?.[1];
      },
      has(name) {
        return this.get(name) !== undefined;
      },
      all() {
        return pairs.map(([key, value]) => ({ key, value }));
      },
    });
  const assert = (ok, message) => {
    if (!ok) throw new Error(message || "Assertion failed");
  };
  const deepEqual = (a, b) => {
    if (Object.is(a, b)) return true;
    if (
      !a ||
      !b ||
      typeof a !== "object" ||
      typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)
    )
      return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => own(b, k) && deepEqual(a[k], b[k]))
    );
  };
  const expect = (value, message) => {
    let deep = false;
    const chain = {
      equal(other) {
        assert(
          deep ? deepEqual(value, other) : value === other,
          message || `Expected ${text(value)} to equal ${text(other)}`,
        );
        return chain;
      },
      eql(other) {
        assert(
          deepEqual(value, other),
          message || "Values are not deeply equal",
        );
        return chain;
      },
      property(key) {
        assert(
          value != null && key in Object(value),
          message || "Missing property: " + key,
        );
        return expect(value[key]);
      },
      a(type) {
        assert(
          (Array.isArray(value)
            ? "array"
            : value === null
              ? "null"
              : typeof value) === type,
          message || "Unexpected type",
        );
        return chain;
      },
      include(other) {
        assert(
          value?.includes?.(other),
          message || "Value does not include expected value",
        );
        return chain;
      },
      below(other) {
        assert(
          typeof value === "number" && value < other,
          message || `Expected ${value} to be below ${other}`,
        );
        return chain;
      },
    };
    chain.an = chain.a;
    for (const k of ["to", "be", "have", "and"])
      Object.defineProperty(chain, k, { get: () => chain });
    Object.defineProperty(chain, "deep", {
      get: () => {
        deep = true;
        return chain;
      },
    });
    for (const [name, ok] of [
      ["ok", !!value],
      ["true", value === true],
      ["false", value === false],
    ]) {
      Object.defineProperty(chain, name, {
        get: () => {
          assert(ok, message || `Expected ${name}`);
          return chain;
        },
      });
    }
    return chain;
  };
  const freeze = (value) => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  const response = input.response;
  const pm = {
    globals,
    environment,
    collectionVariables: collection,
    variables: Object.freeze({
      ...local,
      get,
      has: (key) => get(key) !== undefined,
      replaceIn,
      toObject: () => ({
        ...scopes.global,
        ...scopes.collection,
        ...scopes.environment,
        ...scopes.local,
      }),
    }),
    request: freeze(input.request),
    info: Object.freeze({
      eventName: input.phase === "prerequest" ? "prerequest" : "test",
      requestName: input.request.name,
    }),
    expect,
    test(name, fn) {
      if (tests.length >= 100) throw new Error("Script test limit exceeded");
      try {
        const v = fn();
        if (v && typeof v.then === "function")
          throw new Error("Async tests are not supported");
        tests.push({ name: String(name), passed: true });
      } catch (e) {
        tests.push({
          name: String(name),
          passed: false,
          error: String(e.message || e).slice(0, 4096),
        });
      }
    },
  };
  if (response)
    pm.response = Object.freeze({
      code: response.status,
      status: response.statusText,
      responseTime: response.duration,
      responseSize: response.size,
      headers: headers(response.headers),
      to: Object.freeze({
        have: Object.freeze({
          status: (code) =>
            assert(
              response.status === code,
              `Expected status ${code}, got ${response.status}`,
            ),
        }),
      }),
      text() {
        if (response.binary || response.truncated)
          throw new Error("Response is binary or truncated");
        return response.body;
      },
      json() {
        return parse(this.text());
      },
    });
  const log =
    (level) =>
    (...args) => {
      if (logs.length >= 100) throw new Error("Script log limit exceeded");
      logs.push({ level, message: args.map(text).join(" ").slice(0, 4096) });
    };
  Object.defineProperty(globalThis, "pm", {
    value: Object.freeze(pm),
    configurable: false,
    writable: false,
  });
  Object.defineProperty(globalThis, "console", {
    value: Object.freeze({
      log: log("log"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
    }),
    configurable: false,
    writable: false,
  });
  return () => stringify({ changes, logs, tests, local: scopes.local });
});
