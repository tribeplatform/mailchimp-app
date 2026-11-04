jest.mock('@/config', () => ({
  CLIENT_ID: 'test-client-id',
  CLIENT_SECRET: 'test-client-secret',
  SIGNING_SECRET: 'test-signing-secret',
  GRAPHQL_URL: 'https://api.bettermode.test/graphql',
  SERVER_URL: 'https://mailchimp-app.test',
  MAILCHIMP_CLIENT_ID: 'mailchimp-client-id',
  MAILCHIMP_CLIENT_SECRET: 'mailchimp-client-secret',
  LOG_DIR: '../logs',
}));

const mockLogger = { log: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@utils/logger', () => ({
  logger: mockLogger,
  stream: { write: jest.fn() },
  createLogger: () => mockLogger,
}));

import express from 'express';
import request from 'supertest';
import App from '@/app';
import HealthRoute from '@routes/health.route';
import WebhookRoute from '@routes/webhook.route';
import errorMiddleware from '@middlewares/error.middleware';
import { getSignature, verifySignature } from '@/utils/signature';

// DB_HOST is not set, so App does not try to connect to MongoDB.
const buildServer = () => new App([new WebhookRoute(), new HealthRoute()]).getServer();

const signedPost = (server, body: string) => {
  const timestamp = Date.now();
  const signature = getSignature({ secret: 'test-signing-secret', body, timestamp });
  return request(server)
    .post('/api/webhook')
    .set('Content-Type', 'application/json')
    .set('x-tribe-request-timestamp', String(timestamp))
    .set('x-tribe-signature', signature)
    .send(body);
};

beforeEach(() => jest.clearAllMocks());

describe('webhook signature', () => {
  it('rejects an unsigned request with 403 and logs no error', async () => {
    // Arrange
    const server = buildServer();

    // Act
    const res = await request(server).post('/api/webhook').send({ type: 'TEST', data: { challenge: 'abc' } });

    // Assert
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'The x-tribe-signature is not valid.' });
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('StatusCode:: 403'));
  });

  it('rejects a stale signature with 403', async () => {
    // Arrange
    const server = buildServer();
    const body = JSON.stringify({ type: 'TEST', data: { challenge: 'abc' } });
    const timestamp = Date.now() - 10 * 60 * 1000;
    const signature = getSignature({ secret: 'test-signing-secret', body, timestamp });

    // Act
    const res = await request(server)
      .post('/api/webhook')
      .set('Content-Type', 'application/json')
      .set('x-tribe-request-timestamp', String(timestamp))
      .set('x-tribe-signature', signature)
      .send(body);

    // Assert
    expect(res.status).toBe(403);
  });

  it('verifySignature returns false instead of throwing for a missing or short signature', () => {
    // Arrange
    const options = { secret: 's', body: '{}', timestamp: Date.now() };

    // Act
    const missing = verifySignature({ ...options, signature: undefined });
    const short = verifySignature({ ...options, signature: 'abc' });
    const noTimestamp = verifySignature({ ...options, timestamp: NaN, signature: getSignature(options) });

    // Assert
    expect(missing).toBe(false);
    expect(short).toBe(false);
    expect(noTimestamp).toBe(false);
  });
});

describe('body limit', () => {
  it('accepts a signed 500kb webhook', async () => {
    // Arrange
    const server = buildServer();
    const body = JSON.stringify({ type: 'TEST', data: { challenge: 'abc', padding: 'x'.repeat(500 * 1024) } });

    // Act
    const res = await signedPost(server, body);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCEEDED');
  });
});

describe('errorMiddleware', () => {
  it('returns a generic message for a 5xx and logs it as an error', async () => {
    // Arrange
    const app = express();
    app.get('/boom', () => {
      throw new Error('connection string mongodb://user:pw@host');
    });
    app.use(errorMiddleware);

    // Act
    const res = await request(app).get('/boom');

    // Assert
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Something went wrong' });
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
