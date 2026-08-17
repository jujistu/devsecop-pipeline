import * as jwt from 'jsonwebtoken';
import { JwtPayload, sign } from 'jsonwebtoken';
import { User } from '../database/schemas/user.schema';

export const createAccessToken = (payload: JwtPayload) => {
  return sign(payload, process.env.JWT_ACCESS_SECRET as string, {
    // expiresIn: process.env.JWT_ACCESS_EXPIRATION,
    expiresIn: '600d'
  });
};

export const createRefreshToken = (payload: JwtPayload) => {
  return sign(payload, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: process.env.JWT_REFRESH_EXPIRATION,
  });
};
export const createTokens = async (payload: JwtPayload) => {
  const accessToken = createAccessToken(payload);
  const refreshToken = createRefreshToken(payload);

  return {
    accessToken,
    refreshToken,
  };
};

export const decodeAuthHeader = async (token: string) => {
  if (!token) {
    return null;
  }
  try {
    const verification = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET as string
    ) as JwtPayload;
    return verification;
  } catch (e) {
    return null;
  }
};

export const verifyRefreshToken = async (refreshToken: string) => {
  try {
    const payload = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET as string
    ) as JwtPayload;
    const user = await User.findById(payload.id);

    if (!user) {
      throw new Error('User not found');
    }

    return { id: user._id, email: user.email };
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};

export const refreshTokens = async (refreshToken: string) => {
  const payload = await verifyRefreshToken(refreshToken);
  const { accessToken, refreshToken: newRefreshToken } = await createTokens(
    payload
  );
  return { accessToken, refreshToken: newRefreshToken };
};
