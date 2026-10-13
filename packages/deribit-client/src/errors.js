/** Error returned by the Deribit API (a JSON-RPC `error` object). */
export class DeribitError extends Error {
  constructor(method, { code, message, data } = {}) {
    const reason = data?.reason ? ` (${data.param ? `${data.param}: ` : ''}${data.reason})` : '';
    super(`${method}: ${message ?? 'unknown error'} [${code}]${reason}`);
    this.name = 'DeribitError';
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

/** Params rejected locally against the spec, before any request was sent. */
export class DeribitValidationError extends Error {
  constructor(method, problems) {
    super(`${method}: ${problems.join('; ')}`);
    this.name = 'DeribitValidationError';
    this.method = method;
    this.problems = problems;
  }
}

/** Transport failure: network error, timeout, non-JSON response or dropped socket. */
export class DeribitTransportError extends Error {
  constructor(method, message, { status, cause } = {}) {
    super(`${method}: ${message}`, { cause });
    this.name = 'DeribitTransportError';
    this.method = method;
    this.status = status;
  }
}
