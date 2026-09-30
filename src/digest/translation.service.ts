import { Injectable, Logger } from '@nestjs/common';
import {
  DIGEST_POST_MAX_CHARS,
  GROK_TRANSLATE_BATCH_CHARS,
  TRANSLATION_BUDGET_MS,
  TRANSLATION_MISSING_RETRIES,
} from './constants';
import { GrokClient } from './grok/grok.client';
import { TRANSLATION_SYSTEM_PROMPT } from './grok/prompts';
import { TRANSLATION_SCHEMA, isTranslationAnswer } from './grok/schemas';
import type { DigestPost } from './interfaces/digest-post.interface';
import type { TranslatedPost, TranslationResult } from './interfaces/digest-topic.interface';
import { batchBySize, truncateText } from './utils/text';

/**
 * Translates post texts into Russian in batches, one request at a time. Every reference is
 * checked; a post the model skipped is asked for again, then kept in its original language.
 * The first batch Grok fails after its retries, or TRANSLATION_BUDGET_MS, ends the translation:
 * the remaining posts keep their original text instead of piling up doomed requests.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(private readonly grok: GrokClient) {}

  async translate(posts: readonly DigestPost[]): Promise<TranslationResult> {
    const withText = posts.filter((post) => post.hasText);
    const batches = batchBySize(
      withText,
      (post) => inputOf(post).length,
      GROK_TRANSLATE_BATCH_CHARS,
    );
    const translations = new Map<string, string>();
    const deadline = Date.now() + TRANSLATION_BUDGET_MS;
    for (const batch of batches) {
      if (Date.now() >= deadline || !(await this.translateBatch(batch, translations))) {
        break;
      }
    }
    const translated = posts.map((post) => toTranslatedPost(post, translations));
    const untranslatedCount = translated.filter(
      (post) => post.hasText && post.isUntranslated,
    ).length;
    this.logger.log(
      `Translated ${withText.length - untranslatedCount} of ${withText.length} posts ` +
        `in ${batches.length} batches`,
    );
    return { posts: translated, untranslatedCount };
  }

  /**
   * Fills `translations` for the batch. False when Grok failed after its retries: the batch keeps
   * its original text and the caller stops sending further batches.
   */
  private async translateBatch(
    batch: DigestPost[],
    translations: Map<string, string>,
  ): Promise<boolean> {
    let pending = batch;
    for (let attempt = 0; attempt <= TRANSLATION_MISSING_RETRIES && pending.length > 0; attempt++) {
      try {
        await this.requestTranslations(pending, translations);
      } catch {
        // GrokClient has logged the failure; these posts keep their original text.
        return false;
      }
      pending = pending.filter((post) => !translations.has(post.ref));
    }
    return true;
  }

  private async requestTranslations(
    posts: DigestPost[],
    translations: Map<string, string>,
  ): Promise<void> {
    const answer = await this.grok.completeJson({
      system: TRANSLATION_SYSTEM_PROMPT,
      user: posts.map(inputOf).join('\n\n'),
      schemaName: 'translations',
      schema: TRANSLATION_SCHEMA,
      isValid: isTranslationAnswer,
    });
    const requested = new Set(posts.map((post) => post.ref));
    for (const { ref, text } of answer.translations) {
      if (requested.has(ref) && text.trim()) {
        translations.set(ref, text.trim());
      }
    }
  }
}

function inputOf(post: DigestPost): string {
  return `[${post.ref}] ${truncateText(post.text, DIGEST_POST_MAX_CHARS)}`;
}

function toTranslatedPost(post: DigestPost, translations: Map<string, string>): TranslatedPost {
  const translation = translations.get(post.ref);
  return {
    ...post,
    translated: translation ?? post.text,
    isUntranslated: post.hasText && translation === undefined,
  };
}
