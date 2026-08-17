import { Expo, ExpoPushMessage, ExpoPushToken } from 'expo-server-sdk';

// Create a new Expo SDK client
// optionally providing an access token if you have enabled push security
let expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true,
});

export const sendNotification = async (
  pushToken: ExpoPushToken | ExpoPushToken[],
  title?: string,
  body?: string,
  data?: object
) => {
//   if (!Expo.isExpoPushToken(pushToken)) {
//     throw new Error(`Push token ${pushToken} is not a valid Expo push token`);
//   }

  const notification: any = {
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high'
  };

  return await expo.sendPushNotificationsAsync([notification]);
};``