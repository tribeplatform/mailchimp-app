import { NextFunction, Request, Response } from 'express';

import { GlobalClient, Types } from '@tribeplatform/gql-client';
import { logger } from '@/utils/logger';

import { LiquidConvertor } from '@tribeplatform/slate-kit/convertors';
import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL, SERVER_URL } from '@/config';
import auth from '@/utils/auth';
import MailchimpModel from '@/models/mailchimp.model';
import MailchimpService from '@/services/mailchimp.services';
import SegmentModel from '@/models/segments.model';
import { Space } from '@tribeplatform/gql-client/types';
import { formatDateForMailchimp } from '@utils/util';

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
{% capture connectUrl %}
  ${SERVER_URL}/api/mailchimp/auth?jwt={{jwt}}&redirect=https://{{network.domain}}/manage/apps/mailchimp
{% endcapture %}
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
              value='{{audienceItems[0].value}}'
              name="audienceId"
              label="Audience"
              items='{{audienceItems}}'
            />
          {% endif %}
          <Input
            className="my-5"
            name="segmentPrefix"
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
          <Input
            disabled="true"
            name="audienceId"
            label="Audience"
            value="{{audienceName}}"
          />
          <Input
            disabled="true"
            name="segmentPrefix"
            label="Tags Prefix"
            value="Community"
          />
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
    const mailchimpConnection = await MailchimpModel.findOne({ networkId }).lean();
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
    let segment, member;
    const data = input?.data || {};
    try {
      switch (input?.data?.name) {
        case 'member.verified':
        case 'member.updated':
          member = await this.getMember(mailchimpService, { email: object.email, audienceId });
          if (!member) {
            await mailchimpService.list(audienceId).addMember(object);
          } else {
            await mailchimpService.list(audienceId).updateMember(object);
          }
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
          break;
      }

      const eventsList = ['space_membership.created', 'space_membership.deleted', 'space.created', 'post.published', 'reaction.added', 'tag.added'];
      const { shortDescription, actor, time } = data as { shortDescription: string; actor: Types.Member; time: string };
      if (shortDescription && actor.id && eventsList.indexOf(input?.data?.name) !== -1) {
        member = (await tribeClient.members.get({ id: actor?.id }, 'basic')) as Types.Member;
        let mailchimpMember = await this.getMember(mailchimpService, { email: member?.email, audienceId });
        if (!mailchimpMember) {
          await mailchimpService.list(audienceId).addMember(member);
        } else {
          await mailchimpService.list(audienceId).updateMember(member);
        }
        await mailchimpService.list(audienceId).addEvent({
          name: shortDescription,
          date: time,
          email: member?.email,
          properties: this.createEventProperties(data),
        });
      }
    } catch (err) {
      console.log(err);
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
    console.log(JSON.stringify(result));
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
        if (mailchimpConnection.audienceId) {
          let audienceName = lists.find(list => list.id === mailchimpConnection.audienceId);
          if (audienceName) {
            variables.audienceName = audienceName.name;
          }
        }
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
    let settings: any = {};
    if (callbackId === 'save-audience') {
      let { audienceId, segmentPrefix } = inputs;
      const mailchimpConnection = await MailchimpModel.findOne({ networkId });
      mailchimpConnection.audienceId = audienceId;
      mailchimpConnection.segmentPrefix = segmentPrefix;
      await mailchimpConnection.save();
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
    return result;
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
