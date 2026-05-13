const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

/**
 * Callable function: placeBet
 * Input: { amount: number, side: 'Andar'|'Bahar', roundId?: string }
 * Auth required.
 * Behavior: atomically deduct user balance, create bet doc in user's bets subcollection.
 */
exports.placeBet = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  const uid = context.auth.uid;
  const amount = Number(data.amount);
  const side = data.side;
  if (!amount || amount <= 0) throw new functions.https.HttpsError('invalid-argument', 'Invalid amount');
  if (amount > 1000000) throw new functions.https.HttpsError('invalid-argument', 'Amount too large');
  if (side !== 'Andar' && side !== 'Bahar') throw new functions.https.HttpsError('invalid-argument', 'Invalid side');

  const userRef = db.collection('users').doc(uid);
  const betRef = userRef.collection('bets').doc();

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
      const balance = Number(snap.data().balance || 0);
      if (balance < amount) throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance');
      const newBal = Math.round((balance - amount) * 100) / 100;
      tx.update(userRef, { balance: newBal });
      tx.set(betRef, { amount, side, status: 'placed', ts: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (err) {
    console.error('placeBet error', err);
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError('internal', 'Transaction failed');
  }
});

/**
 * Improved Callable function: settleRound
 * Input: { roundId: string }
 * Auth: admin only (use custom claim 'admin')
 * Behavior:
 *  - Reads round doc /rounds/{roundId} to get winner and multiplier
 *  - Uses a collectionGroup('bets') query to fetch all placed bets for that round
 *  - Applies payouts only for winners, writes user balance increments and transaction docs,
 *    and marks bets as settled. Uses batched writes and chunks to respect Firestore limits.
 */
exports.settleRound = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  const token = context.auth.token || {};
  if (!token.admin) throw new functions.https.HttpsError('permission-denied', 'Admin only');

  const roundId = data.roundId;
  if (!roundId) throw new functions.https.HttpsError('invalid-argument', 'roundId required');

  const roundRef = db.collection('rounds').doc(roundId);
  const roundSnap = await roundRef.get();
  if (!roundSnap.exists) throw new functions.https.HttpsError('not-found', 'Round not found');
  const round = roundSnap.data();
  if (round.status === 'settled') return { success: true, message: 'round already settled' };
  const winner = round.winner;
  if (winner !== 'Andar' && winner !== 'Bahar') throw new functions.https.HttpsError('invalid-argument', 'Invalid winner in round doc');
  const MULTIPLIER = round.multiplier || 2;

  // Fetch all placed bets for this round via collectionGroup query
  const betsSnap = await db.collectionGroup('bets').where('roundId', '==', roundId).where('status', '==', 'placed').get();
  if (betsSnap.empty) {
    await roundRef.update({ status: 'settled', settledAt: admin.firestore.FieldValue.serverTimestamp() });
    return { success: true, message: 'no bets to settle' };
  }

  // Firestore batch limits: 500 ops per batch. We keep conservative 450 operations per batch.
  const MAX_OPS = 450;
  let batch = db.batch();
  let opCount = 0;
  const commitPromises = [];

  function commitIfNeeded() {
    if (opCount >= MAX_OPS) {
      commitPromises.push(batch.commit());
      batch = db.batch();
      opCount = 0;
    }
  }

  try {
    for (const bdoc of betsSnap.docs) {
      const b = bdoc.data();
      const betAmount = Number(b.amount || 0);
      const betSide = b.side;
      // betDoc path: users/{uid}/bets/{betId}
      const userDocRef = bdoc.ref.parent.parent;
      if (!userDocRef) continue; // malformed

      const isWin = (betSide === winner);
      if (isWin && betAmount > 0) {
        const winAmt = Math.round(betAmount * MULTIPLIER * 100) / 100;
        // increment user balance
        batch.update(userDocRef, { balance: admin.firestore.FieldValue.increment(winAmt) });
        opCount++;
        // create transaction doc
        const txRef = userDocRef.collection('transactions').doc();
        batch.set(txRef, { type: 'game-payout', amount: winAmt, roundId, date: admin.firestore.FieldValue.serverTimestamp(), note: `Payout for round ${roundId}` });
        opCount++;
      }

      // mark bet settled
      batch.update(bdoc.ref, { status: 'settled', roundResult: (isWin ? 'win' : 'lose'), settledAt: admin.firestore.FieldValue.serverTimestamp() });
      opCount++;

      commitIfNeeded();
    }

    // mark round settled
    batch.update(roundRef, { status: 'settled', settledAt: admin.firestore.FieldValue.serverTimestamp() });
    opCount++;

    // final commit
    commitPromises.push(batch.commit());
    await Promise.all(commitPromises);
    return { success: true, message: 'round settled' };
  } catch (e) {
    console.error('improved settleRound error', e);
    throw new functions.https.HttpsError('internal', 'Settle failed');
  }
});

