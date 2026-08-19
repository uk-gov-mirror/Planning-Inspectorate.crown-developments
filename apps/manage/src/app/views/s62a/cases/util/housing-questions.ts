import { COMPONENT_TYPES, NumericValidator, RequiredValidator } from '@planning-inspectorate/dynamic-forms';
import {
	OCCUPANCY_TYPES,
	UNIT_TYPES,
	UNIT_TYPES_BY_OCCUPANCY
} from '@pins/crowndev-database/src/seed/s62a/data-static.ts';
import { CUSTOM_COMPONENTS } from '@pins/crowndev-lib/forms/custom-components/index.ts';
import type { CardFormatContext } from '@pins/crowndev-lib/forms/custom-components/manage-list/card/question.ts';
import MultiFieldInputValidator from '@pins/crowndev-lib/validators/multi-field-input-validator.js';
import RequiredGroupValidator from '@pins/crowndev-lib/validators/required-group-validator.ts';
import UniqueListFieldValidator from '@pins/crowndev-lib/validators/unique-list-field-validator.ts';
import { HOUSING_BEDROOM_FIELDS, type ResidentialHousingItem } from '../view/view-model.ts';

export type HousingSide = 'existing' | 'proposed';

const BEDROOM_LABELS: Record<string, string> = {
	bedroomsUnknown: 'Unknown number of bedrooms',
	bedroomsOne: '1 bedroom',
	bedroomsTwo: '2 bedrooms',
	bedroomsThree: '3 bedrooms',
	bedroomsFourPlus: '4+ bedrooms'
};

const BEDROOM_INPUT_FIELDS = HOUSING_BEDROOM_FIELDS.map((fieldName, index) => ({
	fieldName,
	label: BEDROOM_LABELS[fieldName],
	classes: 'govuk-input--width-5',
	inputmode: 'numeric',
	pattern: '[0-9]*',
	suffix: { text: 'units' },
	formatPrefix: `${BEDROOM_LABELS[fieldName]}: `,
	formatJoinString: index === HOUSING_BEDROOM_FIELDS.length - 1 ? '' : ', '
}));

const OCCUPANCY_ORDER = new Map<string, number>(OCCUPANCY_TYPES.map((type) => [type.id, type.order]));
const UNIT_TYPE_ORDER = new Map<string, number>(UNIT_TYPES.map((type) => [type.id, type.order]));

/** Sorts an unknown or not-yet-answered lookup to the end. */
const UNKNOWN_ORDER = Number.MAX_SAFE_INTEGER;

/** The per-card total, summed from the bedroom bands. Never stored. */
export function sumBedroomBands(item: Record<string, unknown>): number {
	return HOUSING_BEDROOM_FIELDS.reduce((total, fieldName) => {
		const value = Number(item[fieldName]);
		return total + (Number.isFinite(value) ? value : 0);
	}, 0);
}

/** Looks a lookup id up through its own question so display names stay in one place. */
function formatViaQuestion(
	fieldName: string,
	item: Record<string, unknown>,
	{ getQuestion, mockJourney }: CardFormatContext
): string {
	const question = getQuestion(fieldName);
	if (!question) return '';
	return question
		.formatAnswerForSummary('', mockJourney, item[fieldName])
		.map((a) => a.value)
		.filter((value): value is string => typeof value === 'string')
		.join('');
}

/** Resolves a lookup id to its display name for error messages. */
function lookupDisplayName(list: { id: string; displayName: string }[], id: unknown): string {
	if (typeof id !== 'string') {
		return '';
	}

	return list.find((entry) => entry.id === id)?.displayName ?? id;
}

/**
 * Groups cards by occupancy, then unit type, matching the DB ordering so an
 * entry added this session lands beside its siblings rather than at the end.
 */
export function compareHousingItems(a: Record<string, unknown>, b: Record<string, unknown>): number {
	const occupancy =
		(OCCUPANCY_ORDER.get(a.occupancyTypeId as string) ?? UNKNOWN_ORDER) -
		(OCCUPANCY_ORDER.get(b.occupancyTypeId as string) ?? UNKNOWN_ORDER);

	if (occupancy !== 0) return occupancy;

	return (
		(UNIT_TYPE_ORDER.get(a.unitTypeId as string) ?? UNKNOWN_ORDER) -
		(UNIT_TYPE_ORDER.get(b.unitTypeId as string) ?? UNKNOWN_ORDER)
	);
}

/**
 * Starter homes and self-build offer a reduced set of unit types.
 *
 * Filtering the options rather than the rendered list means the auto-added
 * ValidOptionValidator rejects a value that isn't valid for the chosen
 * occupancy. No item id means the check page or tab, where every option must
 * remain present so saved entries still resolve their display name.
 */
