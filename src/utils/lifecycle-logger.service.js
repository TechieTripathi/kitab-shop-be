const redact = (value) => {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /token|secret|password|signature|key/i.test(key) ? "[redacted]" : item,
    ]),
  );
};

export const logLifecycleEvent = (scope, event, details = {}) => {
  const payload = {
    scope,
    event,
    at: new Date().toISOString(),
    ...redact(details),
  };
  console.log(JSON.stringify(payload));
};

export const logLifecycleError = (scope, event, error, details = {}) => {
  const payload = {
    scope,
    event,
    at: new Date().toISOString(),
    level: "error",
    message: error?.message || String(error),
    ...redact(details),
  };
  console.error(JSON.stringify(payload));
};
