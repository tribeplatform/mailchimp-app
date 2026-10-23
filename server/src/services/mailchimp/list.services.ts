import { AxiosResponse } from 'axios';
import { formatDateForMailchimp } from '@utils/util';
import md5 from 'md5';

/** Mailchimp's subscriber hash is the MD5 of the lowercased email; mixed-case emails 404'd before. */
export const subscriberHash = (email: string): string => md5(String(email).trim().toLowerCase());
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
  /**
   * Adds the member to the audience, or updates the existing contact.
   * A PUT on the subscriber hash is idempotent: a POST failed with 400 "Member Exists" whenever the
   * member already existed (e.g. the lookup before it failed, or two webhooks for the same member raced).
   * An existing contact keeps its subscription status (`status_if_new` only applies to new contacts).
   */
  public async addMember({ list, name, email }: { list?: string; email: string; name: string }) {
    return this.request({
      method: 'PUT',
      url: `/lists/${this.id || list}/members/${subscriberHash(email)}`,
      data: {
        email_address: email,
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: (name || '').split(' ')[0],
          LNAME: (name || '').split(' ').slice(1).join(' ')
        },
      },
    });
  }
  public async updateMember({ list, name, email }: { list?: string; email: string; name: string }) {
    return this.request({
      method: 'PUT',
      url: `/lists/${this.id || list}/members/${subscriberHash(email)}`,
      data: {
        // Required by Mailchimp when the PUT creates the contact.
        email_address: email,
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: (name || '').split(' ')[0],
          LNAME: (name || '').split(' ').slice(1).join(' ')
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
      url: `/lists/${this.id || list}/members/${subscriberHash(email)}/events`,
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
      url: `/lists/${this.id || list}/members/${subscriberHash(email)}`,
    });
  }
}

export default ListsService;
