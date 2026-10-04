import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDOAZFtJpQK1W9bLSAFFKVFXg7l6_rNhK8',
  authDomain: 'offerhaikya-app.firebaseapp.com',
  projectId: 'offerhaikya-app',
  storageBucket: 'offerhaikya-app.firebasestorage.app',
  messagingSenderId: '91570217615',
  appId: '1:91570217615:web:f6dcf8478282214959c6fa',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
