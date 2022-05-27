import axios, { AxiosResponse } from 'axios';
import TagsService from './mailchimp/tags.services';
import ListsService from './mailchimp/list.services';
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
      .then(data => data.data);
  }
  public list(id: string) {
    return new TagsService(id, this.request);
  }
}

export default MailchimpService;
