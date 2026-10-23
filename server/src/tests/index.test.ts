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

import App from '@/app';
import HealthRoute from '@routes/health.route';
import WebhookRoute from '@routes/webhook.route';
import request from 'supertest';
import { getSignature } from '@/utils/signature';

// DB_HOST is not set, so App does not try to connect to MongoDB.
const buildServer = () => new App([new WebhookRoute(), new HealthRoute()]).getServer();

const signedPost = (server, payload: object) => {
  const body = JSON.stringify(payload);
  const timestamp = Date.now();
  const signature = getSignature({ secret: 'test-signing-secret', body, timestamp });
  return request(server)
    .post('/api/webhook')
    .set('Content-Type', 'application/json')
    .set('x-tribe-request-timestamp', String(timestamp))
    .set('x-tribe-signature', signature)
    .send(body);
};

describe('App', () => {
  it('[GET] /_health responds 200', async () => {
    // Arrange
    const server = buildServer();

    // Act
    const res = await request(server).get('/_health');

    // Assert
    expect(res.status).toBe(200);
  });

  it('[POST] /api/webhook rejects an unsigned request with 403', async () => {
    // Arrange
    const server = buildServer();

    // Act
    const res = await request(server).post('/api/webhook').send({ type: 'TEST', data: { challenge: 'abc' } });

    // Assert
    expect(res.status).toBe(403);
    expect(res.body).not.toEqual(expect.objectContaining({ status: 'SUCCEEDED' }));
  });

  it('[POST] /api/webhook rejects a request signed with the wrong secret with 403', async () => {
    // Arrange
    const server = buildServer();
    const body = JSON.stringify({ type: 'TEST', data: { challenge: 'abc' } });
    const timestamp = Date.now();
    const signature = getSignature({ secret: 'wrong-secret', body, timestamp });

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

  it('[POST] /api/webhook answers a signed TEST challenge', async () => {
    // Arrange
    const server = buildServer();

    // Act
    const res = await signedPost(server, { type: 'TEST', data: { challenge: 'abc' } });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'TEST', status: 'SUCCEEDED', data: { challenge: 'abc' } });
  });

  it('[POST] /api/webhook answers a signed GET_SETTINGS', async () => {
    // Arrange
    const server = buildServer();

    // Act
    const res = await signedPost(server, { type: 'GET_SETTINGS', networkId: 'net', context: 'NETWORK', currentSettings: [], data: {} });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'GET_SETTINGS', status: 'SUCCEEDED', data: {} });
  });
});
