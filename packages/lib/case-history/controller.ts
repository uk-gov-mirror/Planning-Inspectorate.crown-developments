import { notFoundHandler } from '@pins/crowndev-lib/middleware/errors.ts';
import type { AsyncRequestHandler } from '@pins/crowndev-lib/util/async-handler.ts';
import { wrapPrismaError } from '@pins/crowndev-lib/util/database.ts';
import { getEntraGroupMembers } from '@pins/crowndev-lib/util/entra-groups.ts';
import { createCaseHistoryViewModel } from './view-model.ts';
import { getPaginationParams, createPaginationParams } from '@pins/crowndev-lib/views/pagination/pagination-utils.ts';
import { getStringParam } from '@pins/crowndev-lib/util/params.ts';

import type { BaseConfig } from '@pins/crowndev-lib/app/config-types.d.ts';
import type { AuditService } from '@pins/crowndev-lib/audit/index.js';
import type { InitEntraClient } from '@pins/crowndev-lib/graph/types.js';
import type { Logger } from 'pino';
import type { initDatabaseClient } from '@pins/crowndev-database';

export interface CaseHistoryService {
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

interface CaseDelegate {
	findUnique(args: { select: { reference: true }; where: { id: string } }): Promise<{ reference: string } | null>;
}

export function buildViewCaseHistory(service: CaseHistoryService): AsyncRequestHandler {
	const { db, audit, logger, getEntraClient } = service;
	const groupIds = service.entraGroupIds;

	const [crownDb, s62aDb] = service.auditLogDataModels;

	return async (req, res) => {
		const id = getStringParam(req.params, 'id');

		let caseRow;
		try {
			const dbModels = db as unknown as Record<string, CaseDelegate>;

			const [crownDev, s62aCase] = await Promise.all([
				dbModels[crownDb].findUnique({
					select: { reference: true },
					where: { id }
				}),
				dbModels[s62aDb].findUnique({
					select: { reference: true },
					where: { id }
				})
			]);

			caseRow = crownDev ?? s62aCase;
		} catch (error: unknown) {
			wrapPrismaError({
				error,
				logger,
				message: 'fetching case for history',
				logParams: { id }
			});
		}

		if (!caseRow) {
			return notFoundHandler(req, res);
		}

		const { pageSize, skipSize } = getPaginationParams(req);

		const [events, totalCount] = await Promise.all([
			audit.getAllForCase(id, { take: pageSize, skip: skipSize }),
			audit.countForCase(id)
		]);

		const paginationParams = createPaginationParams(req, totalCount);

		const groupMembers = await getEntraGroupMembers({
			logger,
			initClient: getEntraClient,
			session: req.session,
			groupIds
		});

		const allMembers = [...groupMembers.caseOfficers, ...groupMembers.inspectors];
		const userMap = new Map(allMembers.map((member) => [member.id, member.displayName]));

		const eventsWithUserNames = events.map((event) => ({
			...event,
			userName: userMap.get(event.userId ?? '') ?? 'Unknown User'
		}));

		const rows = createCaseHistoryViewModel(eventsWithUserNames);

		return res.render('view.njk', {
			pageHeading: 'View application history',
			reference: caseRow.reference,
			backLinkUrl: `/cases/${id}`,
			backLinkText: 'Back to case details',
			rows,
			paginationParams,
			baseUrl: req.baseUrl + req.path,
			queryParams: req.query
		});
	};
}
