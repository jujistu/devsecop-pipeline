import { Request } from 'express';
import { decodeAuthHeader } from './utils/auth.util';

export const context = async ({ req }: { req: Request }) => {
  const token = req.headers.authorization || '';

  // console.log('Decoding auth header. Token is --> ', token);
  const user = await decodeAuthHeader(token.replace('Bearer ', ''));
  // console.log('Auth header decoded. Payload is --> ', user);

  return {
    user,
  };
};
