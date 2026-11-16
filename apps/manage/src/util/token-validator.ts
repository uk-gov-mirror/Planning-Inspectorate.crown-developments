import type { ManageService } from '#service';
import type { RequestHandler } from 'express';

/**
 * Generic token validator that checks for a key before allowing the request
 * to pass to the next middleware
 */
export function buildTokenValidator<T extends keyof ManageService>(service: ManageService, key: T): RequestHandler {
	return (req, res, next) => {
		const authHeader = req.headers.authorization;
		const token = authHeader && authHeader.split(' ')[1];
		if (!service[key]) {
			service.logger.warn(`${key} is not set in service`);
			return res.status(500);
		} else if (!token || token !== service[key]) {
			service.logger.warn('Invalid or missing authorization token in request');
			return res.status(401).send('Unauthorized access');
		} else {
			return next();
		}
	};
}
