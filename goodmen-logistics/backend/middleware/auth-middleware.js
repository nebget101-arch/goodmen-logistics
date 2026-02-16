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
		
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			// For Phase 2 implementation, use mock user if no token provided
			req.user = {
				id: 'mock-user-id',
				username: 'demo-user',
				role: req.headers['x-user-role'] || 'admin'
			};
			return next();
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
			// If token is invalid, use mock user
			req.user = {
				id: 'mock-user-id',
				username: 'demo-user',
				role: req.headers['x-user-role'] || 'technician'
			};
			next();
		}
	} catch (error) {
		dtLogger.error('auth_middleware_error', { error: error.message });
		res.status(401).json({ error: 'Authentication failed' });
	}
}

module.exports = authMiddleware;
