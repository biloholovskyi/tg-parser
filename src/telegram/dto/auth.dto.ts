import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';

const PHONE_NUMBER_PATTERN = /^\+?\d{7,15}$/;
const PHONE_CODE_PATTERN = /^\d{4,8}$/;
const PASSWORD_MAX_LENGTH = 256;

/**
 * A blank string means "this step was not filled in" and is treated as absent,
 * which keeps the multi-step auth flow working for callers that always send every field.
 * A value that only looks blank is dropped too; a real value keeps its own spacing.
 */
const blankStringToUndefined = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value,
);

/** The 2FA password belongs to the third auth step, so it is accepted only with a code. */
@ValidatorConstraint({ name: 'passwordRequiresPhoneCode' })
export class PasswordRequiresPhoneCodeConstraint implements ValidatorConstraintInterface {
  validate(password: unknown, args: ValidationArguments): boolean {
    const { phoneCode } = args.object as CompleteAuthDto;

    return password === undefined || phoneCode !== undefined;
  }

  defaultMessage(): string {
    return 'password is accepted only together with phoneCode';
  }
}

export class StartAuthDto {
  @IsString()
  @IsNotEmpty()
  @Matches(PHONE_NUMBER_PATTERN, { message: 'phoneNumber must be a phone number in E.164 format' })
  phoneNumber: string;
}

export class CompleteAuthDto extends StartAuthDto {
  @blankStringToUndefined
  @IsOptional()
  @IsString()
  @Matches(PHONE_CODE_PATTERN, { message: 'phoneCode must contain digits only' })
  phoneCode?: string;

  @blankStringToUndefined
  @Validate(PasswordRequiresPhoneCodeConstraint)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password?: string;
}

export class AuthResponseDto {
  sessionString?: string;
  needsCode?: boolean;
  needsPassword?: boolean;
  message: string;
}
