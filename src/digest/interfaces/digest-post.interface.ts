/** One collected post, addressed by a short `ref` unique within a run. */
export interface DigestPost {
  ref: string;
  channel: string;
  url: string;
  text: string;
  date: Date;
  /** False for media-only posts: they are listed by link, never sent to the model. */
  hasText: boolean;
}

/** Everything one run collected, including what it could not read. */
export interface CollectedPosts {
  posts: DigestPost[];
  channelCount: number;
  /** Channels that do not exist or this account cannot read. */
  unavailableChannels: string[];
  /** Channels whose window held more than POSTS_MAX_MESSAGES posts; the oldest were not read. */
  truncatedChannels: string[];
}
