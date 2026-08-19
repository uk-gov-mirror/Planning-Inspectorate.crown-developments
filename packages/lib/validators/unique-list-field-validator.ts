import { body } from 'express-validator';
import BaseValidator from '@planning-inspectorate/dynamic-forms/src/validator/base-validator.js';
import type { Question } from '@planning-inspectorate/dynamic-forms/src/questions/question.js';

export interface UniqueListFieldValidatorParams {
	/** The manage list question's fieldName, e.g. 'manageWasteTypes' */
	listFieldName: string;
	/** Builds the error message from the duplicate's display name */
	buildErrorMessage: (displayName: string) => string;
	/** Resolves a stored value to something readable */
	displayNameFor?: (value: string) => string;
	/** Extra item fields that must also match for a duplicate, read from the item being edited */
	alsoMatchOn?: string[];
	/** Message when alsoMatchOn is set and the value alone doesn't identify the clash */
	buildCombinationErrorMessage?: (item: Record<string, unknown>, value: string) => string;
}

/**
 * Blocks a manage-list item reusing a value another item already has.
 *
 * When editing, the item being edited is excluded so leaving its value
 * unchanged does not fail against itself.
 */
export default class UniqueListFieldValidator extends BaseValidator {
	private listFieldName: string;
	private buildErrorMessage: (displayName: string) => string;
	private displayNameFor: (value: string) => string;
	private alsoMatchOn: string[];
	private buildCombinationErrorMessage?: (item: Record<string, unknown>, value: string) => string;

	constructor({
		listFieldName,
		buildErrorMessage,
		displayNameFor,
		alsoMatchOn,
		buildCombinationErrorMessage
	}: UniqueListFieldValidatorParams) {
		super();
		this.listFieldName = listFieldName;
		this.buildErrorMessage = buildErrorMessage;
		this.displayNameFor = displayNameFor ?? ((value) => value);
		this.alsoMatchOn = alsoMatchOn ?? [];
		this.buildCombinationErrorMessage = buildCombinationErrorMessage;
	}

	validate(questionObj: Question) {
		return body(questionObj.fieldName).custom((value, { req }) => {
			if (typeof value !== 'string' || !value) {
				return true;
			}

			// express-validator types req as `any` inside custom validators
			const typedReq = req as {
				params?: { manageListItemId?: string };
				res?: { locals?: { journeyResponse?: { answers?: Record<string, unknown> } } };
			};

			const answers = typedReq.res?.locals?.journeyResponse?.answers ?? {};
			const items = (answers[this.listFieldName] as Record<string, unknown>[] | undefined) ?? [];

			// The item being added or edited is already in the list, so skip it
			const currentItemId = typedReq.params?.manageListItemId;
			const currentItem = items.find((item) => item.id === currentItemId) ?? {};

			const isDuplicate = items.some((item) => {
				if (item.id === currentItemId) {
					return false;
				}

				if (item[questionObj.fieldName] !== value) {
					return false;
				}

				return this.alsoMatchOn.every((fieldName) => item[fieldName] === currentItem[fieldName]);
			});

			if (isDuplicate) {
				throw new Error(
					this.buildCombinationErrorMessage
						? this.buildCombinationErrorMessage(currentItem, value)
						: this.buildErrorMessage(this.displayNameFor(value))
				);
			}

			return true;
		});
	}
}
