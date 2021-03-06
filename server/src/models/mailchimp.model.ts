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
  audienceId: {
    type: String,
  },
  segmentPrefix: {
    type: String,
  },
  sendEvents: {
    type: Boolean,
    default: true,
  },
  sendName: {
    type: Boolean,
    default: true,
  },
});

mailchimpSchema.index({ networkId: -1 });

const MailchimpModel = model<Mailchimp & Document>('Mailchimp', mailchimpSchema);

export default MailchimpModel;
