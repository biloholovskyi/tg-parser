import bigInt from 'big-integer';
import { Api } from 'telegram/tl';
import { toLoginIdentity } from './login-identity';

const INPUT_USER_ID = 42;
const INPUT_EMPTY_USER_ID = 7;
const INPUT_USERNAME = 'fakeuser';
const INPUT_PHONE = '+10000000000';

function buildUser(username?: string): Api.User {
  return new Api.User({
    id: bigInt(INPUT_USER_ID),
    username,
    phone: INPUT_PHONE,
    firstName: 'Fake',
    lastName: 'Person',
  } as never);
}

function buildAuthorization(user: Api.TypeUser): Api.auth.Authorization {
  return new Api.auth.Authorization({ user } as never);
}

describe('toLoginIdentity', () => {
  it('returns the id as a string and the username of an authorized user', () => {
    // Arrange
    const inputAuthorization = buildAuthorization(buildUser(INPUT_USERNAME));

    // Act
    const actualIdentity = toLoginIdentity(inputAuthorization);

    // Assert
    expect(actualIdentity).toEqual({ userId: String(INPUT_USER_ID), username: INPUT_USERNAME });
  });

  it('returns a null username when the user has none', () => {
    // Arrange
    const inputAuthorization = buildAuthorization(buildUser());

    // Act
    const actualIdentity = toLoginIdentity(inputAuthorization);

    // Assert
    expect(actualIdentity).toEqual({ userId: String(INPUT_USER_ID), username: null });
  });

  it('never carries the phone number or the name of the user', () => {
    // Arrange
    const inputAuthorization = buildAuthorization(buildUser(INPUT_USERNAME));

    // Act
    const actualIdentity = toLoginIdentity(inputAuthorization);

    // Assert
    expect(Object.keys(actualIdentity).sort()).toEqual(['userId', 'username']);
    const actualSerialized = JSON.stringify(actualIdentity);
    expect(actualSerialized).not.toContain(INPUT_PHONE);
    expect(actualSerialized).not.toContain('Fake');
    expect(actualSerialized).not.toContain('Person');
  });

  it('returns the id and a null username when the user is not a full User', () => {
    // Arrange
    const inputAuthorization = buildAuthorization(
      new Api.UserEmpty({ id: bigInt(INPUT_EMPTY_USER_ID) } as never),
    );

    // Act
    const actualIdentity = toLoginIdentity(inputAuthorization);

    // Assert
    expect(actualIdentity).toEqual({ userId: String(INPUT_EMPTY_USER_ID), username: null });
  });

  it.each([
    ['a sign-up-required answer', new Api.auth.AuthorizationSignUpRequired({} as never)],
    ['undefined', undefined],
    ['null', null],
    ['a plain object shaped like an authorization', { user: { id: 1, username: 'fakeuser' } }],
  ])('returns nulls for %s', (_label, inputAuthorization) => {
    // Act
    const actualIdentity = toLoginIdentity(inputAuthorization);

    // Assert
    expect(actualIdentity).toEqual({ userId: null, username: null });
  });
});
