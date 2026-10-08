import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { CLIENT_SECRET } from '@/config';

const STATE_AUDIENCE = 'mailchimp-app:oauth-state';
const STATE_ISSUER = 'mailchimp-app';
const STATE_EXPIRY = '30m';

export interface OAuthState {
  networkId: string;
  memberId?: string;
  redirect?: string;
}

/**
 * Creates a signed, short-lived OAuth `state` value carrying the network that
 * started the Mailchimp authorization flow.
 */
export const createOAuthState = ({ networkId, memberId, redirect }: OAuthState): string => {
  const payload: Record<string, string> = {
    n: networkId,
    nonce: randomBytes(16).toString('hex'),
  };
  if (memberId) payload.m = memberId;
  if (redirect) payload.r = redirect;
  return jwt.sign(payload, CLIENT_SECRET, {
    expiresIn: STATE_EXPIRY,
    audience: STATE_AUDIENCE,
    issuer: STATE_ISSUER,
  });
};

/**
 * Verifies a state value produced by `createOAuthState`.
 * Returns null when the state is missing, unsigned, tampered with or expired.
 */
export const verifyOAuthState = (state: unknown): OAuthState | null => {
  if (typeof state !== 'string' || !state) return null;
  try {
    const decoded = jwt.verify(state, CLIENT_SECRET, {
      audience: STATE_AUDIENCE,
      issuer: STATE_ISSUER,
      algorithms: ['HS256'],
    }) as { n?: unknown; m?: unknown; r?: unknown; nonce?: unknown };
    if (!decoded || typeof decoded.n !== 'string' || !decoded.n || typeof decoded.nonce !== 'string') return null;
    return {
      networkId: decoded.n,
      memberId: typeof decoded.m === 'string' ? decoded.m : undefined,
      redirect: typeof decoded.r === 'string' ? decoded.r : undefined,
    };
  } catch (err) {
    return null;
  }
};

const isRelativePath = (value: string) => /^\/(?![/\\])/.test(value) && !/[\r\n]/.test(value);

/**
 * Returns the redirect if it is safe to send the user to after the OAuth flow:
 * either a same-origin relative path, or an https URL on the community's own host.
 * Returns undefined otherwise.
 */
export const sanitizeRedirect = (redirect: unknown, networkDomain?: string): string | undefined => {
  if (typeof redirect !== 'string' || !redirect) return undefined;
  if (isRelativePath(redirect)) return redirect;
  if (!networkDomain) return undefined;
  try {
    const url = new URL(redirect);
    const allowedHost = new URL(`https://${networkDomain}`).host;
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    if (url.host !== allowedHost) return undefined;
    return url.toString();
  } catch (err) {
    return undefined;
  }
};

/**
 * Re-checks a redirect read back from a verified state before using it.
 */
export const isSafeStoredRedirect = (redirect: unknown): redirect is string => {
  if (typeof redirect !== 'string' || !redirect) return false;
  if (isRelativePath(redirect)) return true;
  try {
    const url = new URL(redirect);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch (err) {
    return false;
  }
};
