import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL } from '@/config';
import { GlobalClient, TribeClient } from '@tribeplatform/gql-client';
import jwt from 'jsonwebtoken';

// Bettermode rate-limits API calls ("You have made too many requests and exceeded the API quota").
// Every SUBSCRIPTION webhook used to fetch a new app token (`limitedToken`), so the client is cached per network.
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_CLIENT_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { value: Promise<TribeClient>; expiresAt: number };

const clientCache = new Map<string, CacheEntry>();

export const clearTribeClientCache = () => clientCache.clear();

const clientExpiresAt = (client: TribeClient): number => {
  // TribeClient keeps the app token on its (private) GraphqlClient.
  const token: string = (client as any)?.client?.accessToken || (client as any)?.accessToken || '';
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded?.exp) return decoded.exp * 1000 - TOKEN_EXPIRY_MARGIN_MS;
  return Date.now() + DEFAULT_CLIENT_TTL_MS;
};

export const getTribeClient = ({ networkId }: { networkId: string }): Promise<TribeClient> => {
  const entry = clientCache.get(networkId);
  if (entry && entry.expiresAt > Date.now()) return entry.value;

  const value = new GlobalClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    graphqlUrl: GRAPHQL_URL,
  }).getTribeClient({ networkId });
  // Concurrent webhooks for the same network share one in-flight request.
  const newEntry: CacheEntry = { value, expiresAt: Number.MAX_SAFE_INTEGER };
  clientCache.set(networkId, newEntry);
  value.then(
    client => {
      newEntry.expiresAt = clientExpiresAt(client);
    },
    () => {
      // Never cache failures (e.g. a 429): the next webhook tries again.
      if (clientCache.get(networkId) === newEntry) clientCache.delete(networkId);
    },
  );
  return value;
};
