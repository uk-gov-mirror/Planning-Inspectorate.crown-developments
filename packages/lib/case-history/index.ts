import { Router as createRouter } from 'express';
import { asyncHandler } from '@pins/crowndev-lib/util/async-handler.ts';
import { buildViewCaseHistory } from './controller.ts';
//import { validateIdFormat } from '../view/controller.ts';
//import type { ManageService } from '#service';

import type { BaseConfig } from '@pins/crowndev-lib/app/config-types.d.ts';
import type { AuditService } from '@pins/crowndev-lib/audit/index.js';
import type { InitEntraClient } from '@pins/crowndev-lib/graph/types.js';
import type { Logger } from 'pino';
import type { initDatabaseClient } from '@pins/crowndev-database';

import { getStringParam } from '@pins/crowndev-lib/util/params.ts';
import { isValidUuidFormat } from '@pins/crowndev-lib/util/uuid.ts';
import { notFoundHandler } from '@pins/crowndev-lib/middleware/errors.ts';
import type { Response, Request, NextFunction } from 'express';

interface CaseHistoryService {
	db: typeof initDatabaseClient;
	config: BaseConfig;
	logger: Logger;
	audit: AuditService;
	getEntraClient: InitEntraClient;
	entraGroupIds: {
		caseOfficers: string;
		inspectors: string;
	};
	auditLogDataModels: string[];
}

/**
 * Validate the format of the id parameter
 */
export function validateIdFormat(req: Request, res: Response, next: NextFunction) {
	const id = getStringParam(req.params, 'id');

	if (!isValidUuidFormat(id)) {
		return notFoundHandler(req, res);
	}
	next();
}

export function createRoutes(service: CaseHistoryService) {
	const router = createRouter({ mergeParams: true });

	const viewCaseHistory = buildViewCaseHistory(service);

	router.get('/', validateIdFormat, asyncHandler(viewCaseHistory));

	return router;
}
