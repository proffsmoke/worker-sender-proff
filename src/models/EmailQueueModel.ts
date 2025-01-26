import { Schema, model, Document } from 'mongoose';

// Interface para representar um queueId
interface IQueueId {
  queueId: string;
  success: boolean;
}

// Interface para representar o documento completo
interface IEmailQueue extends Document {
  uuid: string;
  queueIds: IQueueId[];
}

// Schema do Mongoose
const EmailQueueSchema = new Schema<IEmailQueue>({
  uuid: { type: String, required: true, unique: true },
  queueIds: [
    {
      queueId: { type: String, required: true },
      success: { type: Boolean, required: true },
    },
  ],
});

// Modelo do Mongoose
const EmailQueueModel = model<IEmailQueue>('EmailQueue', EmailQueueSchema);

export default EmailQueueModel;