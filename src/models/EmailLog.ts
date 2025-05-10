import mongoose, { Document, Schema } from 'mongoose';

// Interface para representar o log de email
export interface IEmailLog extends Document {
  mailId: string; // UUID único
  queueId: string; // Queue ID único
  email: string; // Email do destinatário
  success: boolean | null; // Status do envio (true, false, ou null se ainda não processado)
  updated: boolean; // Indica se o log foi atualizado por outro serviço
  sentAt: Date; // Data de envio
  errorMessage?: string; // Mensagem de erro detalhada, se success === false
}

const EmailLogSchema: Schema = new Schema(
  {
    mailId: { type: String, required: true, index: true }, // UUID único
    queueId: { type: String, required: true, unique: true, index: true }, // Queue ID único
    email: { type: String, required: true, index: true },
    success: { type: Boolean, default: null }, // Inicialmente null
    updated: { type: Boolean, default: false }, // Inicialmente false
    sentAt: { type: Date, default: Date.now, expires: '48h', index: true }, // Expira após 48h
    errorMessage: { type: String, required: false }, // Opcional
  },
  {
    timestamps: true, // Adiciona campos createdAt e updatedAt automaticamente
    collection: 'emailLogs', // Nome da coleção no MongoDB
  }
);

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);
