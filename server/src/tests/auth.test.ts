jest.mock('@/config', () => ({
  CLIENT_ID: 'client-id',
  CLIENT_SECRET: 'test-client-secret',
  GRAPHQL_URL: 'https://api.example.com/graphql',
  MAILCHIMP_CLIENT_ID: 'mc-client-id',
  MAILCHIMP_CLIENT_SECRET: 'mc-client-secret',
  SERVER_URL: 'https://mailchimp-app.example.com',
  LOG_DIR: '../logs',
  LOG_FORMAT: 'error',
}));

const mockNetworkGet = jest.fn();
jest.mock('@tribeplatform/gql-client', () => ({
  GlobalClient: jest.fn().mockImplementation(() => ({
    getTribeClient: jest.fn().mockResolvedValue({ network: { get: mockNetworkGet } }),
  })),
}));

jest.mock('@/models/mailchimp.model', () => ({
  __esModule: true,
  default: { findOneAndReplace: jest.fn() },
}));

import express from 'express';
import passport from 'passport';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import passportMiddleware, { handleMailchimpAuthorization } from '@/middlewares/passport.middleware';
import AuthRoute from '@/routes/auth.route';
import MailchimpModel from '@/models/mailchimp.model';
import { sign } from '@/utils/auth';
import { createOAuthState, verifyOAuthState } from '@/utils/oauthState';

const findOneAndReplace = MailchimpModel.findOneAndReplace as jest.Mock;
const profile = { _json: { accountname: 'Acme', dc: 'us1', api_endpoint: 'https://us1.api.mailchimp.com' } };

const buildApp = () => {
  const app = express();
  passportMiddleware.init(app);
  app.use(new AuthRoute().router);
  return app;
};

const callVerify = (state: unknown) =>
  new Promise<{ err: unknown; user: unknown }>(resolve => {
    handleMailchimpAuthorization({ query: { state } } as any, 'mc-access-token', undefined, profile, (err, user) => resolve({ err, user }));
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockNetworkGet.mockResolvedValue({ domain: 'community.example.com' });
  findOneAndReplace.mockResolvedValue({ networkId: 'net-1' });
});

describe('GET /api/mailchimp/auth', () => {
  it('redirects to Mailchimp with a signed state for the jwt network and a validated redirect', async () => {
    // Arrange
    const app = buildApp();
    const token = sign({ networkId: 'net-1', memberId: 'mem-1' });

    // Act
    const res = await request(app)
      .get('/api/mailchimp/auth')
      .query({ jwt: token, redirect: 'https://community.example.com/manage/app-store/apps/kwrNURPZ0l0w' });

    // Assert
    expect(res.status).toBe(302);
    const location = new URL(res.header.location);
    expect(location.host).toBe('login.mailchimp.com');
    expect(location.searchParams.get('redirect_uri')).toBe('https://mailchimp-app.example.com/api/mailchimp/auth/callback');
    expect(verifyOAuthState(location.searchParams.get('state'))).toEqual({
      networkId: 'net-1',
      memberId: 'mem-1',
      redirect: 'https://community.example.com/manage/app-store/apps/kwrNURPZ0l0w',
    });
  });

  it('drops a redirect that points outside the community', async () => {
    // Arrange
    const app = buildApp();
    const token = sign({ networkId: 'net-1', memberId: 'mem-1' });

    // Act
    const res = await request(app).get('/api/mailchimp/auth').query({ jwt: token, redirect: 'https://evil.example/phish' });

    // Assert
    expect(res.status).toBe(302);
    const state = verifyOAuthState(new URL(res.header.location).searchParams.get('state'));
    expect(state.networkId).toBe('net-1');
    expect(state.redirect).toBeUndefined();
  });

  it('still starts the flow without a redirect when the network cannot be loaded', async () => {
    // Arrange
    const app = buildApp();
    mockNetworkGet.mockRejectedValue(new Error('boom'));
    const token = sign({ networkId: 'net-1', memberId: 'mem-1' });

    // Act
    const res = await request(app).get('/api/mailchimp/auth').query({ jwt: token, redirect: 'https://community.example.com/x' });

    // Assert
    expect(res.status).toBe(302);
    expect(verifyOAuthState(new URL(res.header.location).searchParams.get('state')).redirect).toBeUndefined();
  });

  it('rejects an invalid jwt', async () => {
    // Arrange
    const app = buildApp();
    const token = jwt.sign({ sub: 'net-1' }, 'wrong-secret');

    // Act
    const res = await request(app).get('/api/mailchimp/auth').query({ jwt: token });

    // Assert
    expect(res.status).toBe(403);
  });
});

