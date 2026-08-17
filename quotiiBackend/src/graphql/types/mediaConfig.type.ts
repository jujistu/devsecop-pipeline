import { objectType } from "nexus";

export const MediaConfigType = objectType({
  name: 'MediaConfig',
  definition(t) {
    t.nonNull.string('thumbnailBaseUrlNoCDN');
    t.nullable.string('nuggetOfTheDayImageUrl');
    t.nullable.string('nuggetOfTheDayTrackedDownloadUrl');
  },
});
