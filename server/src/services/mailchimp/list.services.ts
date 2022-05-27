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
  public async getMember({ list, email }: { list?: string; email: string }) {
    return this.request({
      method: 'GET',
      url: `/lists/${this.id || list}/members/${md5(email)}`,
    });
  }
}

export default ListsService;
