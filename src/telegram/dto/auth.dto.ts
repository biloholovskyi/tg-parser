export class StartAuthDto {
  phoneNumber: string;
}

export class CompleteAuthDto {
  phoneNumber: string;
  phoneCode?: string;
  password?: string;
}

export class AuthResponseDto {
  sessionString?: string;
  needsCode?: boolean;
  needsPassword?: boolean;
  message: string;
}

