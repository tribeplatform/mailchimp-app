import { NextFunction, Request, Response } from 'express';

import { Types } from '@tribeplatform/gql-client';
import { logger } from '@/utils/logger';

import { LiquidConvertor } from '@tribeplatform/slate-kit/convertors';

const DEFAULT_SETTINGS = {};
const SETTINGS_BLOCK = `
<Form callbackId="save" defaultValues='{{settings}}'>
  <Card>
    <Card.Content className="space-y-3">
      <Input
        name="apiKey"
        label="API Key"
        placeholder="i.e. YXYXXYYYYYXXXYYYXXYYYYYXYYXXYXYY-usNN"
        helperText="Don't know how to get API KEY? [Click here for instructions](https://mailchimp.com/developer/marketing/guides/quick-start/)"
      />
      <Button type="submit" variant="primary">
        Save settings
      </Button>
    </Card.Content>
  </Card>
</Form>
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
      data: { actorId, blockId },
    } = input;
    const settings = customSettings || DEFAULT_SETTINGS;
    const convertor = new LiquidConvertor(SETTINGS_BLOCK);
    const slate = await convertor.toSlate({
      variables: { settings: JSON.stringify(settings) },
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
