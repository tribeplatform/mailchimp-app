import { NextFunction, Request, Response } from 'express';

import { GlobalClient, Types } from '@tribeplatform/gql-client';
import { logger } from '@/utils/logger';

import { LiquidConvertor } from '@tribeplatform/slate-kit/convertors';
import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL, SERVER_URL } from '@/config';
import auth from '@/utils/auth';
import MailchimpModel from '@/models/mailchimp.model';
import MailchimpService from '@/services/mailchimp.services';

const DEFAULT_SETTINGS = {};
const SETTINGS_BLOCK = `
{% capture audienceItems %}
[
  {% if lists %}
    {% for list in lists %}
      { 
        "text":"{{list.name}}",
        "value":"{{list.id}}"
      }
      {% if forloop.last == false%},{% endif %}
    {% endfor %}
  {% endif %}
]
{% endcapture %}
{%- assign connectUrl = "${SERVER_URL}/api/mailchimp/auth?jwt={{jwt}}&redirect=https://{{network.domain}}/manage/apps/mailchimp" -%}
{% if mailchimp != blank and mailchimp.audienceId == blank %}
  {%- assign callbackId = "save-audience" -%}
{% else %}
  {%- assign callbackId = "save" -%}
{% endif %}
<Form callbackId="{{callbackId}}">
  <Card>
    <Card.Content>
      {% if mailchimp != blank %}
        {% if mailchimp.audienceId == blank %}
          <Alert
            status="info"
            title="Attention needed"
          >
            You need to choose Audience from the list below to finish the setup.
          </Alert>
          {% if lists  %}
            <Select
              name="audienceId"
              label="Audience"
              items='{{audienceItems}}'
            />
          {% endif %}
          <Input
            name="segmentsPrefix"
            label="Tags Prefix"
            value="Community"
            placeholder="i.e. Community"
            helperText="The prefix helps you would be added to the tag name for each space."
          />
          <Button type="submit" variant="primary">
            Submit
          </Button>
        {% else %}
          <Alert
            status="success"
            title="Setup completed"
          >
            You have successfully connected your community to {{mailchimp.name}}
          </Alert>
        {% endif %}
      {% else %}
        <Alert
          status="warning"
          title="You need to authenticate Mailchimp to activate this integration"
        />
        <Link href="{{connectUrl}}">
          <Button variant="primary" className="my-5">
            Connect Mailchimp
          </Button>
        </Link>
      {% endif %}
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
    const { networkId } = input;
    const tribeClient = await new GlobalClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      graphqlUrl: GRAPHQL_URL,
    }).getTribeClient({ networkId });
    const network = await tribeClient.network.get('basic');
    const mailchimpConnection = await MailchimpModel.findOne({ networkId });
    if (!mailchimpConnection || !mailchimpConnection.audienceId) {
      return {
        type: input.type,
        status: 'SUCCEEDED',
        data: {},
      };
    }
    switch (input.type) {
      case 'member.verified':
        break;
    }
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
    let variables = {
      settings: JSON.stringify(settings),
      jwt: auth.sign({ networkId, memberId: actorId }),
      network,
      mailchimp: mailchimpConnection,
    } as any;
    if (mailchimpConnection) {
      const mailchimpService = new MailchimpService(mailchimpConnection.accessToken, mailchimpConnection.apiEndpoint);
      try {
        const { lists } = await mailchimpService.lists.list();
        variables.lists = lists;
      } catch (error) {
        console.log(error);
      }
    }
    const slate = await convertor.toSlate({
      variables,
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
      networkId,
      data: { callbackId, inputs = {} },
    } = input;
    console.log(JSON.stringify(input))
    let settings: any = {};
    if (callbackId === 'save-audience') {
      let { audienceId, segmentPrefix } = inputs;
      const mailchimpConnection = await MailchimpModel.findOne({ networkId });
      mailchimpConnection.audienceId = audienceId
      mailchimpConnection.segmentPrefix = segmentPrefix
      await mailchimpConnection.save()
      const result = await this.loadBlock(input, settings);
      return {
        ...result,
        data: {
          ...result.data,
          action: 'REPLACE',
          toast: {
            title: 'Mailchimp has successfully been setup.',
            status: 'SUCCESS',
          },
          toStore: { settings },
        },
      };
    }
    const result = await this.loadBlock(input, settings);
    return result
  }
}

export default WebhookController;
