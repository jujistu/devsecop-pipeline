import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
const { Schema } = mongoose;

const quoteSchema = new Schema({
  bookId: String,
  quote: String,
  userId: String
});

// Add text index on the quote field
quoteSchema.index({ quote: 'text' });

export const Quote = mongoose.model('Quote', quoteSchema);
