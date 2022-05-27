class ListsService {
  request: Function;
  constructor(request: Function) {
    this.request = request;
  }
  public async list() {
    return this.request({
      method: 'GET',
      url: `/lists`,
    });
  }
}

export default ListsService;