export function getUnitTypeOptions(items: ResidentialHousingItem[], manageListItemId?: string | null) {
	const occupancyTypeId = manageListItemId
		? items.find((item) => item.id === manageListItemId)?.occupancyTypeId
		: undefined;

	const allowed = occupancyTypeId ? UNIT_TYPES_BY_OCCUPANCY[occupancyTypeId] : undefined;
	const unitTypes = allowed ? UNIT_TYPES.filter((type) => allowed.includes(type.id)) : UNIT_TYPES;

	return unitTypes.map((type) => ({ text: type.displayName, value: type.id }));
}

export interface HousingQuestionsParams {
	side: HousingSide;
	/** Entries for this side, merged with session data so a new entry's occupancy is visible */
	items: ResidentialHousingItem[];
	manageListItemId?: string | null;
	isQuestionView?: boolean;
}

/**
 * The existing and proposed housing add-to-lists are identical apart from their
 * wording and which side of the tab they belong to.
 */
export function housingQuestions({ side, items, manageListItemId, isQuestionView }: HousingQuestionsParams) {
	const listFieldName = side === 'existing' ? 'manageExistingHousing' : 'manageProposedHousing';
	const label = `${side} housing`;
	const sideTitle = side === 'existing' ? 'Existing' : 'Proposed';

	return {
		manageList: {
			type: CUSTOM_COMPONENTS.CARD_MANAGE_LIST,
			title: isQuestionView ? `Check ${label} details` : `${sideTitle} housing`,
			question: `Check ${label} details`,
			fieldName: listFieldName,
			url: 'housing',
			titleSingular: `${label} entry`,
			emptyName: `${side} house`,
			emptyNamePlural: `${side} houses`,
			cardTitle: (item: Record<string, unknown>, context: CardFormatContext) =>
				[formatViaQuestion('occupancyTypeId', item, context), formatViaQuestion('unitTypeId', item, context)]
					.filter(Boolean)
					.join(' - '),
			sortItems: compareHousingItems,
			rows: [
				{ label: 'Total number of units', format: (item: Record<string, unknown>) => String(sumBedroomBands(item)) },
				{ label: 'Unknown no. of bedrooms', fieldName: 'bedroomsUnknown' },
				{ label: '1 bedroom', fieldName: 'bedroomsOne' },
				{ label: '2 bedrooms', fieldName: 'bedroomsTwo' },
				{ label: '3 bedrooms', fieldName: 'bedroomsThree' },
				{ label: '4+ bedrooms', fieldName: 'bedroomsFourPlus' }
			]
		},
		occupancyType: {
			type: COMPONENT_TYPES.RADIO,
			title: 'Occupancy type',
			question: `Which is the type of occupancy for ${label}?`,
			fieldName: 'occupancyTypeId',
			url: 'occupancy',
			validators: [new RequiredValidator(`Select the type of occupancy for ${label}`)],
			options: OCCUPANCY_TYPES.map((type) => ({ text: type.displayName, value: type.id })),
			viewData: { continueButtonText: 'Continue' }
		},
		unitType: {
			type: COMPONENT_TYPES.RADIO,
			title: 'Unit type',
			question: `Which is the type of unit for ${label}?`,
			fieldName: 'unitTypeId',
			url: 'unit-type',
			validators: [
				new RequiredValidator(`Select the type of unit for ${label}`),
				new UniqueListFieldValidator({
					listFieldName,
					alsoMatchOn: ['occupancyTypeId'],
					buildErrorMessage: (name) => `You have already added ${name}`,
					buildCombinationErrorMessage: (item, unitTypeId) =>
						`You have already added ${lookupDisplayName(OCCUPANCY_TYPES, item.occupancyTypeId)}` +
						` - ${lookupDisplayName(UNIT_TYPES, unitTypeId)}. Change the existing entry or choose a different combination.`
				})
			],
			options: getUnitTypeOptions(items, manageListItemId),
			viewData: { continueButtonText: 'Continue' }
		},
		bedrooms: {
			type: COMPONENT_TYPES.MULTI_FIELD_INPUT,
			title: 'Bedrooms',
			question: `How many units per number of bedrooms are there for ${label}?`,
			fieldName: `${side}Bedrooms`,
			url: 'bedrooms',
			inputFields: BEDROOM_INPUT_FIELDS,
			validators: [
				new RequiredGroupValidator({
					fieldNames: HOUSING_BEDROOM_FIELDS,
					errorMessage: 'Enter a number of bedrooms'
				}),
				new MultiFieldInputValidator({
					fields: HOUSING_BEDROOM_FIELDS.map((fieldName) => ({
						fieldName,
						validators: [
							new NumericValidator({
								regex: /^$|^\d+$/,
								regexMessage: 'The number of units must be a whole number'
							})
						]
					}))
				})
			],
			viewData: { continueButtonText: 'Continue' }
		}
	};
}
