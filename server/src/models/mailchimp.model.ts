import { model, Schema, Document } from 'mongoose';
import { Mailchimp } from '@/interfaces/mailchimp.interface';

const mailchimpSchema: Schema = new Schema({
  name: {
    type: String,
  },
  connectedBy: {
    type: String,
    required: true,
  },
  networkId: {
    type: String,
    required: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  dataCentre: {
    type: String,
    required: true,
  },
  apiEndpoint: {
    type: String,
    required: true,
  },
  spaceId: {
    type: String,
  },
});

mailchimpSchema.index({ networkId: -1 });

const MailchimpModel = model<Mailchimp & Document>('Mailchimp', mailchimpSchema);

export default MailchimpModel;