/**
 * Callable function: setWinner
 * Input: { roundId: string, winner: 'Andar'|'Bahar' }
 * Auth: admin only (custom claim 'admin')
 * Behavior: atomically set round winner and status to 'closed' (server-side) and log an admin action.
 */
exports.setWinner = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  const token = context.auth.token || {};
  if (!token.admin) throw new functions.https.HttpsError('permission-denied', 'Admin only');

  const roundId = data.roundId;
  const winner = data.winner;
  if (!roundId || (winner !== 'Andar' && winner !== 'Bahar')) throw new functions.https.HttpsError('invalid-argument', 'roundId and valid winner required');

  const roundRef = db.collection('rounds').doc(roundId);
  try{
    await db.runTransaction(async tx => {
      const rs = await tx.get(roundRef);
      if(!rs.exists) throw new functions.https.HttpsError('not-found','Round not found');
      const r = rs.data();
      if(r.status === 'settled' || r.status === 'closed') throw new functions.https.HttpsError('failed-precondition','Round already closed');
      tx.update(roundRef, { winner, status: 'closed', closedAt: admin.firestore.FieldValue.serverTimestamp() });
      // Log admin action
      const logRef = db.collection('adminLogs').doc();
      tx.set(logRef, { action: 'setWinner', roundId, winner, admin: context.auth.uid, ts: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { success: true };
  }catch(e){
    console.error('setWinner error', e);
    if (e instanceof functions.https.HttpsError) throw e;
    throw new functions.https.HttpsError('internal','Set winner failed');
  }
});

/**
 * Callable function: creditDeposit
 * Input: { userId: string, amount: number, provider: string, providerId: string }
 * This should be called by your server after verifying payment (or via a verified webhook) OR from the server itself.
 * Behavior: idempotent credit of user's balance and create transaction doc.
 */
exports.creditDeposit = functions.https.onCall(async (data, context) => {
  // Authentication: either callable from server with admin claim, or verify via a secret
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');
  const token = context.auth.token || {};
  // Only allow admin clients to call this (or you can add a secret check)
  if (!token.admin) throw new functions.https.HttpsError('permission-denied', 'Admin only');

  const userId = data.userId;
  const amount = Number(data.amount);
  const provider = data.provider || 'unknown';
  const providerId = data.providerId || '';
  if (!userId || !amount || amount <= 0) throw new functions.https.HttpsError('invalid-argument', 'Invalid parameters');

  const processedRef = db.collection('processedPayments').doc(provider + '_' + providerId);
  const userRef = db.collection('users').doc(userId);

  try {
    await db.runTransaction(async (tx) => {
      const pDoc = await tx.get(processedRef);
      if (pDoc.exists) throw new functions.https.HttpsError('already-exists', 'Payment already processed');
      const uDoc = await tx.get(userRef);
      if (!uDoc.exists) tx.set(userRef, { balance: 0, wins: 0, losses: 0, total: 0 });
      const prev = uDoc.exists && uDoc.data().balance != null ? Number(uDoc.data().balance) : 0;
      const next = Math.round((prev + amount) * 100) / 100;
      tx.set(processedRef, { userId, amount, provider, providerId, processedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(userRef, { balance: next });
      const txRef = userRef.collection('transactions').doc();
      tx.set(txRef, { type: 'deposit', amount: amount, provider, providerId, date: admin.firestore.FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e) {
    console.error('creditDeposit error', e);
    if (e instanceof functions.https.HttpsError) throw e;
    throw new functions.https.HttpsError('internal', 'Credit failed');
  }
});
