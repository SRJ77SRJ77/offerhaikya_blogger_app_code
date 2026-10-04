import { initializeApp, getApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth, type Auth } from 'firebase/auth';
import * as FirebaseAuth from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCFGA6W0MUxsnPZWDRh8nG8HPCnFmHpvwk',
  authDomain: 'offerhaikya-app.firebaseapp.com',
  projectId: 'offerhaikya-app',
  storageBucket: 'offerhaikya-app.firebasestorage.app',
  messagingSenderId: '91570217615',
  appId: '1:91570217615:web:f6dcf8478282214959c6fa',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const getReactNativePersistence = (FirebaseAuth as any).getReactNativePersistence;

const createAuth = (): Auth => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
};

export const auth = createAuth();
export const db = getFirestore(app);
