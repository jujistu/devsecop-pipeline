import mongoose from 'mongoose';
const { Schema } = mongoose;

const likeSchema = new Schema({
  quoteId: { type: Schema.Types.ObjectId, ref: 'Quote' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});

// Add index for userId for better query performance
likeSchema.index({ userId: 1 });

export const Like = mongoose.model('Like', likeSchema);
