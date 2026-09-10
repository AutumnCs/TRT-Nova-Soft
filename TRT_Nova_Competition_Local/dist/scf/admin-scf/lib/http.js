const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': process.env.ADMIN_CORS_ORIGIN || '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS'
};

export function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      ...JSON_HEADERS,
      ...headers
    },
    body: JSON.stringify(body)
  };
}

export function getRequestMethod(event = {}) {
  return String(event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
}

export function getRequestPath(event = {}) {
  const value = event.path || event.rawPath || '/';
  return value.startsWith('/admin') ? value.slice('/admin'.length) || '/' : value;
}

export function createHttpResponder() {
  return {
    unauthorized() {
      return json(401, { error: 'unauthorized' });
    },
    notFound() {
      return json(404, { error: 'not_found' });
    }
  };
}
