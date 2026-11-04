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
import md5 from 'md5';
import MailchimpModel from '@/models/mailchimp.model';
import SegmentModel from '@/models/segments.model';
import WebhookController from '@controllers/webhook.controller';
import { clearTribeClientCache } from '@/utils/tribe_client';

const connection = {
  networkId: 'net1',
  accessToken: 'mc-token',
  apiEndpoint: 'https://us16.api.mailchimp.com',
  audienceId: 'list1',
  segmentPrefix: 'Community',
  sendEvents: false,
  sendName: false,
};

const mailchimpError = (status: number, title?: string) => ({ response: { status, data: title ? { title } : '<HTML>Access Denied</HTML>' } });

const callIndex = async (body: any) => {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await new WebhookController().index({ body } as any, res, jest.fn());
  return res;
};

const mailchimpCalls = () => (axios.request as jest.Mock).mock.calls.map(([config]) => `${config.method} ${config.url.replace('https://us16.api.mailchimp.com/3.0', '')}`);

const tribeClient = {
  members: { get: jest.fn().mockResolvedValue({ id: 'm1', name: 'Ada Lovelace', email: 'Ada@Example.com' }) },
  spaces: { get: jest.fn().mockResolvedValue({ id: 's1', name: 'General' }) },
  spaceMembers: { listSpaces: jest.fn().mockResolvedValue({ nodes: [] }) },
};

beforeEach(() => {
  jest.clearAllMocks();
  clearTribeClientCache();
  mockGetTribeClient.mockResolvedValue(tribeClient);
  (MailchimpModel.findOne as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(connection) });
  (SegmentModel.findOne as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(null) });
});

describe('member sync', () => {
  it('adds a new member with an idempotent PUT on the lowercased subscriber hash', async () => {
    // Arrange
    (axios.request as jest.Mock).mockRejectedValueOnce(mailchimpError(404, 'Resource Not Found')).mockResolvedValueOnce({ data: {} });
    const hash = md5('ada@example.com');

    // Act
    const res = await callIndex({ type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'member.verified', object: { id: 'm1', name: 'Ada Lovelace', email: 'Ada@Example.com' } } });

    // Assert
    expect(res.json).toHaveBeenCalledWith({ type: 'SUBSCRIPTION', status: 'SUCCEEDED', data: {} });
    expect(mailchimpCalls()).toEqual([`GET /lists/list1/members/${hash}`, `PUT /lists/list1/members/${hash}`]);
    expect((axios.request as jest.Mock).mock.calls[1][0].data).toEqual({
      email_address: 'Ada@Example.com',
      status_if_new: 'subscribed',
      merge_fields: { FNAME: 'Ada', LNAME: 'Lovelace' },
    });
  });

  it('stops the sync when the member lookup fails with something other than 404', async () => {
    // Arrange
    (axios.request as jest.Mock).mockRejectedValueOnce(mailchimpError(403));

    // Act
    const res = await callIndex({ type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'member.verified', object: { id: 'm1', name: 'Ada', email: 'ada@example.com' } } });

    // Assert
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: expect.not.stringMatching('SUCCEEDED') }));
    expect(mailchimpCalls()).toHaveLength(1);
  });

  it('includes email_address when updating a member, so the PUT can create the contact', async () => {
    // Arrange
    (MailchimpModel.findOne as jest.Mock).mockReturnValue({ lean: () => Promise.resolve({ ...connection, sendName: true }) });
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { id: 'x' } }).mockResolvedValueOnce({ data: {} });

    // Act
    await callIndex({ type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'member.updated', object: { id: 'm1', name: 'Ada', email: 'ada@example.com' } } });

    // Assert
    expect((axios.request as jest.Mock).mock.calls[1][0]).toEqual(
      expect.objectContaining({ method: 'PUT', data: expect.objectContaining({ email_address: 'ada@example.com' }) }),
    );
  });
});

