import mongoose from 'mongoose';
const { Schema } = mongoose;

export enum SignUpType {
  EMAIL = 'EMAIL',
  GOOGLE = 'GOOGLE',
  APPLE = 'APPLE',
  FACEBOOK = 'FACEBOOK',
  GUEST = 'GUEST',
}

const userSchema = new Schema({
  firstName: String,
  lastName: String,
  nickName: String,
  email: String,
  externalAuthId: String,
  signUpType: String,
  isGuest: { type: Boolean, default: false },
  deviceIds: [String],
  timeZone: String,
});

userSchema.index({ signUpType: 1, externalAuthId: 1 });

export const User = mongoose.model('User', userSchema);
