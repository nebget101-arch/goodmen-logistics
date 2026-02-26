const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function authMiddleware(roles = []) {
  // roles: array of allowed roles, or empty for any authenticated user
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Missing token' });
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Invalid token' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (roles.length) {
        const role = (payload.role || '').toString().trim().toLowerCase();
        const allowed = roles.map(r => r.toString().trim().toLowerCase());
        if (!allowed.includes(role)) {
          return res.status(403).json({ error: 'Forbidden: insufficient role' });
        }
      }
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = authMiddleware;
