import { NextFunction, Request, Response } from 'express';

import { GlobalClient, TribeClient, Types } from '@tribeplatform/gql-client';
import { createLogger } from '@/utils/logger';
import { v4 } from 'uuid';
import { LiquidConvertor } from '@tribeplatform/slate-kit/convertors';
import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL, SERVER_URL } from '@/config';
import auth from '@/utils/auth';
import MailchimpModel from '@/models/mailchimp.model';
import MailchimpService from '@/services/mailchimp.services';
import SegmentModel from '@/models/segments.model';
import { Member, Space } from '@tribeplatform/gql-client/types';
import { formatDateForMailchimp } from '@utils/util';
import { Mailchimp as MailchimpConnection } from '@/interfaces/mailchimp.interface';
import { WEBHOOK_ACTION } from '@/enums/webhookActions.enums';
import { WebhookResponseStatus } from '@/enums/response.enum';
import { AppInteractionType } from '@/enums/interactionTypes.enum';

const logger = createLogger('WebhookController');

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

{% capture connectUrl %}${SERVER_URL}/api/mailchimp/auth?jwt={{jwt}}&redirect=https://{{network.domain}}/manage/apps/mailchimp{% endcapture %}

{% if mailchimp != blank and mailchimp.audienceId == blank %}
  {%- assign callbackId = "save-audience" -%}
{% else %}
  {%- assign callbackId = "save" -%}
{% endif %}

