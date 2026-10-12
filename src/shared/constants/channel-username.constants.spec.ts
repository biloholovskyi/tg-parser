import 'reflect-metadata';
import * as dtoModule from '../../telegram/dto/messages.dto';
import {
  CHANNEL_USERNAME_MAX_LENGTH,
  CHANNEL_USERNAME_MIN_LENGTH,
  CHANNEL_USERNAME_PATTERN,
} from './channel-username.constants';

const FIRST_CHARACTER_LENGTH = 1;
const OUT_OF_RANGE_STEP = 1;

function buildName(length: number): string {
  return `c${'h'.repeat(length - FIRST_CHARACTER_LENGTH)}`;
}

describe('CHANNEL_USERNAME_PATTERN', () => {
  it.each([
    ['the minimum length', buildName(CHANNEL_USERNAME_MIN_LENGTH)],
    ['the maximum length', buildName(CHANNEL_USERNAME_MAX_LENGTH)],
    ['a leading @', `@${buildName(CHANNEL_USERNAME_MIN_LENGTH)}`],
    ['digits and underscores after the first letter', 'Fake_Chan_01'],
  ])('accepts a name with %s', (_label, inputName) => {
    // Act
    const actualIsMatch = CHANNEL_USERNAME_PATTERN.test(inputName);

    // Assert
    expect(actualIsMatch).toBe(true);
  });

  it.each([
    ['too short', buildName(CHANNEL_USERNAME_MIN_LENGTH - OUT_OF_RANGE_STEP)],
    ['too long', buildName(CHANNEL_USERNAME_MAX_LENGTH + OUT_OF_RANGE_STEP)],
    ['a leading digit', '1fake_channel'],
    ['a leading underscore', '_fake_channel'],
    ['a double @', `@@${buildName(CHANNEL_USERNAME_MIN_LENGTH)}`],
    ['a dash', 'fake-channel'],
    ['a space', 'fake channel'],
    ['a path separator', 'fake/channel'],
    ['nothing', ''],
  ])('rejects a name with %s', (_label, inputName) => {
    // Act
    const actualIsMatch = CHANNEL_USERNAME_PATTERN.test(inputName);

    // Assert
    expect(actualIsMatch).toBe(false);
  });

  it('is the same bounds the request DTO re-exports', () => {
    // Assert
    expect(dtoModule.CHANNEL_USERNAME_MIN_LENGTH).toBe(CHANNEL_USERNAME_MIN_LENGTH);
    expect(dtoModule.CHANNEL_USERNAME_MAX_LENGTH).toBe(CHANNEL_USERNAME_MAX_LENGTH);
  });
});
