import { Schema, model, Document } from 'mongoose';

// Interface para representar um queueId
interface IQueueId {
  queueId: string;
  email: string;
  success: boolean | null; // Permite null
}

// Interface para representar o documento completo
interface IEmailQueue extends Document {
  uuid: string;
  queueIds: IQueueId[];
  resultSent: boolean; // Campo único para o uuid
}

interface IResultSender {
  sendResults(uuid: string, results: any[]): Promise<boolean>;
}

// Schema do Mongoose
const EmailQueueSchema = new Schema<IEmailQueue>({
  uuid: { type: String, required: true, unique: true },
  queueIds: [
    {
      queueId: { type: String, required: true },
      email: { type: String, required: true },
      success: { type: Boolean, default: null }, // Permite null
    },
  ],
  resultSent: { type: Boolean, default: false }, // Campo único para o uuid
});

// Modelo do Mongoose
const EmailQueueModel = model<IEmailQueue>('EmailQueue', EmailQueueSchema);

export default EmailQueueModel;