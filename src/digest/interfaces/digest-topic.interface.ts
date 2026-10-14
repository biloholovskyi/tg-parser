import type { DigestPost } from './digest-post.interface';

/**
 * A collected post with the text the summary reads: the Russian translation with
 * DIGEST_TRANSLATION=on, the original text with DIGEST_TRANSLATION=off.
 */
export interface TranslatedPost extends DigestPost {
  translated: string;
  /** True when the model did not return a translation and `translated` is the original text. */
  isUntranslated: boolean;
}

/** One side's claim, when channels report the same topic differently. */
export interface DigestViewpoint {
  source: string;
  claim: string;
}

/** One block of the digest: a short thesis and every post it was built from. */
export interface DigestTopic {
  thesis: string;
  viewpoints: DigestViewpoint[];
  refs: string[];
  /** True when the model never placed the post and the block was built from its text. */
  isFallback: boolean;
}

export interface TranslationResult {
  posts: TranslatedPost[];
  untranslatedCount: number;
}

/** Topics after the fallback theses were translated; the count is of theses left as they were. */
export interface ThesisTranslationResult {
  topics: DigestTopic[];
  untranslatedCount: number;
}

export interface SummaryResult {
  topics: DigestTopic[];
  fallbackTopicCount: number;
}
