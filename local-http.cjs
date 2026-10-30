'use strict';
const http = require('node:http');
const { Readable } = require('node:stream');

// Local inference may remain silent while loading or processing the prompt.
// Use explicit caller cancellation instead of fetch's implicit idle deadlines.
function localFetch(url, { method = 'GET', headers, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers, signal, timeout: 0 }, response => {
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode,
        headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined))
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}
module.exports = { localFetch };
