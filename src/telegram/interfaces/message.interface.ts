export interface TelegramPost {
  id: number;
  text: string;
  date: Date;
  media: TelegramMedia[];
  postUrl: string;
}

export interface TelegramMedia {
  type: 'photo' | 'video' | 'document';
}

export interface GetPostsResponse {
  posts: TelegramPost[];
  count: number;
  /** True when the walk hit POSTS_MAX_MESSAGES before leaving the time window: older posts exist. */
  isTruncated: boolean;
}
