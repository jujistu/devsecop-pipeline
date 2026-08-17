import { Book, IndexStatus } from '../database/schemas/book.schema';
import { Subscription } from '../database/schemas/subscription.schema';
import {
  sendQuoteNotification,
  sendQuoteNotificationFromBook,
} from '../utils/jobQueues/notificationHandler';
import QueueService, {
  JobType,
  Queues,
} from '../utils/jobQueues/queue.service';
import { User } from '../database/schemas/user.schema';
import { Quote } from '../database/schemas/quote.schema';
import axios from 'axios';
import { pdfProcessorUrl } from '../utils/pdfProcessor.util';

export const getBookInfo = async (userId: string, bookId: string) => {
  const book = await Book.findOne({ _id: bookId, userId }).lean();
  if (!book) {
    throw new Error('Book not found');
  }
  return book;
};

/** Map a Book document to the BookIndexStatus GraphQL shape. */
export function toBookIndexStatus(book: {
  jobId: string;
  userId: string;
  indexStatus?: string | null;
  indexError?: string | null;
  contextObjectKey?: string | null;
}) {
  return {
    jobId: book.jobId,
    userId: book.userId,
    indexStatus: book.indexStatus ?? IndexStatus.QUEUED,
    indexError: book.indexError ?? null,
    contextObjectKey: book.contextObjectKey ?? null,
  };
}

/** Snapshots for jobIds the user owns. Unknown / other-user ids are omitted. */
export const getBookIndexStatuses = async (
  userId: string,
  jobIds: string[]
) => {
  if (!jobIds.length) return [];
  const books = await Book.find({
    userId,
    jobId: { $in: jobIds },
  }).lean();
  return (books as any[]).map((book) => toBookIndexStatus(book));
};

/**
 * Wave B — issue 19. Verifies an authenticated user may write/index under a
 * client-supplied `jobId`. A job is writable when it is either unclaimed (the
 * first poster becomes its owner) or already owned by the same user. A jobId
 * owned by a different user returns false so callers can reject (403/404)
 * before proxying content to the PdfProcessor.
 */
export const canWriteJobId = async (userId: string, jobId: string) => {
  if (!jobId || !userId) return false;
  const existing = await Book.findOne({ jobId }).lean();
  if (!existing) return true; // unclaimed -> caller becomes owner
  return String((existing as any).userId) === String(userId);
};

/**
 * Ask the PdfProcessor to re-enter Cloud indexing for a failed job.
 * Ownership is checked against the authenticated user.
 */
