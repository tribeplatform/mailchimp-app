import { NextFunction, Request, Response } from 'express';

import { GlobalClient, Types } from '@tribeplatform/gql-client';
import { logger } from '@/utils/logger';

import { LiquidConvertor } from '@tribeplatform/slate-kit/convertors';
import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL, SERVER_URL } from '@/config';
import auth from '@/utils/auth';
import MailchimpModel from '@/models/mailchimp.model';
// import mailchimp from '@mailchimp/mailchimp_marketing'

const DEFAULT_SETTINGS = {};
const SETTINGS_BLOCK = `
  {% if mailchimp != blank %}
    <Iframe src="${SERVER_URL}/ui/settings?jwt={{jwt}}" title="Settings"></Iframe>
  {% else %}
    <Alert
      status="warning"
      title="You need to authenticate Mailchimp to activate this integration"
    />
    <Link href="${SERVER_URL}/api/mailchimp/auth?jwt={{jwt}}&redirect=https://{{network.domain}}/manage/apps/mailchimp">
      <Button variant="primary" className="my-5">
        Connect Mailchimp
      </Button>
    </Link>
  {% endif %}
`;

class WebhookController {
  public index = async (req: Request, res: Response, next: NextFunction) => {
    const input = req.body;
    try {
      if (input.data?.challenge) {
        return res.json({
          type: 'TEST',
          status: 'SUCCEEDED',
          data: {
            challenge: req.body?.data?.challenge,
          },
        });
      }
      let result: any = {
        type: input.type,
        status: 'SUCCEEDED',
        data: {},
      };
      console.log(JSON.stringify(input));

      switch (input.type) {
        case 'GET_SETTINGS':
          result = await this.getSettings(input);
          break;
        case 'UPDATE_SETTINGS':
          result = await this.updateSettings(input);
          break;
        case 'LOAD_BLOCK':
          result = await this.loadBlock(input);
          break;
        case 'CALLBACK_BLOCK':
          result = await this.handleCallback(input);
          break;
        case 'SUBSCRIPTION':
          result = await this.handleSubscription(input);
          break;
      }
      res.status(200).json(result);
    } catch (error) {
      logger.error(error);
      return {
        type: input.type,
        status: 'FAILED',
        data: {},
      };
    }
  };

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async getSettings(input) {
    const currentSettings = input.currentSettings[0]?.settings || {};
    let defaultSettings;
    switch (input.context) {
      case Types.PermissionContext.NETWORK:
        defaultSettings = DEFAULT_SETTINGS;
        break;
      default:
        defaultSettings = {};
    }
    const settings = {
      ...defaultSettings,
      ...currentSettings,
    };
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: settings,
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async updateSettings(input) {
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: { toStore: input.data.settings },
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async handleSubscription(input) {
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {},
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async loadBlock(input, customSettings = null) {
    const {
      networkId,
      data: { actorId, blockId },
    } = input;
    const settings = customSettings || DEFAULT_SETTINGS;
    const tribeClient = await new GlobalClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      graphqlUrl: GRAPHQL_URL,
    }).getTribeClient({ networkId });
    const network = await tribeClient.network.get('basic');
    const convertor = new LiquidConvertor(SETTINGS_BLOCK);
    const mailchimpConnection = await MailchimpModel.findOne({ networkId });
    const slate = await convertor.toSlate({
      variables: { settings: JSON.stringify(settings), jwt: auth.sign({ networkId, memberId: actorId }), network, mailchimp: mailchimpConnection },
    });
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: { slate },
    };
  }

  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async handleCallback(input) {
    const {
      data: { callbackId, inputs = {} },
    } = input;
    let settings: any = {};
    if (callbackId === 'save') {
      let apiKey = inputs.apiKey;
      if (!apiKey) {
        return {
          type: input.type,
          status: 'FAILED',
          errorCode: 'MISSING_PARAMETER',
          errorMessage: `API Key cannot be empty.`,
        };
      }
      settings.apiKey = apiKey;
    }
    const result = await this.loadBlock(input, settings);
    return {
      ...result,
      data: {
        ...result.data,
        action: 'REPLACE',
        toast: {
          title: 'Settings successfully updated.',
          status: 'SUCCESS',
        },
        toStore: { settings },
      },
    };
  }
}

export default WebhookController;
