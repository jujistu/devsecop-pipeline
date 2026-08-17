import { MediaConfig } from "../database/schemas/mediaConfig.schema"


export const getMediaConfig = async () => {
    try {
      // Retrieve the single MediaConfig object from the database
      const mediaConfig = await MediaConfig.findOne().exec();

      if (!mediaConfig) {
        throw new Error('MediaConfig not found in the database');
      }

      return mediaConfig;
    } catch (error) {
      console.error('Error retrieving MediaConfig:', error);
      throw error;
    }
}