import mongoose from 'mongoose';
const { Schema } = mongoose;



const mediaConfigSchema = new Schema({
  thumbnailBaseUrlNoCDN: String,
  nuggetOfTheDayImageUrl: String,
  nuggetOfTheDayTrackedDownloadUrl: String,
});

export const MediaConfig = mongoose.model('MediaConfig', mediaConfigSchema);
