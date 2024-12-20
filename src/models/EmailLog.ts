import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailLog extends Document {
  mailId: string; // UUID
  sendmailQueueId?: string; // Queue ID
  email: string;
  message: string;
  success: boolean | null;
  detail: Record<string, any>; // Removido o '?'
  sentAt: Date;
}

const EmailLogSchema: Schema = new Schema(
  {
    mailId: { type: String, required: true, index: true },
    sendmailQueueId: { type: String, index: true },
    email: { type: String, required: true, index: true },
    message: { type: String, required: true },
    success: { type: Boolean, default: null },
    detail: { type: Schema.Types.Mixed, default: {} }, // Garante que detail nunca seja undefined
    sentAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    collection: 'emailLogs', // Especifica explicitamente o nome da coleção
  }
);

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);
