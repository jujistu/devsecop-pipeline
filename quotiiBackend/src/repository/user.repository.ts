import verifyAppleToken from 'verify-apple-id-token';
import { SignUpType, User } from '../database/schemas/user.schema';
import { createTokens } from '../utils/auth.util';
import { Subscription } from '../database/schemas/subscription.schema';

export const registerGuest = async (guestId: string) => {
  if (!guestId) {
    throw new Error('Guest id is required');
  }

  const user = await User.findOneAndUpdate(
    {
      externalAuthId: guestId,
      signUpType: SignUpType.GUEST,
      isGuest: true,
    },
    {
      $setOnInsert: {
        externalAuthId: guestId,
        signUpType: SignUpType.GUEST,
        isGuest: true,
        email: `guest_${guestId}@guest.quotii.local`,
      },
    },
    { upsert: true, new: true }
  );

  const { accessToken, refreshToken } = await createTokens({
    id: user._id,
    email: user.email,
  });

  return { accessToken, refreshToken, user };
};

export const getUser = async (userId: string) => {
  const user = await User.findById(userId).exec();
  if (!user) {
    console.log('User not found.');
    return null;
  } else {
    return user;
  }
};

export const updateUserDeviceToken = async (
  token: string,
  userId: string
): Promise<boolean> => {
  try {
    const result = await User.findByIdAndUpdate(
      userId,
      {
        $addToSet: { deviceIds: token },
      },
      { new: true }
    );

    if (result) {
      console.log(`Device token updated for user ${userId}`);
      return true;
    } else {
      console.log(`User ${userId} not found`);
      return false;
    }
  } catch (error) {
    console.error(`Error updating device token for user ${userId}:`, error);
    return false;
  }
};

export const loginWithApple = async (
  idToken: string,
  firstName?: string,
  lastName?: string,
  timeZone?: string
) => {
  console.log('login with Apple called for idToken --> ', idToken);
  console.log('timezone is --> ', timeZone);

  try {
    const appleUser = await verifyAppleToken({
      idToken: idToken,
      clientId: process.env.APP_ID as string,
    });

    console.log('validated apple IdToken --> ', appleUser);

    const updateObj: any = {
      $set: {
        email: appleUser.email,
      },
    };

    // Only add firstName and lastName if they are provided and not null
    if (firstName) {
      updateObj.$set.firstName = firstName;
    }
    if (lastName) {
      updateObj.$set.lastName = lastName;
    }
    if (timeZone) {
      updateObj.$set.timeZone = timeZone;
    }

    // Find or create user in your database
    const user = await User.findOneAndUpdate(
      {
        externalAuthId: appleUser.sub,
        signUpType: SignUpType.APPLE,
      },
      updateObj,
      { upsert: true, new: true }
    );
    const subscription = await Subscription.findOneAndUpdate(
      { userId: user.id as string },
      { active: true },
      { upsert: true, new: true }
    );

    // Generate JWT
    const { accessToken, refreshToken } = await createTokens({
      id: user._id,
      email: user.email,
    });
    const data = { accessToken, refreshToken, user, subscription };
    console.log('user validated returning --> ', data);
    return data;
  } catch (e) {
    console.log('error validating apple IdToken --> ', e);
    throw new Error('Error validating apple user');
  }
};

export const updateUserNickname = async (
  userId: string,
  nickname: string
): Promise<any> => {
  try {
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { nickName: nickname },
      { new: true }
    );

    if (!updatedUser) {
      throw new Error('User not found');
    }

    return updatedUser;
  } catch (error) {
    console.error(`Error updating nickname for user ${userId}:`, error);
    throw error;
  }
};
export const getUserSubscriptions = async (userId: string) => {
  return await Subscription.find({ userId });
};
