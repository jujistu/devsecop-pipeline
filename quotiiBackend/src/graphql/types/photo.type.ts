import { objectType } from 'nexus';

export const PhotoType = objectType({
  name: 'Photo',
  definition(t) {
    t.string('id');
    t.string('description');
    t.string('alt_description');
    t.string('urls_raw');
    t.string('urls_full');
    t.string('urls_regular');
    t.string('urls_small');
    t.string('urls_thumb');
    t.field('user', {
      type: 'PhotoUser',
    });
  },
});

export const PhotoUserType = objectType({
  name: 'PhotoUser',
  definition(t) {
    t.string('name');
    t.string('username');
  },
}); 