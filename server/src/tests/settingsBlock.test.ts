jest.mock('@/config', () => ({
  CLIENT_ID: 'client-id',
  CLIENT_SECRET: 'test-client-secret',
  GRAPHQL_URL: 'https://api.example.com/graphql',
  SERVER_URL: 'https://mailchimp-app.example.com',
  LOG_DIR: '../logs',
  LOG_FORMAT: 'error',
}));

jest.mock('@tribeplatform/gql-client', () => ({
  ...(jest.requireActual('@tribeplatform/gql-client') as object),
  GlobalClient: jest.fn().mockImplementation(() => ({
    getTribeClient: jest.fn().mockResolvedValue({
      network: { get: jest.fn().mockResolvedValue({ id: 'net-1', domain: 'community.example.com' }) },
    }),
  })),
}));

const mockFindOne = jest.fn();
jest.mock('@/models/mailchimp.model', () => ({
  __esModule: true,
  default: { findOne: (...args) => mockFindOne(...args) },
}));

const mockListsList = jest.fn();
jest.mock('@/services/mailchimp.services', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ lists: { list: mockListsList } })),
}));

import WebhookController from '@/controllers/webhook.controller';

const ACCESS_TOKEN = 'secret-mailchimp-access-token';

const connection = (overrides = {}) => ({
  _id: 'doc-1',
  name: 'Acme Inc',
  connectedBy: 'mem-1',
  networkId: 'net-1',
  accessToken: ACCESS_TOKEN,
  dataCentre: 'us1',
  apiEndpoint: 'https://us1.api.mailchimp.com',
  audienceId: 'aud-1',
  segmentPrefix: 'Community',
  sendEvents: true,
  sendName: false,
  __v: 0,
  ...overrides,
});

const findForm = (nodes: any): any => {
  const list = Array.isArray(nodes) ? nodes : Object.values(nodes || {});
  for (const node of list) {
    if (node && typeof node === 'object') {
      if (node.name === 'Form') return node;
      const found = findForm(node);
      if (found) return found;
    }
  }
  return null;
};

const formDefaultValues = (slate: any) => {
  const form = findForm(slate.blocks);
  const raw = JSON.parse(form.props).defaultValues;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};

const loadBlockSlate = async () => {
  const controller: any = new WebhookController();
  const result = await controller.loadBlock({ type: 'LOAD_BLOCK', networkId: 'net-1', data: { actorId: 'mem-1', blockId: 'b-1' } });
  return result.data.slate;
};

const loadInteractionSlate = async () => {
  const controller: any = new WebhookController();
  const result = await controller.loadBlockInteraction({ type: 'INTERACTION', networkId: 'net-1', data: { actorId: 'mem-1', interactionId: 'i-1' } });
  return result.data.interactions[0].slate;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListsList.mockResolvedValue({
    lists: [
      { id: 'aud-1', name: 'Main audience' },
      { id: 'aud-2', name: 'Other audience' },
    ],
  });
});

describe.each([
  ['loadBlock', loadBlockSlate],
  ['loadBlockInteraction', loadInteractionSlate],
])('%s settings block', (_label, load) => {
  it('never contains the access token or account internals', async () => {
    // Arrange
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(connection()) });

    // Act
    const slate = await load();

    // Assert
    const serialized = JSON.stringify(slate);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('us1.api.mailchimp.com');
    expect(serialized).not.toContain('connectedBy');
  });

  it('pre-fills the configured form with the saved settings', async () => {
    // Arrange
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(connection()) });

    // Act
    const slate = await load();

    // Assert
    expect(formDefaultValues(slate)).toEqual({
      audienceId: 'aud-1',
      segmentPrefix: 'Community',
      sendName: false,
      sendEvents: true,
      audienceName: 'Main audience',
    });
    const serialized = JSON.stringify(slate);
    expect(serialized).toContain('save');
    expect(serialized).toContain('Acme Inc');
    expect(serialized).toContain('Reconnect');
  });

  it('shows the audience picker when no audience is selected yet', async () => {
    // Arrange
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(connection({ audienceId: undefined, segmentPrefix: undefined })) });

    // Act
    const slate = await load();

    // Assert
    const serialized = JSON.stringify(slate);
    expect(serialized).toContain('save-audience');
    expect(serialized).toContain('Other audience');
    expect(serialized).not.toContain(ACCESS_TOKEN);
  });

  it('shows the connect button when there is no connection', async () => {
    // Arrange
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    // Act
    const slate = await load();

    // Assert
    const serialized = JSON.stringify(slate);
    expect(serialized).toContain('Connect Mailchimp');
    expect(serialized).toContain('https://mailchimp-app.example.com/api/mailchimp/auth?jwt=');
  });
});
