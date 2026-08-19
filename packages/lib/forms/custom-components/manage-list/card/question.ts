import TableManageListQuestion from '../table/question.ts';
import type { CommonQuestionParams } from '@planning-inspectorate/dynamic-forms';
import type { Journey } from '@planning-inspectorate/dynamic-forms/src/journey/journey.js';
import type { Question, QuestionViewModel } from '@planning-inspectorate/dynamic-forms/src/questions/question.js';
import type { TableManageListQuestionParameters } from '../table/types.ts';
import type { Response } from 'express';

export interface CardFormatContext {
	getQuestion: (fieldName: string) => Question | undefined;
	mockJourney: Journey;
}

export interface CardRow {
	label: string;
	/** The item field this row shows. Omit and supply `format` to derive a value. */
	fieldName?: string;
	/** Takes priority over fieldName, so a row can combine or compute values. */
	format?: (item: Record<string, unknown>, params: CardFormatContext) => string;
}

export type CardManageListQuestionParams = TableManageListQuestionParameters &
	CommonQuestionParams & {
		/** Builds each card's title. Defaults to "<titleSingular> <n>". */
		cardTitle?: (item: Record<string, unknown>, params: CardFormatContext) => string;
		/** Rows inside each card. Defaults to one row per sub-question. */
		rows?: CardRow[];
		/** Orders the cards. Applied on every render, so session items sort too. */
		sortItems?: (a: Record<string, unknown>, b: Record<string, unknown>) => number;
	};

interface CardViewData {
	value?: Record<string, unknown>[];
	firstQuestionUrl?: string;
	cards?: { id: string; title: string; rows: { label: string; value: string }[] }[];
}

/**
 * A manage list rendered as one summary card per item, with named rows inside.
 */
export default class CardManageListQuestion extends TableManageListQuestion {
	cardTitle?: (item: Record<string, unknown>, params: CardFormatContext) => string;
	rows: CardRow[];
	sortItems?: (a: Record<string, unknown>, b: Record<string, unknown>) => number;

	constructor(params: CardManageListQuestionParams) {
		super(params);
		this.cardTitle = params.cardTitle;
		this.rows = params.rows ?? [];
		this.sortItems = params.sortItems;
		this.viewFolder = 'custom-components/manage-list/card';
	}

	override addCustomDataToViewModel(viewModel: QuestionViewModel): void {
		super.addCustomDataToViewModel(viewModel);

		const question = viewModel.question as CardViewData;
		const value = question.value ?? [];

		// The DB query is ordered, but an entry added this session is appended in
		// insertion order. Sorting a copy keeps the cards grouped without
		// reordering the array that gets saved.
		const items = this.sortItems ? [...value].sort(this.sortItems) : value;

		question.cards = items.map((item, index) => ({
			id: typeof item.id === 'string' ? item.id : '',
			title: this.cardTitle
				? this.cardTitle(item, this.formatContext(item))
				: `${this.viewData?.titleSingular ?? 'Item'} ${index + 1}`,
			rows: this.buildRows(item)
		}));
	}

	/**
	 * We need the item named in the prompt, so it is built from the
	 * card title rather than the static titleSingular.
	 */
	override renderConfirmationAction(
		res: Response,
		itemToRemove: Record<string, unknown>,
		viewModel: QuestionViewModel
	): void {
		if (this.cardTitle) {
			viewModel.removalPrompt = `Are you sure you want to remove ${this.cardTitle(itemToRemove, this.formatContext(itemToRemove))}?`;
		}

		super.renderConfirmationAction(res, itemToRemove, viewModel);
	}

	/**
	 * The tab shows a fixed "See details" rather than listing every entry; the
	 * per-occupancy totals beside it are derived separately.
	 */
	override formatAnswerForSummary(sectionSegment: string, journey: Journey, answer: unknown) {
		const items = Array.isArray(answer) ? answer : [];

		return [
			{
				key: this.title ?? this.question,
				// The tab shows a fixed string rather than listing entries; the totals
				// beside it are derived separately
				value: items.length ? 'See details' : this.notStartedText || 'Not started',
				action: this.getAction(sectionSegment, journey, answer) as never
			}
		];
	}

	private buildRows(item: Record<string, unknown>): { label: string; value: string }[] {
		if (this.rows.length === 0) {
			// No rows configured - fall back to one per sub-question.
			return this.formatItemAnswers(item).map((a) => ({ label: a.question ?? '', value: a.answer || '-' }));
		}

		const context = this.formatContext(item);

		return this.rows.map((row) => {
			if (row.format) {
				return { label: row.label, value: row.format(item, context) || '-' };
			}

			const value = row.fieldName === undefined ? undefined : item[row.fieldName];

			if (typeof value === 'string') {
				return { label: row.label, value: value === '' ? '-' : value };
			}

			if (typeof value === 'number' || typeof value === 'boolean') {
				return { label: row.label, value: String(value) };
			}

			return { label: row.label, value: '-' };
		});
	}

	private formatContext(item: Record<string, unknown>): CardFormatContext {
		// section is typed `any` upstream, so we cast once here rather than at each use
		const questions = (this.section?.questions ?? []) as Question[];

		return {
			mockJourney: this.buildMockJourney(item),
			getQuestion: (fieldName) => questions.find((question) => question.fieldName === fieldName)
		};
	}
}
