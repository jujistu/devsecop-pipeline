import { objectType } from 'nexus';

export const NuggetOfTheDayType = objectType({
  name: 'NuggetOfTheDay',
  definition(t) {
    t.string('userId');
    t.string('bookId');
    t.string('quoteId')
    t.string('body');
    t.string('title');
    t.string('author');
    t.nullable.boolean('isLiked')
  },
}); 