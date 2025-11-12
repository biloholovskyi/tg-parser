export interface TelegramPost {
  id: number;
  text: string;
  date: Date;
  media: TelegramMedia[];
  postUrl: string;
}

export interface TelegramMedia {
  type: 'photo' | 'video' | 'document';
  url?: string;
}

export interface GetPostsResponse {
  posts: TelegramPost[];
  count: number;
}

