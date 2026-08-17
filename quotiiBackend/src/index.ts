import { initFirebase } from './utils/firebase.util';
import { connectToDb } from './database/mongoDbConnection';
import { watchBookIndexStatus } from './database/watchers';
import QueueService, { Queues } from './utils/jobQueues/queue.service';
import { createHttpApp } from './httpApp';

const events = require('node:events');
events.captureRejections = true;

export async function startServer() {
  await connectToDb();
  initFirebase();
  watchBookIndexStatus();

  QueueService.getInstance(false);
  await getJobInfo();

  const { httpServer } = await createHttpApp();

  await new Promise<void>((resolve) =>
    httpServer.listen({ port: 3000 }, resolve)
  );

  process.on('uncaughtException', (error, origin) => {
    console.log('----- Uncaught exception -----');
    console.log(error);
    console.log('----- Exception origin -----');
    console.log(origin);
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.log('----- Unhandled Rejection at -----');
    console.log(promise);
    console.log('----- Reason -----');
    console.log(reason);
  });
  process.on('exit', () => {
    console.log('Cleaning up application.');
    console.log(
      '*********************** shutting down socket server ***********************'
    );
    console.log(
      '*********************** application successfully ended ***********************'
    );
  });
  console.log(`Server ready at http://localhost:3000`);
}

async function getJobInfo() {
  let queue = await QueueService.getInstance().getQueue(Queues.NOTIFICATION);
  let jobs = await queue.getJobCounts();
  console.log('NOTIFICATION QUEUE ---> ', jobs);

  queue = await QueueService.getInstance().getQueue(Queues.UNSPLASH_SYNC);
  jobs = await queue.getJobCounts();
  console.log('UNSPLASH SYNC QUEUE ---> ', jobs);
}

if (require.main === module) {
  startServer();
}
