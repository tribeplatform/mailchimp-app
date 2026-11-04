import { RequestParam } from '../mailchimp.services';
import { mailchimpErrorStatus } from '@/utils/mailchimpErrors';

class TagsService {
  list: string;
  request: Function;
  constructor(list: string, request) {
    this.list = list;
    this.request = request;
  }
public get(id: string) {
    return this.request({
      method: 'GET',
      url: `/lists/${this.list}/segments/${id}`,
    });
  }
  /**
   * Creates the tag. If Mailchimp says it already exists (400), returns the existing tag instead:
   * the stored mapping can be missing (e.g. after a reinstall) while the tag is still in the audience.
   */
  public async create({ name }: { name: string }) {
    try {
      return await this.request({
        method: 'POST',
        url: `/lists/${this.list}/segments`,
        data: {
          name,
          static_segment: [],
        },
      });
    } catch (err) {
      if (mailchimpErrorStatus(err) !== 400) throw err;
      const existing = await this.findByName(name);
      if (!existing) throw err;
      return existing;
    }
  }
  public async findByName(name: string) {
    const result = await this.request({
      method: 'GET',
      url: `/lists/${this.list}/segments?type=static&count=1000&fields=segments.id,segments.name`,
    });
    const wanted = String(name).trim().toLowerCase();
    return (result?.segments || []).find(segment => String(segment.name).trim().toLowerCase() === wanted) || null;
  }
  public update(id: string, { name }: { name: string }) {
    return this.request({
      method: 'PATCH',
      url: `/lists/${this.list}/segments/${id}`,
      data: {
        name,
      },
    });
  }
  public remove(id: string) {
    return this.request({
      method: 'DELETE',
      url: `/lists/${this.list}/segments/${id}`,
    });
  }
  public addMembers(tag: string, emails: string[]) {
    return this.request({
      method: 'POST',
      url: `/lists/${this.list}/segments/${tag}`,
      data: {
        members_to_add: emails,
      },
    });
  }
  public removeMembers(tag: string, emails: string[]) {
    return this.request({
      method: 'POST',
      url: `/lists/${this.list}/segments/${tag}`,
      data: {
        members_to_remove: emails,
      },
    });
  }
}

export default TagsService;
