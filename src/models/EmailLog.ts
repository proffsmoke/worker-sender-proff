// src/models/EmailLog.ts

import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailLog extends Document {
  mailId: string;
  sendmailQueueId?: string;
  email: string;
  message: string;
  success: boolean | null; // Pode ser null até que o status seja atualizado
  detail?: Record<string, any>;
  sentAt: Date;
}

const EmailLogSchema: Schema = new Schema(
  {
    mailId: { type: String, required: true, index: true },
    sendmailQueueId: { type: String, index: true },
    email: { type: String, required: true, index: true },
    message: { type: String, required: true },
    success: { type: Boolean, default: null }, // Valor padrão como null
    detail: { type: Schema.Types.Mixed, default: {} },
    sentAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);
