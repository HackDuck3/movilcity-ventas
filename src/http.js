'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

const routes = [];

// access: 'public' | 'user' | 'admin'. Path params are written as ":id".
// options.raw leaves the request body unread so the handler can stream it.
function route(method, path, access, handler, options = {}) {
  const keys = [];
  const pattern = path.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
  routes.push({ method, re: new RegExp(`^${pattern}$`), keys, access, handler, raw: !!options.raw });
}

module.exports = { HttpError, fail, routes, route };
