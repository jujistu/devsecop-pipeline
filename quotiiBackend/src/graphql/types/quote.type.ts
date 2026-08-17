import { objectType } from 'nexus';
import { getBookInfo } from '../../repository/book.repository';

export const QuoteType = objectType({
  name: 'Quote',
  definition(t) {
    t.nonNull.string('_id');
    t.nonNull.string('bookId');
    t.nullable.string('quote');
    t.nullable.boolean('liked');
    t.nullable.field('book', {
      type: 'Book',
      resolve: async (parent, _args, ctx: any) => {
        if (!ctx?.user?.id) {
          return null;
        }
        // Only expose the book if the authenticated user owns it.
        return await getBookInfo(ctx.user.id, parent.bookId);
      }
    });
  },
});
