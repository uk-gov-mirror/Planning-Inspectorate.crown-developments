import type { S62APortalService } from '#service';
import { fetchPublishedS62aApplication } from '@pins/crowndev-lib/util/applications.ts';
import { applicationLinks } from '@pins/crowndev-lib/util/shared-view-model.ts';
import { notFoundHandler } from '@planning-inspectorate/core/middleware';
import type { AsyncRequestHandler } from '@planning-inspectorate/core/util';
import { getStringParam } from '@pins/crowndev-lib/util/params.ts';
import { isValidUuidFormat } from '@pins/crowndev-lib/util/uuid.ts';

export function buildS62AWrittenRepresentationsLandingPage(service: S62APortalService): AsyncRequestHandler {
	return async (req, res) => {
		const id = getStringParam(req.params, 'applicationId');

		if (!isValidUuidFormat(id)) {
			return notFoundHandler(req, res);
		}

		const s62aCase = await fetchPublishedS62aApplication({
			id,
			db: service.db,
			args: {
				select: {
					reference: true,
					representationsPublishDate: true
				}
			}
		});

		if (!s62aCase) {
			return notFoundHandler(req, res);
		}

		return res.render('views/applications/view/written-representations/scaffold.njk', {
			pageCaption: s62aCase.reference,
			pageTitle: 'Written representations',
			links: applicationLinks(
				id,
				{ start: null, end: null },
				s62aCase.representationsPublishDate,
				false,
				undefined,
				undefined,
				true
			),
			currentUrl: req.originalUrl
		});
	};
}
