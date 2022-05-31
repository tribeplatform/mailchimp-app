import { AxiosResponse } from 'axios';
import { formatDateForMailchimp } from '@utils/util';
import md5 from 'md5';
class ListsService {
  request: Function;
  id: string;
  constructor(request: Function, id?: string) {
    this.request = request;
    this.id = id;
  }
  public async list() {
    return this.request({
      method: 'GET',
      url: `/lists`,
    });
  }
  public async addMember({ list, name, email }: { list?: string; email: string; name: string }) {
    return this.request({
      method: 'POST',
      url: `/lists/${this.id || list}/members`,
      data: {
        email_address: email,
        status: 'subscribed',
        merge_fields: {
          FNAME: name.split(' ')[0],
        },
      },
    });
  }
  public async updateMember({ list, name, email }: { list?: string; email: string; name: string }) {
    return this.request({
      method: 'PUT',
      url: `/lists/${this.id || list}/members/${md5(email)}`,
      data: {
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: name.split(' ')[0],
        },
      },
    });
  }
  public async addEvent({
    list,
    name,
    email,
    date,
    properties = {},
  }: {
    list?: string;
    email: string;
    name: string;
    date: string;
    properties: any;
  }): Promise<AxiosResponse> {
    return this.request({
      method: 'POST',
      url: `/lists/${this.id || list}/members/${md5(email)}/events`,
      data: {
        name: name.toString().trim().toLowerCase().replace(/\s+/g, '_'),
        occurred_at: formatDateForMailchimp(date),
        properties,
      },
    });
  }
  public async getMember({ list, email }: { list?: string; email: string }) {
    return this.request({
      method: 'GET',
      url: `/lists/${this.id || list}/members/${md5(email)}`,
    });
  }
}

export default ListsService;
