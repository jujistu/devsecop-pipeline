import {
  booleanArg,
  intArg,
  mutationField,
  nonNull,
  queryField,
  stringArg,
} from 'nexus';
import {
  addQuote,
  getViewedQuotesForBook,
  getQuotesForBook,
  likeQuote,
  unlikeQuote,
  getUserLikedQuotes,
  searchQuotes,
  searchUserLikedQuotes,
  getNuggetOfTheDay,
  getLikedQuotesForBook,
} from '../repository/quote.repository';
import { QuoteType } from './types/quote.type';
import {
  sendQuoteNotification,
  sendQuoteNotificationFromBook,
  sendQuoteNotificationFromBookDataOnly,
} from '../utils/jobQueues/notificationHandler';
import { NuggetOfTheDayType } from './types/nuggetOfTheDay.type';
import { getRandomPhoto } from '../utils/unsplash.util';
import { RandomParams } from 'unsplash-js/dist/methods/photos';
import QueueService, {
  JobType,
  Queues,
} from '../utils/jobQueues/queue.service';

export const getViewedQuotesForBookQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('getViewedQuotesForBook', {
    type: QuoteType,
    args: {
      userId: nonNull(stringArg()),
      bookId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      return await getViewedQuotesForBook(args.userId, args.bookId);
    },
  });
});

export const sendQuoteNotificationMutation = mutationField((t) => {
  t.nonNull.field('sendQuoteNotification', {
    type: 'Boolean',
    args: {
      userId: nonNull(stringArg()),
      bookId: nonNull(stringArg()),
      syncToNuggetOfTheDay: nonNull(booleanArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      // Only allow enqueueing a push for the authenticated user themselves.
      if (String(args.userId) !== String(ctx.user.id)) {
        throw new Error('Unauthorized');
      }
      await QueueService.getInstance()
        .getQueue(Queues.NOTIFICATION)
        .add(JobType.QUOTE_NOTIFICATION, {
          userId: ctx.user.id,
          bookIds: [args.bookId],
          syncToNuggetOfTheDay: args.syncToNuggetOfTheDay,
        });
      return true;
      // return await sendQuoteNotification(args.userId, [args.bookId], true);
    },
  });
});

export const addQuoteMutation = mutationField((t) => {
  t.nonNull.field('addQuote', {
    type: 'Boolean',
    args: {
      quote: nonNull(stringArg()),
      bookId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await addQuote(ctx.user.id, args.quote, args.bookId);
    },
  });
});

export const getQuotesForBookQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('getQuotesForBook', {
    type: QuoteType,
    args: {
      bookId: nonNull(stringArg()),
      offset: nonNull(intArg()),
      limit: nonNull(intArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      console.log('get quotes for book called. skipping... -> ', args.offset);
      return await getQuotesForBook(
        args.bookId,
        args.offset,
        args.limit,
        ctx.user.id
      );
    },
  });
});

export const likeQuoteMutation = mutationField((t) => {
  t.nonNull.field('likeQuote', {
    type: 'Boolean',
    args: {
      quoteId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await likeQuote(ctx.user.id, args.quoteId);
    },
  });
});

export const unlikeQuoteMutation = mutationField((t) => {
  t.nonNull.field('unlikeQuote', {
    type: 'Boolean',
    args: {
      quoteId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await unlikeQuote(ctx.user.id, args.quoteId);
    },
  });
});

export const getUserLikedQuotesQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('getUserLikedQuotes', {
    type: QuoteType,
    args: {
      offset: nonNull(intArg()),
      limit: nonNull(intArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      let resp = await getUserLikedQuotes(ctx.user.id, args.offset, args.limit);
      return resp
    },
  });
});

export const searchQuotesQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('searchQuotes', {
    type: QuoteType,
    args: {
      searchString: nonNull(stringArg()),
      offset: nonNull(intArg()),
      limit: nonNull(intArg()),
    },
    async resolve(_, args, ctx) {
      return await searchQuotes(args.searchString, args.offset, args.limit);
    },
  });
});

export const searchUserLikedQuotesQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('searchUserLikedQuotes', {
    type: QuoteType,
    args: {
      searchString: nonNull(stringArg()),
      offset: nonNull(intArg()),
      limit: nonNull(intArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await searchUserLikedQuotes(
        ctx.user.id,
        args.searchString,
        args.offset,
        args.limit
      );
    },
  });
});

export const getNuggetOfTheDayQuery = queryField((t) => {
  t.field('getNuggetOfTheDay', {
    type: NuggetOfTheDayType,
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      const val = await getNuggetOfTheDay(ctx.user.id);
      return val;
    },
  });
});

export const getLikedQuotesForBookQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('getLikedQuotesForBook', {
    type: QuoteType,
    args: {
      bookId: nonNull(stringArg()),
      offset: nonNull(intArg()),
      limit: nonNull(intArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await getLikedQuotesForBook(
        ctx.user.id,
        args.bookId,
        args.offset,
        args.limit
      );
    },
  });
});

export const getRandomPhotoQuery = queryField((t) => {
  t.nonNull.field('getRandomPhoto', {
    type: 'Boolean',
    args: {
      query: stringArg(),
      orientation: stringArg(),
    },
    async resolve(_, args, ctx) {
      // Wave B — issue 24: only authenticated callers may enqueue an Unsplash
      // worker job that burns quota and mutates the global MediaConfig.
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      const queue = QueueService.getInstance().getQueue(Queues.UNSPLASH_SYNC);
      await queue.add(JobType.GET_NUGGET_OF_THE_DAY_PHOTO, {});
      return true;
    },
  });
});

// export const getRandomPhotoQuery = queryField((t) => {
//   t.field('getRandomPhoto', {
//     type: 'Boolean',
//     args: {
//       query: stringArg(),
//       orientation: stringArg(),
//     },
//     async resolve(_, args) {
//       const photo = await getRandomPhoto({
//         query: args.query || undefined,
//         orientation: args.orientation as RandomParams['orientation'] || undefined,
//       });
//       console.log('got photo --> ', photo)

//       // Transform the response to match our PhotoType
//       // return {
//       //   id: photo.id,
//       //   description: photo.description,
//       //   alt_description: photo.alt_description,
//       //   urls_raw: photo.urls.raw,
//       //   urls_full: photo.urls.full,
//       //   urls_regular: photo.urls.regular,
//       //   urls_small: photo.urls.small,
//       //   urls_thumb: photo.urls.thumb,
//       //   user: {
//       //     name: photo.user.name,
//       //     username: photo.user.username,
//       //   },
//       // };
//       return true
//     },
//   });
// });
