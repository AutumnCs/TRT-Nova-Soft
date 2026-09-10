function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  };
}

function getMethod(event) {
  return (
    event?.httpMethod ||
    event?.requestContext?.http?.method ||
    ''
  ).toUpperCase();
}

function getPath(event) {
  return (
    event?.path ||
    event?.requestContext?.path ||
    event?.requestContext?.http?.path ||
    ''
  );
}

function getHeaders(event) {
  return event?.headers || {};
}

function getBody(event) {
  if (event?.body === undefined || event?.body === null) return {};
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (err) {
      return {};
    }
  }
  return typeof event.body === 'object' ? event.body : {};
}

module.exports = {
  json,
  getBody,
  getHeaders,
  getMethod,
  getPath
};
