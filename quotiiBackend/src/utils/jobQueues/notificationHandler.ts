import { ObjectId } from 'mongodb';
import { Quote } from '../../database/schemas/quote.schema';
import { QuoteView } from '../../database/schemas/quoteView.schema';
import { User } from '../../database/schemas/user.schema';
import { Book } from '../../database/schemas/book.schema';
import { sendNotification } from '../expo.util';
import { booleanArg } from 'nexus';
import { NuggetOfTheDay } from '../../database/schemas/nuggetOfTheDay.schema';

export const sendQuoteNotification = async (
  userId: string,
  bookIds: string[],
  syncToNuggetOfTheDay: boolean,
  title?: string | null
) => {
  console.log('trying to send notification to user');
  try {
    // Step 1: Fetch a random unseen quote for the user
    const seenQuotes = await QuoteView.find({ userId }).select('quoteId');
    const seenQuoteIds = seenQuotes.map((quoteView) => quoteView.quoteId);

    let unseenQuote = await Quote.aggregate([
      {
        $match: {
          bookId: { $in: bookIds },
          _id: { $nin: seenQuoteIds },
        },
      },
      { $sample: { size: 1 } },
    ]).exec();

    if (!unseenQuote || unseenQuote.length === 0) {
      console.log('No unseen quotes available for this user.');
      // TODO: reset views for these set of books so all this stuff starts again rather than sending random quotes
      const random = await Quote.aggregate([
        { $match: { bookId: { $in: bookIds } } },
        { $sample: { size: 1 } },
      ]).exec();

      if (!random || random.length === 0) {
        console.log('No quotes available for this book and user.');
        return false;
      }
      // Use the first (and only) result from the aggregation
      unseenQuote = random;
    }

    // Use the first (and only) result from the aggregation
    const randomQuote = unseenQuote[0];

    // Fetch the book details
    const book = await Book.findById(randomQuote.bookId).exec();
    if (!book) {
      console.log('Book not found.');
      return false;
    }

    // Step 2: Fetch the user's details
    const user = await User.findById(userId).exec();
    if (!user) {
      console.log('User not found.');
      return false;
    }

    // Step 3: Send the notification
    const notificationTitle = title ? title : syncToNuggetOfTheDay ? "Nugget of the day" : 'Nuggets';
    
    const notificationContent =
      (randomQuote.quote as string) + ` - ${book.title}`;
    // const notificationContent = 'Test quote'
    const deviceTokens = user.deviceIds;

    let resp = await sendNotification(
      deviceTokens,
      notificationTitle,
      notificationContent,
      // {
      //   text: randomQuote.quote,
      //   title: book.title,
      // }
    );
    console.log('notification send request response -> ', resp)
    console.log(notificationContent)

    // create a nugget of the day item for the user if syncToNuggetOfTheDay is true
    if (syncToNuggetOfTheDay) {
      const nuggetOfTheDay = await NuggetOfTheDay.findOneAndUpdate(
        { userId: userId },
        {
          quoteId: randomQuote._id,
          bookId: randomQuote.bookId,
          body: randomQuote.quote,
          title: book.title,
          // Book schema no longer stores author (index/status SoT only).
          author: null,
        },
        { upsert: true, new: true }
      );
    }
    // Step 4: Add the quote to the quoteViewSchema to mark it as seen
    const newQuoteView = new QuoteView({
      quoteId: randomQuote._id,
      userId: userId,
    });

    await newQuoteView.save();

    console.log('Notification sent and quote marked as seen.');
    return true;
  } catch (error) {
    console.error('Error sending quote notification:', error);
    return false;
  }
};

