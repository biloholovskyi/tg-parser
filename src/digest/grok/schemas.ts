import type { DigestViewpoint } from '../interfaces/digest-topic.interface';

export interface TranslationAnswer {
  translations: Array<{ ref: string; text: string }>;
}

/** A topic as the model returns it, before references are checked. */
export interface TopicAnswer {
  thesis: string;
  viewpoints: DigestViewpoint[];
  refs: string[];
}

export interface SummaryAnswer {
  topics: TopicAnswer[];
}

export interface CoverageAnswer {
  additions: Array<{ topicNumber: number; refs: string[] }>;
  newTopics: TopicAnswer[];
}

const STRING = { type: 'string' } as const;
const STRING_LIST = { type: 'array', items: STRING } as const;

function strictObject(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const VIEWPOINT_SCHEMA = strictObject({ source: STRING, claim: STRING });
const TOPIC_SCHEMA = strictObject({
  thesis: STRING,
  viewpoints: { type: 'array', items: VIEWPOINT_SCHEMA },
  refs: STRING_LIST,
});

export const TRANSLATION_SCHEMA = strictObject({
  translations: { type: 'array', items: strictObject({ ref: STRING, text: STRING }) },
});

export const SUMMARY_SCHEMA = strictObject({ topics: { type: 'array', items: TOPIC_SCHEMA } });

export const COVERAGE_SCHEMA = strictObject({
  additions: {
    type: 'array',
    items: strictObject({ topicNumber: { type: 'integer' }, refs: STRING_LIST }),
  },
  newTopics: { type: 'array', items: TOPIC_SCHEMA },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isViewpoint(value: unknown): value is DigestViewpoint {
  return isRecord(value) && typeof value.source === 'string' && typeof value.claim === 'string';
}

function isTopic(value: unknown): value is TopicAnswer {
  return (
    isRecord(value) &&
    typeof value.thesis === 'string' &&
    Array.isArray(value.viewpoints) &&
    value.viewpoints.every(isViewpoint) &&
    isStringList(value.refs)
  );
}

export function isTranslationAnswer(value: unknown): value is TranslationAnswer {
  return (
    isRecord(value) &&
    Array.isArray(value.translations) &&
    value.translations.every(
      (item) => isRecord(item) && typeof item.ref === 'string' && typeof item.text === 'string',
    )
  );
}

export function isSummaryAnswer(value: unknown): value is SummaryAnswer {
  return isRecord(value) && Array.isArray(value.topics) && value.topics.every(isTopic);
}

export function isCoverageAnswer(value: unknown): value is CoverageAnswer {
  return (
    isRecord(value) &&
    Array.isArray(value.additions) &&
    value.additions.every(
      (item) => isRecord(item) && Number.isInteger(item.topicNumber) && isStringList(item.refs),
    ) &&
    Array.isArray(value.newTopics) &&
    value.newTopics.every(isTopic)
  );
}