export const retryCloudIndex = async (userId: string, jobId: string) => {
  const book = await Book.findOne({ jobId, userId }).lean();
  if (!book) {
    throw new Error('Indexing job not found');
  }

  const current = (book as any).indexStatus as string | undefined;
  if (current === IndexStatus.READY) {
    return toBookIndexStatus(book as any);
  }
  if (current === IndexStatus.PROCESSING || current === IndexStatus.QUEUED) {
    return toBookIndexStatus(book as any);
  }

  const response = await axios.post(
    pdfProcessorUrl('/retry-index'),
    { jobId },
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (response.status >= 400) {
    throw new Error(response.data?.error || 'Failed to retry Cloud indexing');
  }

  // Reflect queued immediately for the GraphQL response; processor will advance.
  await Book.updateOne(
    { jobId, userId },
    {
      $set: {
        indexStatus: IndexStatus.QUEUED,
        indexError: null,
        contextObjectKey: null,
      },
    }
  );

  const updated = await Book.findOne({ jobId, userId }).lean();
  return toBookIndexStatus(updated as any);
};

interface PaginationOptions {
  offset?: number;
  limit?: number;
}

export const searchBooks = async (
  userId: string, 
  searchText: string,
  { offset = 0, limit = 10 }: PaginationOptions = {}
) => {
  try {
    // Calculate skip value for pagination
    const skip = offset;

    // Get paginated results
    const books = await Book.find({
      userId,
      $text: { $search: searchText }
    })
    .sort({ score: { $meta: 'textScore' } })
    .skip(skip)
    .limit(limit)
    .lean();
    
    return books
  } catch (error) {
    console.error('Error searching books:', error);
    throw new Error('Failed to search books');
  }
};

export const getUserBooks = async (
  userId: string,
  { offset = 0, limit = 10 }: PaginationOptions = {}
) => {
  try {
    const skip = offset;

    const books = await Book.aggregate([
      // Match books for the user
      { $match: { userId } },
      // Sort by creation date
      { $sort: { createdAt: -1 } },
      // Skip and limit for pagination
      { $skip: skip },
      { $limit: limit },
      // Lookup subscriptions
      {
        $lookup: {
          from: 'subscriptions',
          let: { bookId: { $toString: '$_id' } },
          pipeline: [
            { $match: { userId } },
            {
              $project: {
                isSubscribed: {
                  $in: ['$$bookId', '$bookIds']
                }
              }
            }
          ],
          as: 'subscription'
        }
      },
      // Add isSubscribed field
      {
        $addFields: {
          isSubscribed: {
            $cond: {
              if: { $size: '$subscription' },
              then: { $arrayElemAt: ['$subscription.isSubscribed', 0] },
              else: false
            }
          }
        }
      },
      // Remove subscription array from result
      {
        $project: {
          subscription: 0
        }
      }
    ]);

    return books;
  } catch (error) {
    console.error('Error fetching user books:', error);
    throw new Error('Failed to fetch user books');
  }
};

export const createSubscriptions = async (
  userId: string,
  bookIds: string[]
) => {
  if (bookIds.length < 1) {
    return false;
  }
  console.log('subscribing to books with ids: ', bookIds);
  const res = await Subscription.findOneAndUpdate(
    { userId: userId },
    { bookIds: bookIds },
    { upsert: true, new: true }
  );
  if (res && res.active) {
    await cancelPreviousSchedules(res.jobIds);
    await scheduleFutureNotifications(userId, res.bookIds);

    return true;
  } else {
    if (!res) {
      return false;
    } else {
      return false;
    }
    
  }
};



const cancelPreviousSchedules = async (jobIds: string[]) => {
  const queue = QueueService.getInstance().getQueue(Queues.NOTIFICATION);
  let jobs = await queue.getJobCounts();
  console.log('removing previous scheduled jobs: ', jobIds);

  console.log('current job counts -> ', jobs);

  for (const jobId of jobIds) {
    console.log('removing job -> ', jobId);
    const isRemoved = await queue.removeRepeatableByKey(jobId);
    console.log('job removed? --> ', isRemoved);

    const jobs = await queue.getJobCounts();
    console.log('new job counts -> ', jobs);
  }
};

const scheduleFutureNotifications = async (
  userId: string,
  bookIds: string[]
) => {
  if (bookIds.length < 1) {
    return false;
  }
  console.log('scheduling future notifications');

  const user = await User.findById(userId).lean();
  const timeZone = user?.timeZone || 'UTC';

  let subscription = await Subscription.findOne({ userId: userId });
  if (!subscription) {
    console.log('subscription is not available. Creating a new one');
    subscription = await Subscription.findOneAndUpdate(
      { userId: userId },
      { active: true, bookIds: bookIds, startTime: '08:00', endTime: '19:00' },
      { upsert: true, new: true }
    );
  }

  if (subscription) {
    console.log("user subscription info available. Let's do this");
    const { startTime, endTime, frequency } = subscription;
    console.log(
      `start time is ${startTime}, endTime is: ${endTime} and ${frequency} notifications should be sent a day`
    );
    const notificationQueue = QueueService.getInstance().getQueue(
      Queues.NOTIFICATION
    );
    const jobType = JobType.QUOTE_NOTIFICATION;

    if (frequency < 1) {
      throw new Error('countPerDay must be at least 1');
    }

    // Convert start and end times to Date objects
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);

    // Parse hours and minutes from startTime and endTime (assuming format "HH:mm")
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    start.setHours(startHour, startMinute, 0, 0);
    end.setHours(endHour, endMinute, 0, 0);

    // Calculate time window in milliseconds
    let timeWindow = end.getTime() - start.getTime();
    if (timeWindow < 0) {
      timeWindow += 24 * 60 * 60 * 1000; // Add 24 hours if end time is next day
    }

    // Handle scheduling based on countPerDay
    const schedulePoints = [];

    if (frequency === 1) {
      // Single notification: Use start time
      schedulePoints.push(new Date(start.getTime()));
    } else {
      // Multiple notifications: Space them evenly with first and last at boundaries
      const interval = timeWindow / (frequency - 1);
      for (let i = 0; i < frequency; i++) {
        const notificationTime = new Date(start.getTime() + interval * i);
        schedulePoints.push(notificationTime);
      }
    }

    const jobsToSave = [];
    // Schedule all notifications
    for (let i = 0; i < schedulePoints.length; i++) {
      let syncToNuggetOfTheDay = false; // Initialize the variable
      // Update nugget of the day twice a day. Morning and night
      if (i === 0 || i === schedulePoints.length - 1) {
        syncToNuggetOfTheDay = true; // Set to true if i is 0
      }
      const notificationTime = schedulePoints[i];

      // If notification time passes midnight, add a day
      if (notificationTime < start) {
        notificationTime.setDate(notificationTime.getDate() + 1);
      }

      const job = await notificationQueue.add(
        jobType,
        {
          userId,
          bookIds,
          syncToNuggetOfTheDay
        },
        {
          repeat: {
            pattern: `${notificationTime.getMinutes()} ${notificationTime.getHours()} * * *`,
            tz: timeZone,
          },
        }
      );
      jobsToSave.push(job.repeatJobKey);
    }

    const res = await Subscription.updateOne(
      { userId: userId },
      { jobIds: jobsToSave }
    );
    console.log(
      `New quote notification jobs scheduled for user: ${userId} & bookIds: ${bookIds}. JobIds are: `,
      jobsToSave
    );
    let jobs = await notificationQueue.getJobCounts();
    console.log('current job counts -> ', jobs);
  }
};

