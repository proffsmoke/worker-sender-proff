// src/models/Log.ts

import mongoose, { Document, Schema } from 'mongoose';

export interface ILog extends Document {
    to: string;
    bcc: string[];
    success: boolean;
    message: string;
    sentAt: Date;
}

const LogSchema: Schema = new Schema(
    {
        to: { type: String, required: true },
        bcc: { type: [String], required: true },
        success: { type: Boolean, required: true },
        message: { type: String, required: true },
        sentAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

export default mongoose.model<ILog>('Log', LogSchema);
