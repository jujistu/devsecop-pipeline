import { bookIndexStatusTopic } from '../graphql/types/book.type';
import { pubsub } from '../utils/constants';
import { Book } from './schemas/book.schema';

/** Publish Cloud indexing status changes for GraphQL subscribers. */
export function watchBookIndexStatus() {
  const pipeline = [
    {
      $match: {
        $or: [
          { 'fullDocument.indexStatus': { $exists: true, $ne: null } },
          { 'updateDescription.updatedFields.indexStatus': { $exists: true } },
        ],
      },
    },
    {
      $project: {
        fullDocument: 1,
      },
    },
  ];

  function startWatcher() {
    Book.watch(pipeline, { fullDocument: 'updateLookup' })
      .on('change', (change) => {
        if (!change.fullDocument?.indexStatus) return;
        const userId = change.fullDocument.userId;
        if (!userId) return;
        console.log(
          `Index status for job ${change.fullDocument.jobId}: ${change.fullDocument.indexStatus}`
        );
        pubsub.publish(
          bookIndexStatusTopic(String(userId)),
          change.fullDocument
        );
      })
      .on('error', (error) => {
        console.error('Error watching book index status:', error);
        console.log('Restarting index-status watcher...');
        setTimeout(startWatcher, 5000);
      });
  }

  startWatcher();
}
