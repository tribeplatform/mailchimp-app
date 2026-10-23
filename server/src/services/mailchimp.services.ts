import axios, { AxiosResponse } from 'axios';
import TagsService from './mailchimp/tags.services';
import ListsService from './mailchimp/list.services';
/**
 * A failed Mailchimp API call.
 * Axios errors carry the request config (with the Bearer token) and Mailchimp's error `detail`,
 * which often contains the member's email address, so neither is kept.
 */
export class MailchimpApiError extends Error {
  public readonly status?: number;
  public readonly title?: string;
  public readonly response?: { status?: number };

  constructor(message: string, status?: number, title?: string) {
    super(message);
    this.name = 'MailchimpApiError';
    this.status = status;
    this.title = title;
    // Same shape as an axios error for callers that read `error.response.status`.
    this.response = { status };
  }

  static from(error: any, method: string, url: string): MailchimpApiError {
    const status: number | undefined = error?.response?.status;
    const body = error?.response?.data;
    const title: string | undefined = typeof body === 'object' && body ? body.title : status ? undefined : error?.code;
    // Subscriber hashes are md5(email).
    const path = String(url).split('?')[0].replace(/[0-9a-f]{32}/g, '{subscriber_hash}');
    const message = `Mailchimp ${String(method).toUpperCase()} ${path} failed: ${status ?? 'no response'}${title ? ` ${title}` : ''}`;
    return new MailchimpApiError(message, status, title);
  }
}

export interface RequestParam {
  url: string;
  method: string;
  data?: any;
}
class MailchimpService {
  private accessToken: string;
  private endpoint: string;
  public lists: ListsService;
  constructor(accessToken: string, endpoint: string) {
    this.accessToken = accessToken;
    this.endpoint = endpoint;
    this.lists = new ListsService(this.request.bind(this));
  }
  private async request({ url, method, data }: RequestParam): Promise<AxiosResponse> {
    return axios
      .request({
        method,
        url: this.endpoint + '/3.0' + url,
        data,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      })
      .then(data => data.data)
      .catch(error => {
        throw MailchimpApiError.from(error, method, url);
      });
  }
  public list(id: string): ListsService & { tags: TagsService } {
    const listService = new ListsService(this.request.bind(this), id) as ListsService & { tags: TagsService };
    listService.tags = new TagsService(id, this.request.bind(this));
    return listService;
  }
}

export default MailchimpService;
