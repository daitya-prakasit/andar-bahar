Deployment notes for Cloud Functions

1) Prerequisites
   - Install Node.js 18 and npm
   - Install Firebase CLI: npm i -g firebase-tools
   - Login: firebase login
   - Select your Firebase project: firebase use --add <projectId>

2) Prepare and deploy
   cd functions
   npm install
   cd ..
   firebase deploy --only firestore:rules,functions

3) Testing callable functions locally (optional)
   cd functions
   npm run start
   // then use firebase functions:shell commands to call functions

4) Admin custom claim setup (example)
   // Run this from a trusted environment using Admin SDK
   const admin = require('firebase-admin');
   admin.auth().setCustomUserClaims(uid, { admin: true });

Notes:
- Ensure billing is enabled for Cloud Functions and Firestore if you will have significant usage.
- The functions are written using callable functions (https.onCall). Your client uses firebase.functions().httpsCallable('placeBet').
