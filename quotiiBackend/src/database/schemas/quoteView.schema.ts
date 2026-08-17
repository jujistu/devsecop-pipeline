import mongoose from 'mongoose';
const { Schema } = mongoose;

const quoteViewSchema = new Schema({
  quoteId: String,
  userId: String,
  date: { type: Date, default: Date.now },
});

export const QuoteView = mongoose.model('QuoteView', quoteViewSchema);
