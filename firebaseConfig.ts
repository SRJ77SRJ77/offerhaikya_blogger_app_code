import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCFGA6W0MUxsnPZWDRh8nG8HPCnFmHpvwk',
  authDomain: 'offerhaikya-app.firebaseapp.com',
  projectId: 'offerhaikya-app',
  storageBucket: 'offerhaikya-app.firebasestorage.app',
  messagingSenderId: '91570217615',
  appId: '1:91570217615:web:f6dcf8478282214959c6fa',
};

const app = initializeApp(firebaseConfig);
const persistence = getReactNativePersistence(ReactNativeAsyncStorage);

export const auth = initializeAuth(app, {
  persistence,
});
export const db = getFirestore(app);
