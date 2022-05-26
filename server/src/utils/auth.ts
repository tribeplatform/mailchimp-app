import { CLIENT_SECRET, GRAPHQL_URL } from '@/config';
import jwt from 'jsonwebtoken';

export const sign = (options: { networkId: string; memberId: string }) => {
  const payload = {
    sub: options.networkId,
    aud: GRAPHQL_URL,
    iss: 'tribe-slack-app',
  } as any;
  if (options.memberId) payload.usr = options.memberId;
  return jwt.sign(payload, CLIENT_SECRET, {
    expiresIn: '2d',
  });
};
export const verify = (token: string) => {
  return jwt.verify(token, CLIENT_SECRET, {
    ignoreExpiration: false,
  });
};

export default {
  sign,
  verify,
};