export const turnOffBookSubscriptions = async (userId: string) => {
  try {
    const currentSub = await Subscription.findOne({ userId: userId });
    if (currentSub) {
      await cancelPreviousSchedules(currentSub.jobIds);
      const res = await Subscription.findOneAndUpdate(
        { userId: userId },
        { active: false, jobIds: [] },
        { upsert: false }
      );
    } else {
      return false;
    }
  } catch (e) {
    return false;
  }

  console.log('turned off book subs');
  return true;
};

export const clearSubscriptions = async (userId: string) => {
  const res = await Subscription.findOneAndUpdate(
    { userId: userId },
    { jobIds: [], bookIds: [] },
    { upsert: false }
  );

  if (res) {
    try {
      await cancelPreviousSchedules(res.jobIds);
    } catch (e) {
      return false;
    }
  } else {
    return false;
  }

  return true;
};

export const deleteBook = async(userId: string, bookId: string) => {
  try {
    // Delete book from books collection
    const deletedBook = await Book.findOneAndDelete({ _id: bookId, userId });
    if (!deletedBook) {
      throw new Error('Book not found or unauthorized');
    }

    // Delete all book quotes
    await Quote.deleteMany({ bookId });

    // Remove bookId from user subscription bookIds list
    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      { $pull: { bookIds: bookId } },
      { new: true }
    );

    // If user has active subscriptions, reschedule notifications
    if (subscription && subscription.active) {
      await cancelPreviousSchedules(subscription.jobIds);
      await scheduleFutureNotifications(userId, subscription.bookIds);
    }

    return true;
  } catch (error) {
    console.error('Error deleting book:', error);
    throw new Error('Failed to delete book');
  }
};

export const turnOnBookSubscriptions = async (userId: string) => {
  const res = await Subscription.findOneAndUpdate(
    { userId: userId },
    { active: true },
    { upsert: false }
  );

  if (res) {
    try {
      await cancelPreviousSchedules(res.jobIds);
      await scheduleFutureNotifications(userId, res.bookIds);
    } catch (e) {
      return false;
    }
  } else {
    return false;
  }

  console.log('turned on book subs')
  return true;
};

export const rescheduleBookSubscriptions = async (
  userId: string,
  frequency: number,
  startTime: string,
  endTime: string
) => {
  try {
    await turnOffBookSubscriptions(userId);
    const res = await Subscription.findOneAndUpdate(
      { userId: userId },
      {
        active: true,
        frequency: frequency,
        startTime: startTime,
        endTime: endTime,
      },
      { upsert: true, new: true }
    );
    await scheduleFutureNotifications(userId, res.bookIds);
    return true
  } catch (e) {
    console.log('error rescheduling book subscriptions --> ', e);
    return false
  }
};

export const addBookToSubscriptions = async (
  userId: string,
  bookId: string
) => {
  if (!bookId || !userId) {
    return false;
  }
  console.log('subscribing to book with id: ', bookId);
  const res = await Subscription.findOneAndUpdate(
    { userId: userId },
    { $addToSet: { bookIds: bookId } },
    { upsert: true, new: true }
  );
  if (res && res.active) {
    await cancelPreviousSchedules(res.jobIds);
    await scheduleFutureNotifications(userId, res.bookIds);
    

    const book = await getBookInfo(userId, bookId);
    await sendQuoteNotificationFromBook(
      userId,
      bookId,
      `A nugget from your book ${book.title ? book.title : '...'}`
    );
    console.log('added book to user subscriptions')
    return true;
  } else {
    if (!res) {
      return false;
    } else {
      return true;
    }
  }
};

export const removeBookFromSubscriptions = async (
  userId: string,
  bookId: string
) => {
  if (!bookId || !userId) {
    return false;
  }
  try {
    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      { $pull: { bookIds: bookId } },
      { new: true }
    );

    if (subscription && subscription.active) {
      await cancelPreviousSchedules(subscription.jobIds);
      await scheduleFutureNotifications(userId, subscription.bookIds);
      console.log('removed book from user subscriptions')
      return true;
    }

    if (!subscription) {
      return false;
    } else {
      return true
    }
  } catch (error) {
    console.error('Error removing book from subscriptions:', error);
    return false;
  }
};
