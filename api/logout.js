// api/logout.js
// Wist de sessie-cookie en stuurt door naar de loginpagina.

import { clearSessionCookie } from '../utils/auth.js';

export default async function handler(req, res) {
  clearSessionCookie(res, req);
  res.statusCode = 302;
  res.setHeader('Location', '/api/login');
  res.end();
}
