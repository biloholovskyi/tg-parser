export interface TelegramConfig {
  apiId: number;
  apiHash: string;
}

export function getTelegramConfig(): TelegramConfig {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
  const apiHash = process.env.TELEGRAM_API_HASH || '';

  // Не бросаем ошибку при старте - только при использовании
  // Это позволяет health check работать даже без конфигурации
  if (!apiId || apiId === 0) {
    console.warn('⚠️  TELEGRAM_API_ID is not configured. Please set it in environment variables');
  }
  if (!apiHash) {
    console.warn('⚠️  TELEGRAM_API_HASH is not configured. Please set it in environment variables');
  }

  return { apiId, apiHash };
}

