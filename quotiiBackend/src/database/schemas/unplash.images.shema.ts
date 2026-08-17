import mongoose from 'mongoose';
const { Schema } = mongoose;

const unsplashSchema = new Schema({
  url: String,
  downloadLocation: String,
});

export const Like = mongoose.model('UnsplashImage', unsplashSchema);
