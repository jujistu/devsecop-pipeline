import mongoose from 'mongoose';
const { Schema } = mongoose;



const nuggetOfTheDaySchema = new Schema({
  userId: String,
  bookId: String,
  quoteId: String,
  body: String,
  title: String,
  author: String
});

export const NuggetOfTheDay = mongoose.model('NuggetOfTheDay', nuggetOfTheDaySchema);
