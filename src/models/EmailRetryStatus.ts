import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailRetryStatus extends Document {
  email: string;
  failureCount: number;
  isPermanentlyFailed: boolean;
  lastAttemptAt: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailRetryStatusSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    failureCount: { type: Number, default: 0 },
    isPermanentlyFailed: { type: Boolean, default: false },
    lastAttemptAt: { type: Date, default: Date.now },
    lastError: { type: String, required: false },
  },
  {
    timestamps: true, // Adiciona createdAt e updatedAt automaticamente
    collection: 'emailRetryStatus', // Nome da coleção no MongoDB
  }
);

export default mongoose.model<IEmailRetryStatus>('EmailRetryStatus', EmailRetryStatusSchema); 