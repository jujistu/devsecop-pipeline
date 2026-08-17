import { ObjectId } from 'mongodb';
import { Quote } from '../database/schemas/quote.schema';
import { Book } from '../database/schemas/book.schema';
import { Like } from '../database/schemas/like.schema';
import { NuggetOfTheDay } from '../database/schemas/nuggetOfTheDay.schema';

export const getViewedQuotesForBook = async (
  userId: string,
  bookId: string
) => {
  console.log(`getViewedQuotesForBook userId: ${userId} ; bookId: ${bookId}`);
  return [{ quote: 'Hello there' }];
};

export const addQuote = async (
  userId: string,
  quote: string,
  bookId: string
) => {
  // Verify the book belongs to the authenticated user before adding a quote.
  const book = await Book.findOne({ _id: bookId, userId }).lean();
  if (!book) {
    throw new Error('Unauthorized: book does not belong to user');
  }
  try {
    const newQuote = new Quote({ bookId: bookId, quote: quote });
    await newQuote.save();
    return true;
  } catch (e) {
    console.log('error adding new quote --> ', e);
    return false;
  }
};

export const getQuotesForBook = async (
  bookId: string,
  offset: number,
  limit: number,
  userId: string
) => {
  // Verify the book belongs to the authenticated user before returning quotes.
  const book = await Book.findOne({ _id: bookId, userId }).lean();
  if (!book) {
    throw new Error('Unauthorized: book does not belong to user');
  }
  try {
    const quotes = await Quote.aggregate([
      { $match: { bookId } },
      { $skip: offset },
      { $limit: limit },
      {
        $lookup: {
          from: 'likes',
          let: { quoteId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$quoteId', { $toObjectId: '$$quoteId' }] },
                    { $eq: ['$userId', new ObjectId(userId)] },
                  ],
                },
              },
            },
          ],
          as: 'likes',
        },
      },
      {
        $addFields: {
          liked: { $gt: [{ $size: '$likes' }, 0] },
        },
      },
      {
        $project: {
          likes: 0, // Remove the likes array from the final results
        },
      },
    ]).exec();

    return quotes;
  } catch (e) {
    console.error('Error fetching quotes for book:', e);
    return [];
  }
};

export const likeQuote = async (
  userId: string,
  quoteId: string
): Promise<boolean> => {
  try {
    const existingLike = await Like.findOne({ userId, quoteId });
    if (existingLike) {
      return true; // Already liked
    }

    const newLike = new Like({
      userId: new ObjectId(userId),
      quoteId: new ObjectId(quoteId),
    });
    await newLike.save();
    return true;
  } catch (e) {
    console.error('Error liking quote:', e);
    return false;
  }
};

export const unlikeQuote = async (
  userId: string,
  quoteId: string
): Promise<boolean> => {
  try {
    const result = await Like.findOneAndDelete({
      userId: new ObjectId(userId),
      quoteId: new ObjectId(quoteId),
    });
    return result !== null;
  } catch (e) {
    console.error('Error unliking quote:', e);
    return false;
  }
};

export const getUserLikedQuotes = async (
  userId: string,
  offset: number,
  limit: number
) => {
  try {
    const likedQuotes = await Like.aggregate([
      { $match: { userId: new ObjectId(userId) } },
      { $skip: offset },
      { $limit: limit },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'quotes',
          localField: 'quoteId',
          foreignField: '_id',
          as: 'quoteDetails',
        },
      },
      {
        $unwind: '$quoteDetails',
      },
      {
        $addFields: {
          'quoteDetails.liked': true,
        },
      },
      {
        $project: {
          _id: 0,
          quote: '$quoteDetails',
        },
      },
    ]).exec();

    return likedQuotes.map((value) => {
      return value.quote;
    });
  } catch (e) {
    console.error('Error fetching user liked quotes:', e);
    return [];
  }
};

export const searchQuotes = async (
  searchString: string,
  offset: number,
  limit: number
) => {
  try {
    const quotes = await Quote.find(
      { $text: { $search: searchString } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .skip(offset)
      .limit(limit)
      .exec();
    return quotes;
  } catch (e) {
    console.error('Error searching quotes:', e);
    return [];
  }
};

export const searchUserLikedQuotes = async (
  userId: string,
  searchString: string,
  offset: number,
  limit: number
) => {
  try {
    // Find the user's likes and search within those quotes
    const likedQuotes = await Like.find({
      userId: new ObjectId(userId),
    })
      .populate({
        path: 'quoteId',
        match: { $text: { $search: searchString } },
      })
      .skip(offset)
      .limit(limit)
      .lean();

    return likedQuotes
      .map((like) => {
        let value = { ...like.quoteId, liked: true };
        console.log(value)
        return value;
      })
      .filter((quote: any) => quote.quote);
  } catch (e) {
    console.error('Error searching user liked quotes:', e);
    return [];
  }
};

export const getNuggetOfTheDay = async (userId: string) => {
  try {
    const [nugget] = await NuggetOfTheDay.aggregate([
      { $match: { userId: userId } },
      {
        $lookup: {
          from: 'likes',
          let: { quoteId: '$quoteId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$quoteId', { $toObjectId: '$$quoteId' }] },
                    { $eq: ['$userId', new ObjectId(userId)] },
                  ],
                },
              },
            },
          ],
          as: 'likes',
        },
      },
      {
        $addFields: {
          isLiked: { $gt: [{ $size: '$likes' }, 0] },
        },
      },
      {
        $project: {
          likes: 0,
        },
      },
    ]).exec();

    return nugget;
  } catch (e) {
    console.error('Error fetching nugget of the day:', e);
    return null;
  }
};

export const getLikedQuotesForBook = async (
  userId: string,
  bookId: string,
  offset: number,
  limit: number
) => {
  // Verify the book belongs to the authenticated user before returning quotes.
  const book = await Book.findOne({ _id: bookId, userId }).lean();
  if (!book) {
    throw new Error('Unauthorized: book does not belong to user');
  }
  try {
    const quotes = await Quote.aggregate([
      {
        $match: { bookId },
      },
      {
        $lookup: {
          from: 'likes',
          let: { quoteId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$quoteId', { $toObjectId: '$$quoteId' }] },
                    { $eq: ['$userId', new ObjectId(userId)] },
                  ],
                },
              },
            },
          ],
          as: 'likes',
        },
      },
      {
        $match: {
          'likes.0': { $exists: true }, // Only keep documents where likes array is not empty
        },
      },
      { $skip: offset },
      { $limit: limit },
      {
        $addFields: {
          liked: true, // Since we're only getting liked quotes, this will always be true
        },
      },
      {
        $project: {
          likes: 0,
        },
      },
    ]).exec();

    return quotes;
  } catch (e) {
    console.error('Error fetching liked quotes for book:', e);
    return [];
  }
};
