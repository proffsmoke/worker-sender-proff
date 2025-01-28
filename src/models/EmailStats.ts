import mongoose, { Document, Model, Schema } from 'mongoose';

/**
 * Interface para o documento de estatísticas de emails.
 */
export interface IEmailStats extends Document {
  sent: number; // Total de emails enviados
  successSent: number; // Total de emails enviados com sucesso
  failSent: number; // Total de emails que falharam
}

/**
 * Métodos estáticos para o modelo de estatísticas de emails.
 */
export interface IEmailStatsModel extends Model<IEmailStats> {
  incrementSent(count?: number): Promise<void>;
  incrementSuccess(count?: number): Promise<void>;
  incrementFail(count?: number): Promise<void>;
}

/**
 * Esquema para armazenar estatísticas de envio de emails.
 */
const EmailStatsSchema: Schema<IEmailStats> = new Schema(
  {
    sent: { type: Number, default: 0 }, // Contador de emails enviados
    successSent: { type: Number, default: 0 }, // Contador de emails enviados com sucesso
    failSent: { type: Number, default: 0 }, // Contador de emails que falharam
  },
  {
    collection: 'email_stats', // Nome da coleção no banco de dados
    versionKey: false, // Desabilita o campo "__v"
  }
);

/**
 * Incrementa o número total de emails enviados.
 * @param count - Quantidade a incrementar (padrão: 1).
 */
EmailStatsSchema.statics.incrementSent = async function (count: number = 1): Promise<void> {
  await this.findOneAndUpdate(
    {},
    { $inc: { sent: count } },
    { upsert: true, new: true }
  );
};

/**
 * Incrementa o número de emails enviados com sucesso.
 * @param count - Quantidade a incrementar (padrão: 1).
 */
EmailStatsSchema.statics.incrementSuccess = async function (count: number = 1): Promise<void> {
  await this.findOneAndUpdate(
    {},
    { $inc: { successSent: count } },
    { upsert: true, new: true }
  );
};

/**
 * Incrementa o número de emails que falharam.
 * @param count - Quantidade a incrementar (padrão: 1).
 */
EmailStatsSchema.statics.incrementFail = async function (count: number = 1): Promise<void> {
  await this.findOneAndUpdate(
    {},
    { $inc: { failSent: count } },
    { upsert: true, new: true }
  );
};

const EmailStats = mongoose.model<IEmailStats, IEmailStatsModel>('EmailStats', EmailStatsSchema);
export default EmailStats;
