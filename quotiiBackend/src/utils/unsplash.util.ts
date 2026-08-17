import { createApi } from 'unsplash-js';

import { RandomParams } from 'unsplash-js/dist/methods/photos';

require('dotenv').config();

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

const unsplash = createApi({
  accessKey: UNSPLASH_ACCESS_KEY as string,
  fetch: fetch,
});

/**
 * Search for photos with given query
 * @param query Search term
 * @param page Page number (optional)
 * @param perPage Results per page (optional)
 */
export const searchPhotos = async (query: string, page = 1, perPage = 10) => {
  const result = await unsplash.search.getPhotos({
    query,
    page,
    perPage,
  });

  if (result.errors) {
    throw new Error('Failed to search photos: ' + result.errors[0]);
  }

  return result.response;
};

/**
 * Get a random photo, optionally filtered by topic/collection
 * @param options Optional parameters for random photo
 */
export const getRandomPhoto = async (options?: RandomParams): Promise<any> => {
  console.log('current access key is -> ', UNSPLASH_ACCESS_KEY);
  const result = await unsplash.photos.getRandom(options);

  if (result.errors) {
    throw new Error('Failed to get random photo: ' + result.errors[0]);
  }

  return result.response;
};

/**
 * Track a photo download
 * @param downloadLocation The download location URL from photo object
 */
export const trackPhotoDownload = async (downloadLocation: string) => {
  const result = await unsplash.photos.trackDownload({
    downloadLocation,
  });

  if (result.errors) {
    throw new Error('Failed to track download: ' + result.errors[0]);
  }

  return result.response;
};
