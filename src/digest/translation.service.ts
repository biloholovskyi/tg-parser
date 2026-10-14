import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DigestConfig } from '../config/digest.config';
import {
  DIGEST_CONFIG,
  DIGEST_POST_MAX_CHARS,
  GROK_TRANSLATE_BATCH_CHARS,
  TRANSLATION_BUDGET_MS,
  TRANSLATION_MISSING_RETRIES,
} from './constants';
import { GrokClient } from './grok/grok.client';
import { GrokUsageMeter } from './grok/grok-usage';
import { TRANSLATION_SYSTEM_PROMPT } from './grok/prompts';
import { TRANSLATION_SCHEMA, isTranslationAnswer } from './grok/schemas';
import type { DigestPost } from './interfaces/digest-post.interface';
import type {
  DigestTopic,
  ThesisTranslationResult,
  TranslatedPost,
  TranslationResult,
} from './interfaces/digest-topic.interface';
import { batchBySize, truncateText } from './utils/text';

/** One text to translate, addressed by its reference. */
interface TextItem {
  ref: string;
  text: string;
}

/**
 * Translates texts into Russian with the translation model (GROK_TRANSLATION_MODEL), in batches,
 * one request at a time. Every reference is checked; a text the model skipped is asked for again,
 * then kept in its original language. The first batch Grok fails after its retries, or
 * TRANSLATION_BUDGET_MS, ends the translation: the rest keeps the original text.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly grok: GrokClient,
    @Inject(DIGEST_CONFIG) private readonly config: DigestConfig,
  ) {}

  /** Every post with text, for DIGEST_TRANSLATION=on. */
  async translate(posts: readonly DigestPost[]): Promise<TranslationResult> {
    const startedAt = Date.now();
    const items = posts.filter((post) => post.hasText).map(postItemOf);
    const meter = new GrokUsageMeter();
    const { translations, batchCount } = await this.translateItems(items, meter);
    const translated = posts.map((post) => toTranslatedPost(post, translations));
    const untranslatedCount = items.length - translations.size;
    this.logger.log(
      `Translated ${translations.size} of ${items.length} posts in ${batchCount} batches, ` +
        `${this.config.grokTranslationModel}, ${meter.describe()}, ${Date.now() - startedAt} ms`,
    );
    return { posts: translated, untranslatedCount };
  }

  /**
   * The theses of fallback blocks, which are cut from the original posts when the summary read
   * originals (DIGEST_TRANSLATION=off). No request at all when there is no fallback block.
   */
  async translateTheses(topics: readonly DigestTopic[]): Promise<ThesisTranslationResult> {
    const items = topics.filter(isTranslatableFallback).map(thesisItemOf);
    if (items.length === 0) {
      return { topics: [...topics], untranslatedCount: 0 };
    }
    const meter = new GrokUsageMeter();
    const { translations } = await this.translateItems(items, meter);
    this.logger.log(
      `Translated ${translations.size} of ${items.length} fallback theses, ` +
        `${this.config.grokTranslationModel}, ${meter.describe()}`,
    );
    return {
      topics: topics.map((topic) => withTranslatedThesis(topic, translations)),
      untranslatedCount: items.length - translations.size,
    };
  }

  private async translateItems(
    items: TextItem[],
    meter: GrokUsageMeter,
  ): Promise<{ translations: Map<string, string>; batchCount: number }> {
    const batches = batchBySize(items, (item) => inputOf(item).length, GROK_TRANSLATE_BATCH_CHARS);
    const translations = new Map<string, string>();
    const deadline = Date.now() + TRANSLATION_BUDGET_MS;
    for (const batch of batches) {
      if (Date.now() >= deadline || !(await this.translateBatch(batch, translations, meter))) {
        break;
      }
    }
    return { translations, batchCount: batches.length };
  }

  /**
   * Fills `translations` for the batch. False when Grok failed after its retries: the batch keeps
   * its original text and the caller stops sending further batches.
   */
  private async translateBatch(
    batch: TextItem[],
    translations: Map<string, string>,
    meter: GrokUsageMeter,
  ): Promise<boolean> {
    let pending = batch;
    for (let attempt = 0; attempt <= TRANSLATION_MISSING_RETRIES && pending.length > 0; attempt++) {
      try {
        await this.requestTranslations(pending, translations, meter);
      } catch {
        // GrokClient has logged the failure; these texts keep their original language.
        return false;
      }
      pending = pending.filter((item) => !translations.has(item.ref));
    }
    return true;
  }

  private async requestTranslations(
    items: TextItem[],
    translations: Map<string, string>,
    meter: GrokUsageMeter,
  ): Promise<void> {
    const answer = await this.grok.completeJson({
      system: TRANSLATION_SYSTEM_PROMPT,
      user: items.map(inputOf).join('\n\n'),
      schemaName: 'translations',
      schema: TRANSLATION_SCHEMA,
      isValid: isTranslationAnswer,
      model: this.config.grokTranslationModel,
      reasoningEffort: this.config.grokTranslationReasoningEffort,
      meter,
    });
    const requested = new Set(items.map((item) => item.ref));
    for (const { ref, text } of answer.translations) {
      if (requested.has(ref) && text.trim()) {
        translations.set(ref, text.trim());
      }
    }
  }
}

function postItemOf(post: DigestPost): TextItem {
  return { ref: post.ref, text: truncateText(post.text, DIGEST_POST_MAX_CHARS) };
}

/** A fallback block holds exactly one post; its reference addresses the thesis. */
function isTranslatableFallback(topic: DigestTopic): boolean {
  return topic.isFallback && topic.refs.length > 0 && topic.thesis.trim().length > 0;
}

function thesisItemOf(topic: DigestTopic): TextItem {
  return { ref: topic.refs[0], text: topic.thesis };
}

function inputOf(item: TextItem): string {
  return `[${item.ref}] ${item.text}`;
}

function toTranslatedPost(post: DigestPost, translations: Map<string, string>): TranslatedPost {
  const translation = translations.get(post.ref);
  return {
    ...post,
    translated: translation ?? post.text,
    isUntranslated: post.hasText && translation === undefined,
  };
}

function withTranslatedThesis(topic: DigestTopic, translations: Map<string, string>): DigestTopic {
  const translation = isTranslatableFallback(topic) ? translations.get(topic.refs[0]) : undefined;
  return translation === undefined ? topic : { ...topic, thesis: translation };
}
