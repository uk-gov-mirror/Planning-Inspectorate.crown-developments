import { Router as createRouter } from 'express';
import { buildS62AWrittenRepresentationsLandingPage } from './landing-controller.ts';
import { asyncHandler } from '@planning-inspectorate/core/util';
import type { S62APortalService } from '#service';

export function createWrittenRepresentationsRoutes(service: S62APortalService) {
	const router = createRouter({ mergeParams: true });
	const landingPage = buildS62AWrittenRepresentationsLandingPage(service);

	router.get('/', asyncHandler(landingPage));

	return router;
}
