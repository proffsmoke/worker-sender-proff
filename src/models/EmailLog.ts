import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailLog extends Document {
  mailId: string; // UUID único
  queueId: string; // Queue ID único
  email: string; // Email do destinatário
  success: boolean | null; // Status do envio (true, false, ou null se ainda não processado)
  updated: boolean; // Indica se o log foi atualizado por outro serviço
  sentAt: Date; // Data de envio
  expireAt: Date; // Data de expiração
}

const EmailLogSchema: Schema = new Schema(
  {
    mailId: { type: String, required: true, index: true }, // UUID único
    queueId: { type: String, required: true, unique: true, index: true }, // Queue ID único
    email: { type: String, required: true, index: true },
    success: { type: Boolean, default: null }, // Inicialmente null
    updated: { type: Boolean, default: false }, // Inicialmente false
    sentAt: { type: Date, default: Date.now, index: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000), index: true }, // Expira em 30 minutos
  },
  {
    timestamps: true,
    collection: 'emailLogs',
  }
);

// Criar índice TTL no campo expireAt
EmailLogSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);