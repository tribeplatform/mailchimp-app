import { RequestParam } from "../mailchimp.services";

class TagsService {
  list: string;
  request: Function;
  constructor(list: string, request) {
    this.list = list;
    this.request = request;
  }
  public async create(name: string) {
    return this.request({
      method: 'POST',
      url: `/lists/${this.list}/segments`,
      data: {
        name,
        static_segment: [],
      },
    });
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
