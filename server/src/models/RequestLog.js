import mongoose from 'mongoose';

const requestLogSchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true
    },
    endpoint: {
      type: String,
      required: true
    },
    algorithm: {
      type: String,
      required: true
    },
    allowed: {
      type: Boolean,
      required: true
    },
    remainingTokens: {
      type: Number,
      required: true
    },
    time: {
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
