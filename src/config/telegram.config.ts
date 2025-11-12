export interface TelegramConfig {
  apiId: number;
  apiHash: string;
}

export function getTelegramConfig(): TelegramConfig {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
  const apiHash = process.env.TELEGRAM_API_HASH || '';

  if (!apiId || apiId === 0) {
    throw new Error('TELEGRAM_API_ID is not configured. Please set it in .env file');
  }
  if (!apiHash) {
    throw new Error('TELEGRAM_API_HASH is not configured. Please set it in .env file');
  }

  return { apiId, apiHash };
}

