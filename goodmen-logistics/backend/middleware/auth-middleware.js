const jwt = require('jsonwebtoken');
const dtLogger = require('../utils/dynatrace-logger');

/**
 * Authentication middleware
 * Extracts user info from JWT token in Authorization header
 * Sets req.user for downstream use
 */
function authMiddleware(req, res, next) {
	try {
		const authHeader = req.headers.authorization;
		const isProd = process.env.NODE_ENV === 'production';
		
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			if (!isProd) {
				// Dev-only: allow mock user for local testing
				req.user = {
					id: 'mock-user-id',
					username: 'demo-user',
					role: req.headers['x-user-role'] || 'admin'
				};
				return next();
			}
			return res.status(401).json({ error: 'Missing or invalid token' });
		}

		const token = authHeader.substring(7);
		const secret = process.env.JWT_SECRET || 'dev_secret';

		try {
			const decoded = jwt.verify(token, secret);
			req.user = {
				id: decoded.sub || decoded.id,
				username: decoded.username || decoded.sub,
				role: decoded.role || 'technician'
			};
			next();
		} catch (verifyError) {
			if (!isProd) {
				// Dev-only: allow mock user for local testing
				req.user = {
					id: 'mock-user-id',
					username: 'demo-user',
					role: req.headers['x-user-role'] || 'technician'
				};
				return next();
			}
			return res.status(401).json({ error: 'Invalid token' });
		}
	} catch (error) {
		dtLogger.error('auth_middleware_error', { error: error.message });
		res.status(401).json({ error: 'Authentication failed' });
	}
}

module.exports = authMiddleware;
