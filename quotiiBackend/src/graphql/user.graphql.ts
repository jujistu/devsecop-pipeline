import { mutationField, nonNull, nullable, queryField, stringArg } from 'nexus';
import {
  AuthPayloadType,
  GuestAuthPayload,
  RefreshTokenResponse,
  UserType,
} from './types/user.type';
import {
  getUser,
  loginWithApple,
  registerGuest,
  updateUserDeviceToken,
  updateUserNickname,
  getUserSubscriptions,
} from '../repository/user.repository';
import { refreshTokens } from '../utils/auth.util';
import { SubscriptionType } from './types/subscription.type';

export const getUserQuery = queryField((t) => {
  t.nonNull.field('getUser', {
    type: UserType,
    args: { userId: nonNull(stringArg()) },
    async resolve(_, args, ctx) {
      if (!ctx.user || !ctx.user.id) {
        throw new Error('Authentication required');
      }
      // Only allow fetching the authenticated user's own profile (self).
      if (String(args.userId) !== String(ctx.user.id)) {
        throw new Error('Unauthorized');
      }
      return getUser(args.userId);
    },
  });
});

export const loginWithAppleQuery = mutationField((t) => {
  t.nullable.field('loginWithApple', {
    type: AuthPayloadType,
    args: {
      idToken: nonNull(stringArg()),
      firstName: nullable(stringArg()),
      lastName: nullable(stringArg()),
      timeZone: nullable(stringArg()),
    },
    async resolve(_, { idToken, firstName, lastName, timeZone}) {
      return await loginWithApple(idToken, firstName, lastName, timeZone);
    },
  });
});

export const registerGuestMutation = mutationField((t) => {
  t.nullable.field('registerGuest', {
    type: GuestAuthPayload,
    args: {
      guestId: nonNull(stringArg()),
    },
    async resolve(_, { guestId }) {
      return await registerGuest(guestId);
    },
  });
});

export const whoAmIQuery = queryField((t) => {
  t.nullable.field('whoAmI', {
    type: UserType,
    async resolve(_, args, ctx) {
      if (!ctx.user || !ctx.user.id) {
        throw new Error('Authentication required');
      }
      return getUser(ctx.user.id);
    },
  });
});

export const RefreshTokensMutation = mutationField('refreshTokens', {
  type: RefreshTokenResponse,
  args: {
    refreshToken: nonNull(stringArg()),
  },
  resolve: async (_root, { refreshToken }, _ctx) => {
    try {
      const { accessToken, refreshToken: newRefreshToken } =
        await refreshTokens(refreshToken);
      return { accessToken, refreshToken: newRefreshToken };
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  },
});

export const updateUserDeviceTokenMutation = mutationField(
  'updateUserDeviceToken',
  {
    type: 'Boolean',
    args: {
      token: nullable(stringArg()),
    },
    resolve: async (_root, { token }, ctx) => {
      console.log('updating user token, context is --> ', ctx);
      if (ctx.user) {
        console.log(
          `updating user:${ctx.user.email} device token to --> `,
          token
        );
        console.log(ctx);
        const updated = await updateUserDeviceToken(token, ctx.user.id);
        console.log('user token updated? ', updated);
        return updated;
      } else {
        console.log(
          "User not authenticated. Can't fulfill request : {updateUserDeviceToken}"
        );
        throw new Error('Authentication required');
      }
    },
  }
);

export const updateUserNicknameMutation = mutationField('updateUserNickname', {
  type: UserType,
  args: {
    nickname: nonNull(stringArg()),
  },
  resolve: async (_root, { nickname }, ctx) => {
    if (!ctx.user) {
      throw new Error('Authentication required');
    }
    return updateUserNickname(ctx.user.id, nickname);
  },
});

export const getUserSubscriptionsQuery = queryField((t) => {
  t.nonNull.list.field('getUserSubscriptions', {
    type: SubscriptionType,
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Authentication required');
      }
      return getUserSubscriptions(ctx.user.id);
    },
  });
});