<Form callbackId="{{callbackId}}" defaultValues='{{settings}}'>
  <Card>
    <Card.Content>
      {% if mailchimp != blank %}
        {% if mailchimp.audienceId == blank %}
          <List spacing="md">
            <Alert
              status="info"
              title="Attention needed">
              You need to choose Audience from the list below to finish the setup.
            </Alert>
            {% if lists  %}
              <Select
                value='{{audienceItems[0].value}}'
                name="audienceId"
                label="Audience"
                items='{{audienceItems}}'
              />
            {% endif %}
            <Input
              name="segmentPrefix"
              label="Tags Prefix"
              value="Community"
              placeholder="i.e. Community"
              helperText="Space names are added as tags to contacts. The prefix helps you identify the tags added from the community"
            />
            <Toggle
              name="sendName"
              label="Always update Mailchimp contact name and last name"
              value=true
              helperText="By default, Tribe only updates Mailchimp contact name if it doesn’t have any value."
            />
            <Toggle
              name="sendEvents"
              label="Send events"
              value=true
              helperText="Send community events to Mailchimp"
            />
            <Button type="submit" variant="primary">
              Submit
            </Button>
          </List>
        {% else %}
          <List spacing="sm">
            <Alert
              status="success"
              title="Setup completed"
            >
              <List spacing="sm">
                You have successfully connected your community to {{mailchimp.name}}
                <Link href="#" variant="inherit" href="{{connectUrl}}">
                  Reconnect
                </Link>
              </List>
            </Alert>
            <Input
              disabled="true"
              name="audienceName"
              label="Audience"
              value="{{audienceName}}"
            />
            <Input
              disabled="true"
              name="segmentPrefix"
              label="Tags Prefix"
              helperText="Space names are added as tags to contacts. The prefix helps you identify the tags added from the community"
            />
            <Toggle
              name="sendName"
              label="Always update Mailchimp contact name and last name"
              helperText="By default, Tribe only updates Mailchimp contact name if it doesn’t have any value."
            />
            <Toggle
              name="sendEvents"
              label="Send events"
              helperText="Send community events to Mailchimp"
            />
            <Button type="submit" variant="primary">
              Submit
            </Button>
          </List>
        {% endif %}
      {% else %}
        <List spacing="sm">
           <Alert
            status="warning"
            title="You need to authenticate Mailchimp to activate this integration"
            />
            <Button as="a" href="{{connectUrl}}" variant="primary" className="pointer-events-auto">
              Connect Mailchimp
            </Button>
        </List>
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
      logger.log(JSON.stringify(input));

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
        case 'Callback':
          result = await this.handleCallback(input);
          break;
        case 'Interaction':
          const { callbackId } = input.data || {};
          if (callbackId) {
            result = await this.handleCalbackInteraction(input);
          } else {
            result = await this.loadBlockInteraction(input);
          }
          break;
        case 'SUBSCRIPTION':
          result = await this.handleSubscription(input);
          break;
        case 'APP_UNINSTALLED':
          result = await this.removeNetworkSettings(input);
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
    const {
      networkId,
      data: { object },
    } = input;
    const tribeClient = await new GlobalClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      graphqlUrl: GRAPHQL_URL,
    }).getTribeClient({ networkId });
    const mailchimpConnection: MailchimpConnection = await MailchimpModel.findOne({ networkId }).lean();
    if (!mailchimpConnection || !mailchimpConnection.audienceId) {
      return {
        type: input.type,
        status: 'SUCCEEDED',
        data: {},
      };
    }
    const audienceId = mailchimpConnection.audienceId;
    const segmentPrefix = mailchimpConnection.segmentPrefix;
    const mailchimpService = new MailchimpService(mailchimpConnection.accessToken, mailchimpConnection.apiEndpoint);
    let segment;
    const data = input?.data || {};
    try {
      switch (input?.data?.name) {
        case 'member.verified':
        case 'member.updated':
          await this.addOrUpdateMember(object as Member, audienceId, mailchimpService, mailchimpConnection);
          break;
        case 'space.updated':
        case 'space.created':
          segment = await this.getSegment(mailchimpService, { networkId, spaceId: (object as Space).id, audienceId });
          if (!segment) {
            const result = await mailchimpService.list(audienceId).tags.create({ name: segmentPrefix + ' ' + object.name });
            await this.createSegmentIfNotExist({ networkId, spaceId: (object as Space).id, segmentId: result.id });
          } else {
            await mailchimpService.list(audienceId).tags.update(segment.id, { name: segmentPrefix + ' ' + object.name });
          }
          break;
        case 'space_membership.created':
        case 'space_membership.deleted':
          segment = await this.getSegment(mailchimpService, { networkId, spaceId: object.spaceId, audienceId });
          if (!segment) {
            const space = await tribeClient.spaces.get({ id: object.spaceId }, 'basic');
            segment = await mailchimpService.list(audienceId).tags.create({ name: segmentPrefix + ' ' + space.name });
            await this.createSegmentIfNotExist({ networkId, spaceId: space.id, segmentId: segment.id });
          }
          const tribeMember = await tribeClient.members.get({ id: object.memberId }, 'basic');
          const mailchimpMember = await this.getMember(mailchimpService, { email: tribeMember.email, audienceId });
          if (!mailchimpMember) await mailchimpService.list(audienceId).addMember({ name: tribeMember.name, email: tribeMember.email });
          if (input?.data?.name === 'space_membership.created') {
            await mailchimpService.list(audienceId).tags.addMembers(segment.id, [tribeMember.email]);
          } else {
            await mailchimpService.list(audienceId).tags.removeMembers(segment.id, [tribeMember.email]);
          }
          const spaces = await tribeClient.spaceMembers.listSpaces(
            { memberId: object.memberId, limit: 10 },
            {
              space: 'basic',
            },
          );
          if (spaces && spaces?.nodes?.length) {
            try {
              for (const node of spaces?.nodes) {
                const spaceId = node?.space?.id;
                segment = await this.getSegment(mailchimpService, { networkId, spaceId, audienceId });
                if (!segment && node?.space?.name) {
                  segment = await mailchimpService.list(audienceId).tags.create({ name: segmentPrefix + ' ' + node?.space.name });
                  await this.createSegmentIfNotExist({ networkId, spaceId, segmentId: segment.id });
                }
                if (segment) {
                  await mailchimpService.list(audienceId).tags.addMembers(segment.id, [tribeMember.email]);
                }
              }
            } catch (err) {
              logger.error(err);
            }
          }
          break;
      }
      if (mailchimpConnection.sendEvents) {
        await this.sendEvent(input?.data?.name, data, audienceId, tribeClient, mailchimpService, mailchimpConnection);
      }
    } catch (err) {
      logger.error(err);
      return {
        type: input.type,
        status: 'FALIED',
        data: {},
      };
    }

    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {},
    };
  }
  private createSegmentIfNotExist = ({ networkId, spaceId, segmentId }: { networkId: string; spaceId: string; segmentId: string }) =>
    SegmentModel.findOneAndReplace({ networkId, spaceId }, { networkId, spaceId, segmentId }, { upsert: true });

  private async sendEvent(
    event: string,
    data: any,
    audienceId: string,
    tribeClient: TribeClient,
    mailchimpService: MailchimpService,
    mailchimpConnection: MailchimpConnection,
  ) {
    const eventsList = ['space_membership.created', 'space_membership.deleted', 'space.created', 'post.published', 'reaction.added', 'tag.added'];
    const { shortDescription, actor, time } = data as { shortDescription: string; actor: Types.Member; time: string };
    if (shortDescription && actor.id && eventsList.indexOf(event) !== -1) {
      const member = (await tribeClient.members.get({ id: actor?.id }, 'basic')) as Types.Member;
      await this.addOrUpdateMember(member, audienceId, mailchimpService, mailchimpConnection);
      await mailchimpService.list(audienceId).addEvent({
        name: shortDescription,
        date: time,
        email: member?.email,
        properties: this.createEventProperties(data),
      });
    }
  }
  private async addOrUpdateMember(member: Member, audienceId: string, mailchimpService: MailchimpService, mailchimpConnection: MailchimpConnection) {
    const mailchimpMember = await this.getMember(mailchimpService, { email: member?.email, audienceId });
    if (!mailchimpMember) {
      await mailchimpService.list(audienceId).addMember(member as any);
    } else if (mailchimpConnection.sendName) {
      await mailchimpService.list(audienceId).updateMember(member as any);
    }
  }
  private createEventProperties(data): any {
    if (!data?.object?.id) return {};
    const fields = [
      'id',
      'slug',
      'name',
      'title',
      'status',
      'createdAt',
      'updatedAt',
      'ownerId',
      'isReply',
      'count',
      'postId',
      'reaction',
      'spaceId',
      'memberId',
      'inviterId',
      'private',
      'hidden',
    ];
    data.object.reaction = data.object?.reaction?.reaction;
    const result = {};
    fields.map(key => {
      if (data?.object[key]) {
        result[key] = String(data?.object[key]);
      }
      if (['createdAt', 'updatedAt'].indexOf(key) !== -1) result[key] = formatDateForMailchimp(result[key]);
    });
    logger.log(JSON.stringify(result));
    return result;
  }
  private async getSegment(
    mailchimpService: MailchimpService,
    { networkId, spaceId, audienceId }: { networkId: string; spaceId: string; audienceId: string },
  ) {
    let segment = await SegmentModel.findOne({ networkId, spaceId }).lean();
    if (segment?.segmentId) {
      try {
        segment = await mailchimpService.list(audienceId).tags.get(segment.segmentId);
      } catch (err) {
        segment = null;
      }
    }
    return segment;
  }
  private async getMember(mailchimpService: MailchimpService, { email, audienceId }: { email: string; audienceId: string }) {
    try {
      return await mailchimpService.list(audienceId).getMember({ email });
    } catch (err) {
      return null;
    }
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
    const mailchimpConnection = await MailchimpModel.findOne({ networkId }).lean();
    const variables = {
      settings: JSON.stringify({}),
      jwt: auth.sign({ networkId, memberId: actorId }),
      network,
      mailchimp: mailchimpConnection,
    } as any;
    if (mailchimpConnection) {
      const mailchimpService = new MailchimpService(mailchimpConnection.accessToken, mailchimpConnection.apiEndpoint);
      try {
        const { lists } = await mailchimpService.lists.list();
        variables.lists = lists;
        if (mailchimpConnection.audienceId) {
          const audienceName = lists.find(list => list.id === mailchimpConnection.audienceId);
          if (audienceName) {
            variables.audienceName = audienceName.name;
          }
        }
        variables.settings = JSON.stringify({
          ...mailchimpConnection,
          audienceName: variables.audienceName,
        });
      } catch (error) {
        logger.error(error);
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
  private async loadBlockInteraction(input) {
    const {
      networkId,
      data: { actorId, interactionId },
    } = input;
    const tribeClient = await new GlobalClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      graphqlUrl: GRAPHQL_URL,
    }).getTribeClient({ networkId });
    const network = await tribeClient.network.get('basic');
    const convertor = new LiquidConvertor(SETTINGS_BLOCK);
    const mailchimpConnection = await MailchimpModel.findOne({ networkId }).lean();
    const variables = {
      settings: JSON.stringify({}),
      jwt: auth.sign({ networkId, memberId: actorId }),
      network,
      mailchimp: mailchimpConnection,
    } as any;
    if (mailchimpConnection) {
      const mailchimpService = new MailchimpService(mailchimpConnection.accessToken, mailchimpConnection.apiEndpoint);
      try {
        const { lists } = await mailchimpService.lists.list();
        variables.lists = lists;
        if (mailchimpConnection.audienceId) {
          const audienceName = lists.find(list => list.id === mailchimpConnection.audienceId);
          if (audienceName) {
            variables.audienceName = audienceName.name;
          }
        }
        variables.settings = JSON.stringify({
          ...mailchimpConnection,
          audienceName: variables.audienceName,
        });
      } catch (error) {
        logger.error(error);
      }
    }

    const slate = await convertor.toSlate({
      variables,
    });
    return {
      type: input.type,
      status: 'SUCCEEDED',
      data: {
        interactions: [
          {
            id: interactionId,
            type: 'SHOW',
            slate: slate,
          },
        ],
      },
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
    const settings: any = {};
    if (['save-audience', 'save'].indexOf(callbackId) !== -1) {
      const mailchimpConnection = await MailchimpModel.findOne({ networkId });
      const fields = ['audienceId', 'segmentPrefix', 'sendName', 'sendEvents'];
      fields.forEach(field => {
        if (typeof inputs[field] !== 'undefined') mailchimpConnection[field] = inputs[field];
      });
      await mailchimpConnection.save();
      const result = await this.loadBlock(input, settings);
      const toastMessage =
        callbackId === 'save-audience' ? 'Mailchimp has successfully been setup.' : 'Mailchimp connection has been successfully updated.';
      return {
        ...result,
        data: {
          ...result.data,
          action: 'REPLACE',
          toast: {
            title: toastMessage,
            status: 'SUCCESS',
          },
          toStore: { settings },
        },
      };
    }
    const result = await this.loadBlock(input, settings);
    return {
      ...result,
      data: {
        ...result.data,
        action: 'REPLACE',
        toStore: { settings },
      },
    };
  }
  private async handleCalbackInteraction(input) {
    const {
      networkId,
      data: { callbackId, inputs = {}, interactionId },
    } = input;
    const settings: any = {};
    if (['save-audience', 'save'].indexOf(callbackId) !== -1) {
      const mailchimpConnection = await MailchimpModel.findOne({ networkId });
      const fields = ['audienceId', 'segmentPrefix', 'sendName', 'sendEvents'];
      fields.forEach(field => {
        if (typeof inputs[field] !== 'undefined') mailchimpConnection[field] = inputs[field];
      });
      await mailchimpConnection.save();
      const result = await this.loadBlockInteraction(input);
      const toastMessage =
        callbackId === 'save-audience' ? 'Mailchimp has successfully been setup.' : 'Mailchimp connection has been successfully updated.';
      return {
        type: WEBHOOK_ACTION.INTERACTION,
        status: WebhookResponseStatus.SUCCEEDED,
        data: {
          toStore: { settings },
          interactions: [
            {
              id: interactionId,
              type: 'SHOW',
              slate: result.data.slate,
            },
            {
              id: v4(),
              type: 'OPEN_TOAST',
              props: {
                status: 'SUCCESS',
                title: toastMessage,
              },
            },
          ],
        },
      };
    }
    const result = await this.loadBlockInteraction(input);
    return {
      type: WEBHOOK_ACTION.INTERACTION,
      status: WebhookResponseStatus.SUCCEEDED,
      data: {
        interactions: [
          {
            id: interactionId,
            type: AppInteractionType.Show,
            slate: result.data.interactions[0].slate,
          },
        ],
        toStore: { settings },
      },
    };
  }
  /**
   *
   * @param input
   * @returns { type: input.type, status: 'SUCCEEDED', data: {} }
   * TODO: Elaborate on this function
   */
  private async removeNetworkSettings(input) {
    const { networkId } = input;
    await MailchimpModel.deleteOne({ networkId });
    await SegmentModel.deleteMany({ networkId });
    return {
      type: input.type,
      status: 'SUCCEEDED',
    };
  }
}

export default WebhookController;
