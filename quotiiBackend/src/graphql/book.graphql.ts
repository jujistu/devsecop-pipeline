import {
  mutationField,
  nonNull,
  nullable,
  queryField,
  stringArg,
  subscriptionField,
  list,
  intArg,
} from 'nexus';

import {
  BOOK_PROGRESS_SUBSCRIPTION_EVENT,
  BookIndexStatusType,
  BookType,
  bookIndexStatusTopic,
} from './types/book.type';
import {
  getBookInfo,
  getBookIndexStatuses,
  getUserBooks,
  addBookToSubscriptions,
  createSubscriptions,
  turnOffBookSubscriptions,
  turnOnBookSubscriptions,
  clearSubscriptions,
  rescheduleBookSubscriptions,
  deleteBook,
  removeBookFromSubscriptions,
  retryCloudIndex,
  searchBooks,
  toBookIndexStatus,
} from '../repository/book.repository';
import { pubsub } from '../utils/constants';
import { withFilter } from 'graphql-subscriptions';
import { MediaConfigType } from './types/mediaConfig.type';
import { getMediaConfig } from '../repository/mediaConfig.repository';

export const getUserBooksQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('getUserBooks', {
    type: BookType,
    args: {
      offset: intArg(),
      limit: intArg(),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await getUserBooks(ctx.user.id, {
        offset: args.offset || 0,
        limit: args.limit || 100,
      });
    },
  });
});

export const getBookInfoQuery = queryField((t) => {
  t.nonNull.field('getBookInfo', {
    type: BookType,
    args: { bookId: nonNull(stringArg()) },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await getBookInfo(ctx.user.id, args.bookId);
    },
  });
});

export const getBookIndexStatusesQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('getBookIndexStatuses', {
    type: BookIndexStatusType,
    args: { jobIds: nonNull(list(nonNull(stringArg()))) },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await getBookIndexStatuses(ctx.user.id, args.jobIds);
    },
  });
});

export const retryCloudIndexMutation = mutationField((t) => {
  t.nonNull.field('retryCloudIndex', {
    type: BookIndexStatusType,
    args: { jobId: nonNull(stringArg()) },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await retryCloudIndex(ctx.user.id, args.jobId);
    },
  });
});

export const myBookIndexStatusesSubscription = subscriptionField(
  'myBookIndexStatuses',
  {
    type: BookIndexStatusType,
    subscribe(_root, _args, ctx) {
      if (!ctx?.user?.id) {
        throw new Error('Unauthorized request');
      }
      return pubsub.asyncIterator(bookIndexStatusTopic(ctx.user.id));
    },
    resolve(eventData: any) {
      return toBookIndexStatus(eventData);
    },
  }
);

export const getMediaConfigQuery = queryField((t) => {
  t.nullable.field('getMediaConfig', {
    type: MediaConfigType,
    async resolve(_, args) {
      try {
        const mediaConfig = await getMediaConfig();
        return mediaConfig;
        console.log('media config loaded successfully');
      } catch (e) {
        console.log('error loading media config: ', e);
        return null;
      }
    },
  });
});



export const addBookToSubscriptionsMutation = mutationField((t) => {
  t.nonNull.field('addBookToSubscriptions', {
    type: 'Boolean',
    args: {
      bookId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await addBookToSubscriptions(ctx.user.id, args.bookId);
    },
  });
});

export const createSubscriptionsMutation = mutationField((t) => {
  t.nonNull.field('createSubscriptions', {
    type: 'Boolean',
    args: {
      userId: nonNull(stringArg()),
      bookIds: nonNull(list(nonNull(stringArg()))),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      // Drop the client-supplied userId and always operate on the caller.
      return await createSubscriptions(ctx.user.id, args.bookIds);
    },
  });
});

export const turnOffBookSubscriptionsMutation = mutationField((t) => {
  t.nonNull.field('turnOffBookSubscriptions', {
    type: 'Boolean',
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await turnOffBookSubscriptions(ctx.user.id);
    },
  });
});

export const clearSubscriptionsMutation = mutationField((t) => {
  t.nonNull.field('clearSubscriptions', {
    type: 'Boolean',
    args: {
      userId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      // Drop the client-supplied userId and always operate on the caller.
      return await clearSubscriptions(ctx.user.id);
    },
  });
});

export const turnOnBookSubscriptionsMutation = mutationField((t) => {
  t.nonNull.field('turnOnBookSubscriptions', {
    type: 'Boolean',
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await turnOnBookSubscriptions(ctx.user.id);
    },
  });
});


export const rescheduleBookSubscriptionsMutation = mutationField((t) => {
  t.nonNull.field('rescheduleBookSubscriptions', {
    type: 'Boolean',
    args: {
      frequency: nonNull(intArg()),
      startTime: nonNull(stringArg()),
      endTime: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }

      // Validate startTime and endTime format
      const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (
        !timePattern.test(args.startTime) ||
        !timePattern.test(args.endTime)
      ) {
        throw new Error(
          'startTime and endTime must be in HH:MM 24-hour format'
        );
      }

      // Validate frequency is a whole number
      if (!Number.isInteger(args.frequency)) {
        throw new Error('Frequency must be a whole number');
      }

      const res = await rescheduleBookSubscriptions(
        ctx.user.id,
        args.frequency,
        args.startTime,
        args.endTime
      );

      console.log('rescheduled book subscriptions: ', res);
      return res;
    },
  });
});

export const deleteBookMutation = mutationField((t) => {
  t.nonNull.field('deleteBook', {
    type: 'Boolean',
    args: {
      bookId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await deleteBook(ctx.user.id, args.bookId);
    },
  });
});

export const removeBookFromSubscriptionsMutation = mutationField((t) => {
  t.nonNull.field('removeBookFromSubscriptions', {
    type: 'Boolean',
    args: {
      bookId: nonNull(stringArg()),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await removeBookFromSubscriptions(ctx.user.id, args.bookId);
    },
  });
});

export const getBookProgressSubscription = subscriptionField(
  'getBookProgress',
  {
    type: BookType,
    args: { jobId: nullable(stringArg()), userId: nullable(stringArg()) },
    // Legacy quote-progress path is retired; nothing publishes this event.
    subscribe: withFilter(
      () => pubsub.asyncIterator(BOOK_PROGRESS_SUBSCRIPTION_EVENT),
      (payload, variables, context: any) => {
        if (!context?.user?.id) return false;
        if (String(payload.userId) !== String(context.user.id)) return false;
        if (variables.userId) {
          return String(payload.userId) === String(variables.userId);
        }
        if (variables.jobId) {
          return String(payload.jobId) === String(variables.jobId);
        }
        return false;
      }
    ),
    resolve(eventData) {
      return eventData;
    },
  }
);

export const searchBookQuery = queryField((t) => {
  t.nonNull.list.nonNull.field('searchBooks', {
    type: BookType,
    args: {
      searchText: nonNull(stringArg()),
      offset: intArg(),
      limit: intArg(),
    },
    async resolve(_, args, ctx) {
      if (!ctx.user) {
        throw new Error('Unauthorized request');
      }
      return await searchBooks(ctx.user.id, args.searchText, {
        offset: args.offset || 1,
        limit: args.limit || 10,
      });
    },
  });
});



