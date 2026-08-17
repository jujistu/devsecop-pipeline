import mongoose from 'mongoose';
const { Schema } = mongoose;

const subscriptionSchema = new Schema({
  bookIds: [String],
  userId: String,
  jobIds: [String],
  frequency: { type: Number, default: 2 },
  active: { type: Boolean, default: true },
  startTime: { type: String, default: '09:00' },
  endTime: { type: String, default: '18:00' },
});

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
