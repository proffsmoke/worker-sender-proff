import { Schema, model, Document } from 'mongoose';

interface IQueueId {
  queueId: string;
  email: string;
  success: boolean | null;
}

interface IEmailQueue extends Document {
  uuid: string;
  queueIds: IQueueId[];
  resultSent: boolean;
  createdAt: Date;
}

const EmailQueueSchema = new Schema<IEmailQueue>(
  {
    uuid: { type: String, required: true, unique: true },
    queueIds: [
      {
        queueId: { type: String, required: true },
        email: { type: String, required: true },
        success: { type: Boolean, default: null },
      },
    ],
    resultSent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: '48h' },
  },
  { timestamps: true }
);

export default model<IEmailQueue>('EmailQueue', EmailQueueSchema);