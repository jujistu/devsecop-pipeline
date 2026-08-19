import { Job, Queue, Worker } from 'bullmq';
import {
  sendQuoteNotification,
  sendQuoteNotificationFromBook,
} from './notificationHandler';
import { getRandomPhoto, trackPhotoDownload } from '../unsplash.util';
import { MediaConfig } from '../../database/schemas/mediaConfig.schema';
import { getRedisConnection } from '../redisConnection';

export enum Queues {
  NOTIFICATION = 'NOTIFICATION',
  UNSPLASH_SYNC = 'UNSPLASH_SYNC',
}

export enum JobType {
  QUOTE_NOTIFICATION = 'QUOTE_NOTIFICATION',
  GET_NUGGET_OF_THE_DAY_PHOTO = 'GET_NUGGET_OF_THE_DAY_PHOTO',
  GET_OTHER_NATURE_IMAGES = 'GET_OTHER_NATURE_IMAGES',
}

export default class QueueService {
  private queues!: Record<string, Queue>;
  private defaultQueue!: Queue;

  private static instance: QueueService;

  private static getConnector() {
    return getRedisConnection();
  }

  private static QUEUE_OPTIONS = {
    connection: QueueService.getConnector(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  };

  constructor(initializeJobs: boolean = true) {
    if (QueueService.instance instanceof QueueService) {
      return QueueService.instance;
    }

    this.queues = {};
    QueueService.instance = this;

    this.instantiateQueues();

    if (initializeJobs) {
      this.instantiateWorkers();
      void this.instantiateJobs();
    }
  }

  static getInstance(initializeJobs: boolean = true) {
    return new QueueService(initializeJobs);
  }

  private instantiateQueues() {
    this.defaultQueue = new Queue(
      Queues.NOTIFICATION,
      QueueService.QUEUE_OPTIONS,
    );

    const unsplashQueue = new Queue(
      Queues.UNSPLASH_SYNC,
      QueueService.QUEUE_OPTIONS,
    );

    this.queues[Queues.NOTIFICATION] = this.defaultQueue;
    this.queues[Queues.UNSPLASH_SYNC] = unsplashQueue;
  }

  private async instantiateWorkers() {
    const notificationWorker = new Worker(
      Queues.NOTIFICATION,
      async (job: Job) => {
        switch (job.name) {
          case JobType.QUOTE_NOTIFICATION:
            console.log(
              `job for sending notification called for jobId --> ${
                job.id
              } at ${new Date().toLocaleTimeString()}`,
            );
            await sendQuoteNotification(
              job.data.userId,
              job.data.bookIds,
              job.data.syncToNuggetOfTheDay,
            );
            break;
        }
      },
      {
        connection: QueueService.getConnector(),
        autorun: true,
        // Wave B — issue 20: serialize quote-notification jobs so selecting and
        // claiming a quote is atomic. With concurrency >1, overlapping jobs can
        // sample the same unseen quote and deliver it twice (TOCTOU).
        concurrency: 1,
      },
    );
    notificationWorker.on('completed', (job: Job, value) => {
      console.log(
        `[NOTIFICATION QUEUE] Completed job with data\n
          Data: ${job.asJSON().data}\n
          ID: ${job.id}\n
          Value: ${value}
        `,
      );
    });

    notificationWorker.on('failed', (job: any, error) => {
      console.log(
        `[NOTIFICATION QUEUE] Failed job with data\n
          Data: ${job.asJSON().data}\n
          ID: ${job.id}\n
          Value: ${error}
        `,
      );
    });

    const unsplashWorker = new Worker(
      Queues.UNSPLASH_SYNC,
      async (job: Job) => {
        switch (job.name) {
          case JobType.GET_NUGGET_OF_THE_DAY_PHOTO:
            console.log(
              `job for getting nugget of the day photo called for jobId --> ${
                job.id
              } at ${new Date().toLocaleTimeString()}`,
            );
            try {
              const photo = await getRandomPhoto({
                query: 'nature',
                orientation: 'portrait',
              });
              // Track the download
              const photoDownloadUrl = await trackPhotoDownload(
                photo.links.download_location,
              );

              await MediaConfig.findOneAndUpdate(
                {},
                {
                  nuggetOfTheDayImageUrl: photo.urls.regular,
                  nuggetOfTheDayTrackedDownloadUrl: photoDownloadUrl.url,
                },
                { upsert: true },
              );
            } catch (error) {
              console.error('Failed to update nugget of the day photo:', error);
              throw error;
            }
            break;

          case JobType.GET_OTHER_NATURE_IMAGES:
            break;
        }
      },
      {
        connection: QueueService.getConnector(),
        autorun: true,
      },
    );
    unsplashWorker.on('completed', (job: Job, value) => {
      console.log(
        `[UNSPLASH QUEUE] Completed job with data\n
          Data: ${job.asJSON().data}\n
          ID: ${job.id}\n
          Value: ${value}
        `,
      );
    });

    unsplashWorker.on('failed', (job: any, error) => {
      console.log(
        `[UNSPLASH QUEUE] Failed job with data\n
          Data: ${job.asJSON().data}\n
          ID: ${job.id}\n
          Value: ${error}
        `,
      );
    });
  }

  private async instantiateJobs() {
    await this.initNuggetOfTheDayPhotoJob();
  }

  private async initNuggetOfTheDayPhotoJob() {
    // await this.cleanQueue(Queues.UNSPLASH_SYNC)
    await this.getJobInfo(Queues.UNSPLASH_SYNC);
    const repeatJobKey = 'nugget-of-the-day-photo-job';
    // Remove any existing repeat job with this key
    await this.queues[Queues.UNSPLASH_SYNC].removeRepeatableByKey(repeatJobKey);
    await this.getJobInfo(Queues.UNSPLASH_SYNC);
    // Add new repeat job
    await this.queues[Queues.UNSPLASH_SYNC].add(
      JobType.GET_NUGGET_OF_THE_DAY_PHOTO,
      {},
      {
        repeat: {
          // pattern: '0 */12 * * *',
          every: 1 * 60 * 60 * 1000,
          immediately: true,
          key: repeatJobKey,
        },
      },
    );
    await this.getJobInfo(Queues.UNSPLASH_SYNC);
  }

  getQueue(name: Queues) {
    return this.queues[name];
  }

  async getJobInfo(name: Queues) {
    let queue = await QueueService.getInstance().getQueue(name);
    let jobs = await queue.getJobCounts();
    console.log(`${name.toString()} QUEUE ---> `, jobs);
  }

  async cleanQueue(name: Queues) {
    const queue = await QueueService.getInstance().getQueue(name);
    const delayed = await queue.getDelayed();
    const active = await queue.getActive();
    for (const job of delayed) {
      await queue.remove(job.id as string);
      console.log(`Removed delayed job with ID ${job.id}`);
    }
    for (const job of active) {
      await queue.remove(job.id as string);
      console.log(`Removed active job with ID ${job.id}`);
    }
  }
}
