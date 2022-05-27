import { model, Schema, Document } from 'mongoose';
import { Segment } from '@/interfaces/segment.interface';

const segmentSchema: Schema = new Schema({
  name: {
    type: String,
  },
  networkId: {
    type: String,
    required: true,
  },
  spaceId: {
    type: String,
    required: true,
  },
  segmentId: {
    type: String,
    required: true,
  },
});

segmentSchema.index({ networkId: -1 });

const SegmentModel = model<Segment & Document>('Segment', segmentSchema);

export default SegmentModel;
