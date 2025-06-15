import mongoose from 'mongoose';

const requestLogSchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true
    },
    route: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24
    }
  },
  {
    versionKey: false
  }
);

export const RequestLog = mongoose.model('RequestLog', requestLogSchema);