export const sendQuoteNotificationFromBook = async (
  userId: string,
  bookId: string,
  title?: string | null
) => {
  console.log('trying to send notification to user');
  try {
    // Step 1: Fetch a random unseen quote for the user
    const seenQuotes = await QuoteView.find({ userId }).select('quoteId');
    const seenQuoteIds = seenQuotes.map((quoteView) => quoteView.quoteId);

    let unseenQuote = await Quote.aggregate([
      {
        $match: {
          bookId: bookId,
          _id: { $nin: seenQuoteIds },
        },
      },
      { $sample: { size: 1 } },
    ]).exec();

    if (!unseenQuote || unseenQuote.length === 0) {
      console.log('No unseen quotes available for this user.');
      // TODO: reset views for these set of books so all this stuff starts again rather than sending random quotes
      const random = await Quote.aggregate([
        { $match: { bookId: bookId } },
        { $sample: { size: 1 } },
      ]).exec();

      if (!random || random.length === 0) {
        console.log('No quotes available for this book and user.');
        return false;
      }
      // Use the first (and only) result from the aggregation
      unseenQuote = random;
    }

    // Use the first (and only) result from the aggregation
    const randomQuote = unseenQuote[0];

    // Fetch the book details
    const book = await Book.findById(bookId).exec();
    if (!book) {
      console.log('Book not found.');
      return false;
    }

    // Step 2: Fetch the user's details
    const user = await User.findById(userId).exec();
    if (!user) {
      console.log('User not found.');
      return false;
    }

    // Step 3: Send the notification
    const notificationTitle = title ? title : `Nugget of the day`;
    const notificationContent =
      (randomQuote.quote as string) + ` - ${book.title}`;
    // const notificationContent = 'Test quote'
    const deviceTokens = user.deviceIds;

    await sendNotification(
      deviceTokens,
      notificationTitle,
      notificationContent,
      {
        text: randomQuote.quote,
        title: book.title,
      }
    );

    // Step 4: Add the quote to the quoteViewSchema to mark it as seen
    const newQuoteView = new QuoteView({
      quoteId: randomQuote._id,
      userId: userId,
    });

    await newQuoteView.save();

    console.log('Notification sent and quote marked as seen.');
    return true;
  } catch (error) {
    console.error('Error sending quote notification:', error);
    return false;
  }
};

export const sendQuoteNotificationFromBookDataOnly = async (
  userId: string,
  bookIds: string[],
  title?: string | null
) => {
  console.log('trying to send notification to user');
  try {
    // Step 1: Fetch a random unseen quote for the user
    const seenQuotes = await QuoteView.find({ userId }).select('quoteId');
    const seenQuoteIds = seenQuotes.map((quoteView) => quoteView.quoteId);

    let unseenQuote = await Quote.aggregate([
      {
        $match: {
          bookId: { $in: bookIds },
          _id: { $nin: seenQuoteIds },
        },
      },
      { $sample: { size: 1 } },
    ]).exec();

    if (!unseenQuote || unseenQuote.length === 0) {
      console.log('No unseen quotes available for this user.');
      // TODO: reset views for these set of books so all this stuff starts again rather than sending random quotes
      const random = await Quote.aggregate([
        { $match: { bookId: { $in: bookIds } } },
        { $sample: { size: 1 } },
      ]).exec();

      if (!random || random.length === 0) {
        console.log('No quotes available for this book and user.');
        return false;
      }
      // Use the first (and only) result from the aggregation
      unseenQuote = random;
    }

    // Use the first (and only) result from the aggregation
    const randomQuote = unseenQuote[0];

    // Fetch the book details
    const book = await Book.findById(randomQuote.bookId).exec();
    if (!book) {
      console.log('Book not found.');
      return false;
    }

    // Step 2: Fetch the user's details
    const user = await User.findById(userId).exec();
    if (!user) {
      console.log('User not found.');
      return false;
    }

    // Step 3: Send the notification
    const notificationTitle = title ? title : `Nugget of the day`;
    const notificationContent =
      (randomQuote.quote as string) + ` - ${book.title}`;
    // const notificationContent = 'Test quote'
    const deviceTokens = user.deviceIds;

    await sendNotification(deviceTokens, undefined, undefined, {
      text: randomQuote.quote,
      title: book.title,
    });

    // Step 4: Add the quote to the quoteViewSchema to mark it as seen
    const newQuoteView = new QuoteView({
      quoteId: randomQuote._id,
      userId: userId,
    });

    await newQuoteView.save();

    console.log('Notification sent and quote marked as seen.');
    return true;
  } catch (error) {
    console.error('Error sending quote notification:', error);
    return false;
  }
};
