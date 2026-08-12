import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { buildGetJourneyMiddleware } from './controller.ts';
import type { ManageService } from '../../../../service.js';
import type { Request, Response } from 'express';
import type { Prisma } from '@pins/crowndev-database/src/client/client.ts';
import { OCCUPANCY_TYPE_ID, UNIT_TYPES_BY_OCCUPANCY } from '@pins/crowndev-database/src/seed/s62a/data-static.ts';
import { Journey, Question } from '@planning-inspectorate/dynamic-forms';

/** Finds a question by fieldName, including inside manage list sections. */
function findQuestion(journey: Journey, fieldName: string) {
	for (const section of journey.sections) {
		for (const question of section.questions) {
			if (question.fieldName === fieldName) {
				return question;
			}

			const nested = question.section?.questions ?? [];
			const match = nested.find((q: Question) => q.fieldName === fieldName);

			if (match) {
				return match;
			}
		}
	}

	throw new Error(`question ${fieldName} not found`);
}

describe('S62A Controller Middleware', () => {
	describe('buildGetJourneyMiddleware', () => {
		let mockService: ManageService;
		let dbFindUniqueCalls: Prisma.S62aCaseFindUniqueArgs[];

		beforeEach(() => {
			dbFindUniqueCalls = [];
			mockService = {
				db: {
					s62aCase: {
						findUnique: async (args: Prisma.S62aCaseFindUniqueArgs) => {
							dbFindUniqueCalls.push(args);
							return {
								id: 'case-123',
								reference: 'S62A/2026/0001',
								description: 'Test',
								S62aStatus: { id: 'NEW', name: 'New' }
							};
						}
					}
				},
				logger: {
					info: () => {},
					error: () => {},
					warn: () => {}
				},
				getEntraClient: () => null,
				entraGroupIds: { caseOfficers: 'group-1', inspectors: 'group-2' }
			} as unknown as ManageService;
			process.env.ENVIRONMENT = 'dev';
		});

		it('populates res.locals and calls next() on success', async () => {
			const handler = buildGetJourneyMiddleware(mockService, false);

			const req = {
				params: { id: 'case-123', tab: 'overview' },
				baseUrl: '/s62a/cases/case-123/overview',
				originalUrl: '/s62a/cases/case-123/overview/edit'
			} as unknown as Request;

			const res = { locals: {} } as unknown as Response;
			let nextCalled = false;

			await handler(req, res, () => {
				nextCalled = true;
			});

			assert.strictEqual(dbFindUniqueCalls.length, 1);
			assert.deepStrictEqual(dbFindUniqueCalls[0].where, { id: 'case-123' });

			assert.ok(res.locals.originalAnswers, 'originalAnswers should be populated');
			assert.ok(res.locals.journeyResponse, 'journeyResponse should be instantiated');
			assert.ok(res.locals.journey, 'journey should be created');
			assert.strictEqual(res.locals.backLinkUrl, '/s62a/cases/case-123/overview');

			assert.strictEqual(nextCalled, true, 'next() should be called on success');
		});

		it('includes the residential housing relation, ordered for card grouping', async () => {
			const handler = buildGetJourneyMiddleware(mockService, false);

			const req = {
				params: { id: 'case-123', tab: 'residential' },
				baseUrl: '/s62a/cases/case-123/residential'
			} as unknown as Request;

			await handler(req, { locals: {} } as unknown as Response, () => {});

			type HousingInclude = {
				include: { HousingType: boolean; OccupancyType: boolean; UnitType: boolean };
				orderBy: Record<string, { order: string }>[];
			};

			const include = dbFindUniqueCalls[0].include as {
				S62aResidential: { include: { Housing: HousingInclude } };
			};

			const housing = include.S62aResidential.include.Housing;

			assert.ok(housing.include.OccupancyType, 'occupancy lookup needed for the card title');
			assert.ok(housing.include.UnitType, 'unit type lookup needed for the card title');
			// Scenario 6 groups cards by occupancy, sorted on the lookups' display order
			assert.deepStrictEqual(housing.orderBy, [{ OccupancyType: { order: 'asc' } }, { UnitType: { order: 'asc' } }]);
		});

		it('passes session housing to getQuestions so unit type options branch on an unsaved occupancy', async () => {
			const handler = buildGetJourneyMiddleware(mockService, true);

			const itemId = 'housing-1';

			const req = {
				params: {
					id: 'case-123',
					tab: 'residential',
					section: 'proposed',
					question: 'unit-type',
					manageListAction: 'add',
					manageListItemId: itemId
				},
				baseUrl: '/s62a/cases/case-123/residential'
			} as unknown as Request;

			// The entry exists only in session until Save and continue, so if
			// getQuestions is given DB-only answers the filter finds nothing.
			const res = {
				locals: {
					journeyResponse: {
						answers: {
							manageProposedHousing: [{ id: itemId, occupancyTypeId: OCCUPANCY_TYPE_ID.STARTER_HOMES }]
						}
					}
				}
			} as unknown as Response;

			await handler(req, res, () => {});

			const question = findQuestion(res.locals.journey as Journey, 'unitTypeId');
			const values = question.options.map((option: { value: string }) => option.value);

			assert.deepStrictEqual(values, UNIT_TYPES_BY_OCCUPANCY[OCCUPANCY_TYPE_ID.STARTER_HOMES]);
		});
	});
});
