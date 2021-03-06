export interface Mailchimp {
  name?: string;
  networkId: string;
  connectedBy?: string;
  accessToken: string;
  dataCentre: string;
  apiEndpoint: string;
  audienceId: string;
  segmentPrefix: string;
  sendEvents: boolean;
  sendName: boolean;
}
