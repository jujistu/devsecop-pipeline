import { enumType, objectType } from 'nexus';

export const UserType = objectType({
  name: 'User',
  definition(t) {
    t.nonNull.string('_id');
    t.nullable.string('firstName');
    t.nullable.string('lastName');
    t.nullable.string('nickName')
    t.nullable.string('email');
    t.nullable.boolean('isGuest');
  },
});

export const AuthPayloadType = objectType({
  name: 'AuthPayload',
  definition(t) {
    t.nonNull.string('accessToken');
    t.nonNull.string('refreshToken');
    t.nonNull.field('user', {
      type: 'User',
    });
    t.nonNull.field('subscription', {
      type: 'Subscription'
    })
  },
});

export const GuestAuthPayload = objectType({
  name: 'GuestAuthPayload',
  definition(t) {
    t.nonNull.string('accessToken');
    t.nonNull.string('refreshToken');
    t.nonNull.field('user', {
      type: 'User',
    });
  },
});

export const SignUpType = enumType({
  name: 'SignUpType',
  members: {
    Email: 'EMAIL',
    Google: 'GOOGLE',
    Apple: 'APPLE',
    Facebook: 'FACEBOOK',
  },
});

export const RefreshTokenResponse = objectType({
  name: 'RefreshTokenResponse',
  definition(t) {
    t.nonNull.string('accessToken');
    t.nonNull.string('refreshToken');
  },
});