describe('GET /api/mailchimp/auth/callback', () => {
  it('rejects a forged unsigned state before exchanging the code and saves nothing', async () => {
    // Arrange
    const app = buildApp();
    const forged = Buffer.from(JSON.stringify({ n: 'victim-net', m: 'x', r: 'https://evil.example' }), 'ascii').toString('base64');

    // Act
    const res = await request(app).get('/api/mailchimp/auth/callback').query({ code: 'abc', state: forged });

    // Assert
    expect(res.status).toBe(403);
    expect(res.header.location).toBeUndefined();
    expect(findOneAndReplace).not.toHaveBeenCalled();
  });

  it('exchanges the code, saves the connection for the signed network and redirects back', async () => {
    // Arrange
    const app = buildApp();
    const strategy: any = (passport as any)._strategy('mailchimp');
    jest.spyOn(strategy._oauth2, 'getOAuthAccessToken').mockImplementation((code, params, cb: any) => cb(null, 'mc-access-token', undefined, {}));
    jest.spyOn(strategy, 'userProfile').mockImplementation((token, cb: any) => cb(null, profile));
    const state = createOAuthState({ networkId: 'net-1', memberId: 'mem-1', redirect: 'https://community.example.com/manage' });

    // Act
    const res = await request(app).get('/api/mailchimp/auth/callback').query({ code: 'abc', state });

    // Assert
    expect(res.status).toBe(302);
    expect(res.header.location).toBe('https://community.example.com/manage');
    expect(findOneAndReplace).toHaveBeenCalledWith(
      { networkId: 'net-1' },
      expect.objectContaining({ networkId: 'net-1', accessToken: 'mc-access-token' }),
      {
        upsert: true,
        returnDocument: 'after',
      },
    );
  });

  it('rejects a callback without state', async () => {
    // Arrange
    const app = buildApp();

    // Act
    const res = await request(app).get('/api/mailchimp/auth/callback').query({ code: 'abc' });

    // Assert
    expect(res.status).toBe(403);
    expect(findOneAndReplace).not.toHaveBeenCalled();
  });
});

describe('Mailchimp strategy verify callback', () => {
  it('saves the connection for the network in a valid signed state', async () => {
    // Arrange
    const state = createOAuthState({ networkId: 'net-1', memberId: 'mem-1' });

    // Act
    const { err, user } = await callVerify(state);

    // Assert
    expect(err).toBeNull();
    expect(user).toEqual({ networkId: 'net-1' });
    expect(findOneAndReplace).toHaveBeenCalledWith(
      { networkId: 'net-1' },
      {
        name: 'Acme',
        connectedBy: 'mem-1',
        networkId: 'net-1',
        accessToken: 'mc-access-token',
        dataCentre: 'us1',
        apiEndpoint: 'https://us1.api.mailchimp.com',
      },
      { upsert: true, returnDocument: 'after' },
    );
  });

  it.each([
    ['forged unsigned', Buffer.from(JSON.stringify({ n: 'victim-net', m: 'x' }), 'ascii').toString('base64')],
    ['wrong secret', jwt.sign({ n: 'victim-net', nonce: 'a' }, 'other', { audience: 'mailchimp-app:oauth-state', issuer: 'mailchimp-app' })],
    [
      'expired',
      jwt.sign({ n: 'net-1', nonce: 'a', exp: Math.floor(Date.now() / 1000) - 1 }, 'test-client-secret', {
        audience: 'mailchimp-app:oauth-state',
        issuer: 'mailchimp-app',
      }),
    ],
    ['missing', undefined],
  ])('rejects a %s state and saves nothing', async (_label, state) => {
    // Act
    const { err, user } = await callVerify(state);

    // Assert
    expect(err).toBeNull();
    expect(user).toBe(false);
    expect(findOneAndReplace).not.toHaveBeenCalled();
  });
});

describe('callback redirects', () => {
  it('redirects to the redirect stored in the verified state', async () => {
    // Arrange
    const controller = new AuthRoute().authController;
    const state = verifyOAuthState(createOAuthState({ networkId: 'net-1', redirect: 'https://community.example.com/manage' }));
    const res: any = { locals: { oauthState: state }, redirect: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

    // Act
    await controller.authCallback({ query: {} } as any, res, jest.fn());

    // Assert
    expect(res.redirect).toHaveBeenCalledWith('https://community.example.com/manage');
  });

  it('does not redirect from the failure route when the state is not signed', async () => {
    // Arrange
    const app = buildApp();
    const forged = Buffer.from(JSON.stringify({ n: 'net-1', r: 'https://evil.example' }), 'ascii').toString('base64');

    // Act
    const res = await request(app).get('/api/mailchimp/auth/callback/failure').query({ state: forged });

    // Assert
    expect(res.status).toBe(200);
    expect(res.header.location).toBeUndefined();
    expect(res.body).toEqual({ success: false });
  });
});
