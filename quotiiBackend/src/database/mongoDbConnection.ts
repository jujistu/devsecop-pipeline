const mongoose = require('mongoose');

export const connectToDb = async () => {
  const uri = process.env.MONGO_DB_CONNECTION_STRING;
  if (!uri) {
    throw new Error(
      'MONGO_DB_CONNECTION_STRING is not set. Add it to your .env file.',
    );
  }

  try {
    await mongoose.connect(uri);
    console.log('mongoDb connected');
  } catch (e) {
    console.log('error connecting to database', e);
    throw e;
  }
};
