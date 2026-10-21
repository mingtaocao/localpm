// Runs inside a fresh QuickJS VM. No browser, Node, network or native host bindings.
function runLocalpmScript(input) {
  "use strict";
  const patches = [],
    tests = [],
    logs = [];
  const scopes = input.scopes;
  const locals = Object.assign(Object.create(null), input.locals || {});
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = (message) => {
    throw new Error(message);
  };
  const stringify = (value) => {
    if (value === undefined || value === null)
      return fail(
        "Variable value is null or undefined; check the response field path",
      );
    const text =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    if (text.length > 65536) fail("Variable value exceeds 64 KiB");
    return text;
  };
  function scope(name, available) {
    const values = Object.assign(Object.create(null), scopes[name]);
    scopes[name] = values;
    return {
      get: (key) => (own(values, key) ? values[key] : undefined),
      has: (key) => own(values, key),
      set(key, value) {
        if (!available)
          fail(
            "Select an environment or save this request in a collection before writing " +
              name,
          );
        key = String(key);
        if (!key || key.length > 256)
          fail("Variable name must contain 1–256 characters");
        if (patches.length >= 200) fail("Script variable write limit exceeded");
        const text = stringify(value);
        values[key] = text;
        patches.push({ scope: name, key, value: text });
      },
      unset(key) {
        if (!available) fail("Variable scope is unavailable: " + name);
        if (patches.length >= 200) fail("Script variable write limit exceeded");
        key = String(key);
        delete values[key];
        patches.push({ scope: name, key, value: null });
      },
      toObject: () => Object.assign({}, values),
    };
  }
  const environment = scope("environment", input.environmentId !== null);
  const collectionVariables = scope("collection", input.collectionId !== null);
  const globals = scope("global", true);
  const all = () =>
    Object.assign(
      Object.create(null),
      scopes.global,
      scopes.collection,
      scopes.environment,
      locals,
    );
  function replaceIn(text, stack = []) {
    return String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
      if (stack.includes(key) || stack.length >= 10)
        fail("Variable cycle or depth limit: " + key);
      const values = all();
      if (!own(values, key)) fail("Unresolved variable: " + key);
      return replaceIn(values[key], stack.concat(key));
    });
  }
  function expect(actual) {
    const chain = new Proxy(
      {},
      {
        get(target, key, receiver) {
          if (key === "then") return undefined;
          if (!Reflect.has(target, key))
            fail("Unsupported assertion: " + String(key));
          return Reflect.get(target, key, receiver);
        },
      },
    );
    for (const word of ["to", "be", "have", "and", "that", "is"])
      Object.defineProperty(chain, word, { get: () => chain });
    chain.equal = (value) => {
      if (actual !== value) fail("Expected values to be equal");
      return chain;
    };
    chain.eql = (value) => {
      if (JSON.stringify(actual) !== JSON.stringify(value))
        fail("Expected values to be deeply equal");
      return chain;
    };
    chain.deep = { equal: chain.eql };
    chain.include = (value) => {
      if (!actual?.includes?.(value))
        fail("Expected value to include the supplied item");
      return chain;
    };
    chain.property = (key) => {
      if (actual == null || !own(Object(actual), key))
        fail("Expected property: " + key);
      return expect(actual[key]);
    };
    chain.a = chain.an = (type) => {
      if (
        (Array.isArray(actual)
          ? "array"
          : actual === null
            ? "null"
            : typeof actual) !== type
      )
        fail("Expected type: " + type);
      return chain;
    };
    chain.below = (value) => {
      if (!(actual < value)) fail("Expected a smaller value");
      return chain;
    };
    for (const [key, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
      ["undefined", undefined],
    ])
      Object.defineProperty(chain, key, {
        get() {
          chain.equal(value);
          return chain;
        },
      });
    return chain;
  }
  const request = input.request;
  const headers = {
    get: (key) =>
      request.headers.find(
        (p) => p.enabled && p.key.toLowerCase() === String(key).toLowerCase(),
      )?.value,
    upsert(pair) {
      if (!pair || typeof pair.key !== "string")
        fail("headers.upsert requires { key, value }");
      const old = request.headers.find(
        (p) => p.key.toLowerCase() === pair.key.toLowerCase(),
      );
      if (old) {
        old.value = String(pair.value);
        old.enabled = true;
      } else
        request.headers.push({
          key: pair.key,
          value: String(pair.value),
          enabled: true,
          description: "",
        });
    },
    add(pair) {
      this.upsert(pair);
    },
    remove(key) {
      request.headers = request.headers.filter(
        (p) => p.key.toLowerCase() !== String(key).toLowerCase(),
      );
    },
  };
  const url = {
    toString: () => request.url,
    update(value) {
      request.url = String(value);
      request.params = [];
    },
  };
  const response = input.response;
  const responseBody = () => {
    if (
      !response ||
      response.truncated ||
      response.binary ||
      response.body.length > 5 * 1024 * 1024
    )
      fail(
        "Response body is unavailable, binary, or exceeds the script limit (5 MiB)",
      );
    return response.body;
  };
  const pm = {
    environment,
    collectionVariables,
    globals,
    variables: {
      get: (key) => all()[key],
      has: (key) => own(all(), key),
      set: (key, value) => {
        locals[String(key)] = stringify(value);
      },
      unset: (key) => {
        delete locals[key];
      },
      toObject: () => Object.assign({}, all()),
      replaceIn,
    },
    request: {
      headers,
      body: request.body,
      get url() {
        return url;
      },
      set url(value) {
        url.update(value);
      },
    },
    response: response
      ? {
          code: response.status,
          status: response.statusText,
          responseTime: response.duration,
          headers: {
            get: (key) =>
              response.headers.find(
                (p) => p[0].toLowerCase() === String(key).toLowerCase(),
              )?.[1],
          },
          json: () => JSON.parse(responseBody()),
          text: responseBody,
          to: {
            have: { status: (code) => expect(response.status).equal(code) },
          },
        }
      : undefined,
    expect,
    test(name, callback) {
      if (tests.length >= 200) fail("Script test limit exceeded");
      try {
        if (typeof callback !== "function" || callback.length)
          fail("Only synchronous pm.test callbacks are supported");
        const result = callback();
        if (result && typeof result.then === "function")
          fail("Async tests are not supported");
        tests.push({ name: String(name).slice(0, 256), passed: true });
      } catch (error) {
        tests.push({
          name: String(name).slice(0, 256),
          passed: false,
          error: String(error.message).slice(0, 1024),
        });
      }
    },
    sendRequest() {
      fail(
        "Unsupported API: pm.sendRequest. Send the saved second request using {{variable}}.",
      );
    },
  };
  let logSize = 0;
  const console = {};
  for (const level of ["log", "info", "warn", "error"])
    console[level] = (...values) => {
      if (logs.length >= 200 || logSize >= 65536) return;
      const message = values
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join(" ")
        .slice(0, 2048);
      logSize += message.length;
      logs.push({ level, message });
    };
  try {
    const result = new Function(
      "pm",
      "console",
      '"use strict";\n' + input.code + "\n//# sourceURL=localpm-script.js",
    )(pm, console);
    if (result && typeof result.then === "function")
      fail("Async scripts are not supported");
    return JSON.stringify({
      patches,
      redactions: patches,
      tests,
      logs,
      locals,
      request,
    });
  } catch (error) {
    return JSON.stringify({
      patches: [],
      redactions: patches,
      tests,
      logs,
      locals: input.locals,
      request: input.request,
      error: String(error.message).slice(0, 2048),
      stack: String(error.stack).slice(0, 2048),
    });
  }
}