describe('tag sync', () => {
  it('does not try to create a tag when the tag lookup is denied', async () => {
    // Arrange
    (SegmentModel.findOne as jest.Mock).mockReturnValue({ lean: () => Promise.resolve({ segmentId: '42' }) });
    (axios.request as jest.Mock).mockRejectedValue(mailchimpError(403));

    // Act
    await callIndex({ type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'space.updated', object: { id: 's1', name: 'General' } } });

    // Assert
    expect(mailchimpCalls()).toEqual(['GET /lists/list1/segments/42']);
  });

  it('recreates a tag that was deleted in Mailchimp', async () => {
    // Arrange
    (SegmentModel.findOne as jest.Mock).mockReturnValue({ lean: () => Promise.resolve({ segmentId: '42' }) });
    (axios.request as jest.Mock).mockRejectedValueOnce(mailchimpError(404, 'Resource Not Found')).mockResolvedValueOnce({ data: { id: 43 } });

    // Act
    const res = await callIndex({ type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'space.updated', object: { id: 's1', name: 'General' } } });

    // Assert
    expect(res.json).toHaveBeenCalledWith({ type: 'SUBSCRIPTION', status: 'SUCCEEDED', data: {} });
    expect(mailchimpCalls()).toEqual(['GET /lists/list1/segments/42', 'POST /lists/list1/segments']);
    expect(SegmentModel.findOneAndReplace).toHaveBeenCalledWith({ networkId: 'net1', spaceId: 's1' }, { networkId: 'net1', spaceId: 's1', segmentId: 43 }, { upsert: true });
  });

  it('reuses an existing tag with the same name instead of failing with "tag already exists"', async () => {
    // Arrange
    (axios.request as jest.Mock)
      .mockRejectedValueOnce(mailchimpError(400, 'Bad Request'))
      .mockResolvedValueOnce({ data: { segments: [{ id: 7, name: 'Other' }, { id: 9, name: 'community general' }] } });

    // Act
    const res = await callIndex({ type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'space.created', object: { id: 's1', name: 'General' } } });

    // Assert
    expect(res.json).toHaveBeenCalledWith({ type: 'SUBSCRIPTION', status: 'SUCCEEDED', data: {} });
    expect(mailchimpCalls()[1]).toBe('GET /lists/list1/segments?type=static&count=1000&fields=segments.id,segments.name');
    expect(SegmentModel.findOneAndReplace).toHaveBeenCalledWith({ networkId: 'net1', spaceId: 's1' }, { networkId: 'net1', spaceId: 's1', segmentId: 9 }, { upsert: true });
  });
});

describe('Bettermode API calls', () => {
  it('does not fetch a Bettermode token for a network without a finished Mailchimp setup', async () => {
    // Arrange
    (MailchimpModel.findOne as jest.Mock).mockReturnValue({ lean: () => Promise.resolve({ ...connection, audienceId: undefined }) });

    // Act
    const res = await callIndex({ type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'post.published', object: { id: 'p1' } } });

    // Assert
    expect(res.json).toHaveBeenCalledWith({ type: 'SUBSCRIPTION', status: 'SUCCEEDED', data: {} });
    expect(mockGetTribeClient).not.toHaveBeenCalled();
  });

  it('reuses the Bettermode client across webhooks for the same network', async () => {
    // Arrange
    (axios.request as jest.Mock).mockResolvedValue({ data: {} });
    const body = { type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'post.published', object: { id: 'p1' } } };

    // Act
    await callIndex(body);
    await callIndex(body);

    // Assert
    expect(mockGetTribeClient).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed token request', async () => {
    // Arrange
    mockGetTribeClient.mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce(tribeClient);
    const body = { type: 'SUBSCRIPTION', networkId: 'net1', data: { name: 'post.published', object: { id: 'p1' } } };

    // Act
    await callIndex(body).catch(() => undefined);
    await callIndex(body);

    // Assert
    expect(mockGetTribeClient).toHaveBeenCalledTimes(2);
  });
});
