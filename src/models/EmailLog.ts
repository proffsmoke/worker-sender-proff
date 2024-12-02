// src/models/EmailLog.ts

import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailLog extends Document {
    mailId: string;
    email: string;
    message: string;
    success: boolean;
    detail?: Record<string, any>;
    sentAt: Date;
}

const EmailLogSchema: Schema = new Schema(
    {
        mailId: { type: String, required: true, index: true },
        email: { type: String, required: true, index: true },
        message: { type: String, required: true },
        success: { type: Boolean, required: true },
        detail: { type: Schema.Types.Mixed, default: {} },
        sentAt: { type: Date, default: Date.now, index: true },
    },
    { timestamps: true }
);

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);
