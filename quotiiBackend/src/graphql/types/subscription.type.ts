import { objectType } from 'nexus';

export const SubscriptionType = objectType({
  name: 'Subscription',
  definition(t) {
    t.nonNull.string('_id'); 
    t.nonNull.string('userId');
    t.list.nonNull.string('bookIds');
    t.list.nonNull.string('jobIds');
    t.nonNull.int('frequency');
    t.nonNull.boolean('active');
    t.nonNull.string('startTime');
    t.nonNull.string('endTime');
  },
});
