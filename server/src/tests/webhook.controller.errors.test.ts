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

const mockGetTribeClient = jest.fn();
jest.mock('@tribeplatform/gql-client', () => ({
  ...(jest.requireActual('@tribeplatform/gql-client') as object),
  GlobalClient: jest.fn().mockImplementation(() => ({ getTribeClient: mockGetTribeClient })),
}));

jest.mock('@/models/mailchimp.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('@/models/segments.model', () => ({ __esModule: true, default: { findOne: jest.fn(), findOneAndReplace: jest.fn() } }));
jest.mock('axios', () => ({ __esModule: true, default: { request: jest.fn() } }));

import axios from 'axios';
import MailchimpModel from '@/models/mailchimp.model';
import MailchimpService from '@/services/mailchimp.services';
import WebhookController from '@controllers/webhook.controller';

const connection = {
  networkId: 'net1',
  accessToken: 'mc-secret-token',
  apiEndpoint: 'https://us16.api.mailchimp.com',
  audienceId: 'list1',
  segmentPrefix: 'Community',
  sendEvents: true,
  sendName: true,
};

const callIndex = async (body: any) => {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await new WebhookController().index({ body } as any, res, jest.fn());
  return res;
};

const allLogLines = () =>
  [...mockLogger.log.mock.calls, ...mockLogger.info.mock.calls, ...mockLogger.error.mock.calls, ...mockLogger.warn.mock.calls]
    .map(args => args.map(a => (a instanceof Error ? `${a.message} ${JSON.stringify(a)}` : JSON.stringify(a))).join(' '))
    .join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  (MailchimpModel.findOne as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(connection) });
});

describe('WebhookController error handling', () => {
  it('answers FAILED instead of leaving the request open when a handler throws', async () => {
    // Arrange
    mockGetTribeClient.mockRejectedValue(new Error('Bettermode is down'));

    // Act
    const res = await callIndex({ type: 'LOAD_BLOCK', networkId: 'net1', data: { actorId: 'm1' } });

    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ type: 'LOAD_BLOCK', status: 'FAILED', data: {} });
  });

  it('skips the Mailchimp event for an event without an actor instead of throwing', async () => {
    // Arrange
    const tribeClient = { members: { get: jest.fn() } };
    mockGetTribeClient.mockResolvedValue(tribeClient);

    // Act
    const res = await callIndex({
      type: 'SUBSCRIPTION',
      networkId: 'net1',
      data: { name: 'post.published', shortDescription: 'Post published', time: '2026-10-21T07:00:00Z', object: { id: 'p1' } },
    });

    // Assert
    expect(res.json).toHaveBeenCalledWith({ type: 'SUBSCRIPTION', status: 'SUCCEEDED', data: {} });
    expect(tribeClient.members.get).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('reports a failed Mailchimp sync as FAILED (not FALIED)', async () => {
    // Arrange
    const tribeClient = { members: { get: jest.fn().mockResolvedValue({ id: 'm1', name: 'Ada L', email: 'ada@example.com' }) } };
    mockGetTribeClient.mockResolvedValue(tribeClient);
    (axios.request as jest.Mock).mockRejectedValue({
      response: { status: 429, data: { title: 'Too Many Requests', detail: 'ada@example.com: too many' } },
      config: { headers: { Authorization: 'Bearer mc-secret-token' } },
    });

    // Act
    const res = await callIndex({
      type: 'SUBSCRIPTION',
      networkId: 'net1',
      data: { name: 'post.published', shortDescription: 'Post published', time: '2026-10-21T07:00:00Z', actor: { id: 'm1' }, object: { id: 'p1' } },
    });

    // Assert
    expect(res.json).toHaveBeenCalledWith({ type: 'SUBSCRIPTION', status: 'FAILED', data: {} });
  });

  it('does not log the webhook payload, member emails or the Mailchimp token', async () => {
    // Arrange
    const tribeClient = { members: { get: jest.fn().mockResolvedValue({ id: 'm1', name: 'Ada L', email: 'ada@example.com' }) } };
    mockGetTribeClient.mockResolvedValue(tribeClient);
    (axios.request as jest.Mock).mockRejectedValue({
      response: { status: 400, data: { title: 'Member Exists', detail: 'ada@example.com is already a list member.' } },
      config: { headers: { Authorization: 'Bearer mc-secret-token' } },
    });

    // Act
    await callIndex({
      type: 'SUBSCRIPTION',
      networkId: 'net1',
      data: {
        name: 'member.verified',
        actor: { id: 'm1', sessionInfo: { ip: '203.0.113.7' } },
        object: { id: 'm1', name: 'Ada L', email: 'ada@example.com' },
      },
    });

    // Assert
    const logged = allLogLines();
    expect(logged).toContain('Member Exists');
    expect(logged).not.toContain('ada@example.com');
    expect(logged).not.toContain('203.0.113.7');
    expect(logged).not.toContain('mc-secret-token');
  });
});

describe('MailchimpService errors', () => {
  it('rethrows a compact error without the token, the email detail or the subscriber hash', async () => {
    // Arrange
    (axios.request as jest.Mock).mockRejectedValue({
      response: { status: 400, data: { title: 'Member Exists', detail: 'ada@example.com is already a list member.' } },
      config: { headers: { Authorization: 'Bearer mc-secret-token' } },
    });
    const service = new MailchimpService('mc-secret-token', 'https://us16.api.mailchimp.com');

    // Act
    const error = await service
      .list('list1')
      .getMember({ email: 'ada@example.com' })
      .catch(e => e);

    // Assert
    expect(error.message).toBe('Mailchimp GET /lists/list1/members/{subscriber_hash} failed: 400 Member Exists');
    expect(error.status).toBe(400);
    expect(error.response.status).toBe(400);
    expect(JSON.stringify(error)).not.toContain('mc-secret-token');
    expect(JSON.stringify(error)).not.toContain('ada@example.com');
  });

  it('describes a network error by its code', async () => {
    // Arrange
    (axios.request as jest.Mock).mockRejectedValue({ code: 'ETIMEDOUT' });
    const service = new MailchimpService('mc-secret-token', 'https://us16.api.mailchimp.com');

    // Act
    const error = await service.lists.list().catch(e => e);

    // Assert
    expect(error.message).toBe('Mailchimp GET /lists failed: no response ETIMEDOUT');
    expect(error.status).toBeUndefined();
  });
});
